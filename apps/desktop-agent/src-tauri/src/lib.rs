use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, State, WindowEvent};

struct RuntimeProcess(Mutex<Option<Child>>);

fn pipe_runtime_logs<R: std::io::Read + Send + 'static>(stream: Option<R>, label: &'static str) {
    let Some(stream) = stream else { return };
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().flatten() {
            eprintln!("[runtime:{label}] {line}");
        }
    });
}

fn workcopilot_home() -> PathBuf {
    if let Some(custom) = std::env::var_os("WORKCOPILOT_HOME") {
        return PathBuf::from(custom);
    }
    #[cfg(windows)]
    {
        PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join(".workcopilot")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".workcopilot")
    }
}

fn runtime_token_path() -> PathBuf {
    workcopilot_home()
        .join("credentials")
        .join("runtime.token.secret")
}

fn workspace_pointer_path() -> PathBuf {
    workcopilot_home().join("workspace.path")
}

#[tauri::command]
fn get_or_create_runtime_token() -> Result<String, String> {
    let path = runtime_token_path();
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }

    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = URL_SAFE_NO_PAD.encode(bytes);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, &token).map_err(|error| error.to_string())?;
    Ok(token)
}

fn runtime_already_up() -> bool {
    TcpStream::connect_timeout(
        &"127.0.0.1:4317".parse().expect("valid addr"),
        Duration::from_millis(200),
    )
    .is_ok()
}

fn wait_for_runtime(timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if runtime_already_up() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    runtime_already_up()
}

fn looks_like_workspace(root: &Path) -> bool {
    root.join("packages/agent-core/package.json").is_file() && root.join("pnpm-workspace.yaml").is_file()
}

fn remember_workspace(root: &Path) {
    let pointer = workspace_pointer_path();
    if let Some(parent) = pointer.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(pointer, root.to_string_lossy().as_bytes());
}

fn resolve_workspace() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("WORKCOPILOT_WORKSPACE") {
        let path = PathBuf::from(custom.trim());
        if looks_like_workspace(&path) {
            remember_workspace(&path);
            return Some(path);
        }
    }

    if let Ok(saved) = fs::read_to_string(workspace_pointer_path()) {
        let path = PathBuf::from(saved.trim());
        if looks_like_workspace(&path) {
            return Some(path);
        }
    }

    let from_manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    if looks_like_workspace(&from_manifest) {
        let resolved = from_manifest.canonicalize().unwrap_or(from_manifest);
        remember_workspace(&resolved);
        return Some(resolved);
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut cursor = exe.parent();
        while let Some(dir) = cursor {
            if looks_like_workspace(dir) {
                remember_workspace(dir);
                return Some(dir.to_path_buf());
            }
            cursor = dir.parent();
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let mut cursor = Some(cwd.as_path());
        while let Some(dir) = cursor {
            if looks_like_workspace(dir) {
                remember_workspace(dir);
                return Some(dir.to_path_buf());
            }
            cursor = dir.parent();
        }
    }

    None
}

fn enriched_path() -> Option<std::ffi::OsString> {
    let mut entries: Vec<PathBuf> = Vec::new();
    if let Some(existing) = std::env::var_os("PATH") {
        for part in std::env::split_paths(&existing) {
            entries.push(part);
        }
    }

    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            entries.push(PathBuf::from(&appdata).join("npm"));
            entries.push(PathBuf::from(&appdata).join("fnm"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            entries.push(PathBuf::from(&local).join("pnpm"));
            entries.push(PathBuf::from(&local).join("Programs\\pnpm"));
            entries.push(PathBuf::from(&local).join("fnm"));
        }
        if let Some(user) = std::env::var_os("USERPROFILE") {
            entries.push(PathBuf::from(&user).join("AppData\\Roaming\\npm"));
            entries.push(PathBuf::from(&user).join(".local\\share\\pnpm"));
            entries.push(PathBuf::from(&user).join("scoop\\shims"));
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            entries.push(PathBuf::from(&home).join(".local/share/pnpm"));
            entries.push(PathBuf::from(&home).join(".npm-global/bin"));
            entries.push(PathBuf::from("/usr/local/bin"));
        }
    }

    std::env::join_paths(entries).ok()
}

fn pnpm_candidates() -> Vec<PathBuf> {
    let mut list = Vec::new();
    if cfg!(windows) {
        list.push(PathBuf::from("pnpm.cmd"));
        list.push(PathBuf::from("pnpm.exe"));
        list.push(PathBuf::from("pnpm"));
        if let Some(appdata) = std::env::var_os("APPDATA") {
            list.push(PathBuf::from(&appdata).join("npm\\pnpm.cmd"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            list.push(PathBuf::from(&local).join("pnpm\\pnpm.exe"));
            list.push(PathBuf::from(&local).join("Programs\\pnpm\\pnpm.exe"));
        }
    } else {
        list.push(PathBuf::from("pnpm"));
    }
    list
}

fn node_candidates() -> Vec<PathBuf> {
    let mut list = vec![PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" })];
    #[cfg(windows)]
    {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            list.push(PathBuf::from(&program_files).join("nodejs\\node.exe"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            list.push(PathBuf::from(&local).join("Programs\\node\\node.exe"));
        }
    }
    list
}

fn find_tsx_entry(workspace: &Path) -> Option<PathBuf> {
    let direct = [
        workspace.join("node_modules/tsx/dist/cli.mjs"),
        workspace.join("packages/agent-core/node_modules/tsx/dist/cli.mjs"),
    ];
    for path in direct {
        if path.is_file() {
            return Some(path);
        }
    }

    let pnpm_store = workspace.join("node_modules/.pnpm");
    if let Ok(entries) = fs::read_dir(&pnpm_store) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("tsx@") {
                let candidate = entry.path().join("node_modules/tsx/dist/cli.mjs");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn configure_child_command(command: &mut Command, cwd: &Path, path_env: Option<&std::ffi::OsString>) {
    command
        .current_dir(cwd)
        .env("WORKCOPILOT_HEADLESS", "false")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = path_env {
        command.env("PATH", path);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Hide the console window so Runtime stays attached to the desktop app.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn bundled_node_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn looks_like_bundled_runtime(dir: &Path) -> bool {
    dir.join("node").join(bundled_node_name()).is_file()
        && dir.join("app").join("dist").join("server.js").is_file()
}

fn discover_bundled_runtime(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join("resources/runtime"));
        candidates.push(resource.join("runtime"));
        candidates.push(resource);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources/runtime"));
            candidates.push(dir.join("runtime"));
        }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime"));

    for dir in candidates {
        if looks_like_bundled_runtime(&dir) {
            eprintln!("[desktop] using bundled runtime at {}", dir.display());
            return Some(dir);
        }
    }
    None
}

fn spawn_bundled_runtime(runtime_dir: &Path) -> Result<Child, String> {
    let node = runtime_dir.join("node").join(bundled_node_name());
    let server = runtime_dir.join("app").join("dist").join("server.js");
    let app_dir = runtime_dir.join("app");
    let mut path_entries = Vec::new();
    path_entries.push(runtime_dir.join("node"));
    if let Some(existing) = enriched_path() {
        for part in std::env::split_paths(&existing) {
            path_entries.push(part);
        }
    }
    let path_env = std::env::join_paths(path_entries).ok();

    let mut command = Command::new(&node);
    command.arg(&server);
    configure_child_command(&mut command, &app_dir, path_env.as_ref());
    match command.spawn() {
        Ok(mut child) => {
            pipe_runtime_logs(child.stdout.take(), "stdout");
            pipe_runtime_logs(child.stderr.take(), "stderr");
            eprintln!(
                "[desktop] spawned bundled runtime via {} {}",
                node.display(),
                server.display()
            );
            Ok(child)
        }
        Err(error) => Err(format!(
            "无法启动内置 Runtime（{} {}）：{error}",
            node.display(),
            server.display()
        )),
    }
}

fn spawn_runtime_process(workspace: &Path) -> Result<Child, String> {
    let path_env = enriched_path();
    let agent_dir = workspace.join("packages/agent-core");
    let server_ts = agent_dir.join("src/server.ts");
    let server_js = agent_dir.join("dist/server.js");
    let mut last_error = String::from("no launcher succeeded");

    // 1) Prefer direct node launch (no visible cmd window on Windows).
    if server_js.is_file() {
        for node in node_candidates() {
            let mut command = Command::new(&node);
            command.arg(&server_js);
            configure_child_command(&mut command, &agent_dir, path_env.as_ref());
            match command.spawn() {
                Ok(mut child) => {
                    pipe_runtime_logs(child.stdout.take(), "stdout");
                    pipe_runtime_logs(child.stderr.take(), "stderr");
                    eprintln!(
                        "[desktop] spawned runtime via {} {}",
                        node.display(),
                        server_js.display()
                    );
                    return Ok(child);
                }
                Err(error) => last_error = format!("{} {}: {error}", node.display(), server_js.display()),
            }
        }
    }

    if server_ts.is_file() {
        if let Some(tsx) = find_tsx_entry(workspace) {
            for node in node_candidates() {
                let mut command = Command::new(&node);
                command.args([tsx.as_os_str(), server_ts.as_os_str()]);
                configure_child_command(&mut command, &agent_dir, path_env.as_ref());
                match command.spawn() {
                    Ok(mut child) => {
                        pipe_runtime_logs(child.stdout.take(), "stdout");
                        pipe_runtime_logs(child.stderr.take(), "stderr");
                        eprintln!(
                            "[desktop] spawned runtime via {} {} {}",
                            node.display(),
                            tsx.display(),
                            server_ts.display()
                        );
                        return Ok(child);
                    }
                    Err(error) => {
                        last_error = format!("{} {} {}: {error}", node.display(), tsx.display(), server_ts.display())
                    }
                }
            }
        }
    }

    // 2) Fallback: hidden cmd hosting pnpm (still no visible console).
    for candidate in pnpm_candidates() {
        #[cfg(windows)]
        let mut command = {
            let mut cmd = Command::new("cmd.exe");
            let cmdline = format!(
                "\"{}\" --filter @workcopilot/agent-core exec tsx src/server.ts",
                candidate.display()
            );
            cmd.args(["/C", &cmdline]);
            configure_child_command(&mut cmd, &agent_dir, path_env.as_ref());
            cmd
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut cmd = Command::new(&candidate);
            cmd.args(["--filter", "@workcopilot/agent-core", "exec", "tsx", "src/server.ts"]);
            configure_child_command(&mut cmd, &agent_dir, path_env.as_ref());
            cmd
        };

        match command.spawn() {
            Ok(mut child) => {
                pipe_runtime_logs(child.stdout.take(), "stdout");
                pipe_runtime_logs(child.stderr.take(), "stderr");
                eprintln!(
                    "[desktop] spawned runtime via pnpm fallback {} in {}",
                    candidate.display(),
                    agent_dir.display()
                );
                return Ok(child);
            }
            Err(error) => last_error = format!("{}: {error}", candidate.display()),
        }
    }

    Err(format!(
        "无法在后台启动 Runtime。请确认已 pnpm install。最后错误：{last_error}"
    ))
}

fn start_runtime_if_needed(app: &tauri::AppHandle, state: &RuntimeProcess) -> Result<(), String> {
    if runtime_already_up() {
        return Ok(());
    }

    {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "runtime process lock poisoned".to_string())?;
        if let Some(existing) = guard.as_mut() {
            if existing.try_wait().ok().flatten().is_none() && wait_for_runtime(Duration::from_secs(2))
            {
                return Ok(());
            }
        }

        let child = if let Some(bundled) = discover_bundled_runtime(app) {
            spawn_bundled_runtime(&bundled)?
        } else if let Some(workspace) = resolve_workspace() {
            spawn_runtime_process(&workspace)?
        } else {
            return Err(
                "未找到内置 Runtime，也未找到源码仓库。\n\
                 请重新安装带 Runtime 的桌面端，或设置 WORKCOPILOT_WORKSPACE 后从源码启动。"
                    .to_string(),
            );
        };
        *guard = Some(child);
    }

    if wait_for_runtime(Duration::from_secs(25)) {
        return Ok(());
    }

    Err(
        "已尝试启动 Runtime，但 25 秒内未在 http://127.0.0.1:4317 就绪。"
            .to_string(),
    )
}

#[tauri::command]
fn ensure_runtime(app: tauri::AppHandle, state: State<'_, RuntimeProcess>) -> Result<String, String> {
    start_runtime_if_needed(&app, &state)?;
    Ok("ok".into())
}

#[tauri::command]
fn runtime_status() -> String {
    if runtime_already_up() {
        "up".into()
    } else {
        "down".into()
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(RuntimeProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_or_create_runtime_token,
            ensure_runtime,
            runtime_status,
            quit_app
        ])
        .on_window_event(|window, event| {
            // Closing the window only hides to tray; real exit is via tray Quit / quit_app.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            if let Some(state) = app.try_state::<RuntimeProcess>() {
                if let Err(error) = start_runtime_if_needed(app.handle(), &state) {
                    eprintln!("[desktop] startup runtime: {error}");
                }
            }

            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 WorkCopilot", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("WorkCopilot")
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_main_window(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let tauri::tray::TrayIconEvent::Click {
                    button: tauri::tray::MouseButton::Left,
                    button_state: tauri::tray::MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            })
            .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build WorkCopilot");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app.try_state::<RuntimeProcess>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(child) = guard.as_mut() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}

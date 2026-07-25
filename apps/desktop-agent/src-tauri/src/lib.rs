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

fn spawn_runtime_process(workspace: &Path) -> Result<Child, String> {
    let path_env = enriched_path();
    let mut last_error = String::from("pnpm not found");

    for candidate in pnpm_candidates() {
        let mut command = Command::new(&candidate);
        command
            .args(["--filter", "@workcopilot/agent-core", "dev"])
            .current_dir(workspace)
            .env("WORKCOPILOT_HEADLESS", "false")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(path) = path_env.as_ref() {
            command.env("PATH", path);
        }

        match command.spawn() {
            Ok(mut child) => {
                pipe_runtime_logs(child.stdout.take(), "stdout");
                pipe_runtime_logs(child.stderr.take(), "stderr");
                eprintln!(
                    "[desktop] spawned runtime via {} in {}",
                    candidate.display(),
                    workspace.display()
                );
                return Ok(child);
            }
            Err(error) => {
                last_error = format!("{}: {error}", candidate.display());
            }
        }
    }

    Err(format!(
        "无法启动 Runtime（找不到可用的 pnpm）。已尝试 PATH 扩展。最后错误：{last_error}"
    ))
}

fn start_runtime_if_needed(state: &RuntimeProcess) -> Result<(), String> {
    if runtime_already_up() {
        return Ok(());
    }

    let workspace = resolve_workspace().ok_or_else(|| {
        "未找到 WorkCopilot 源码仓库，无法自动拉起 Runtime。\n\
         请任选其一：\n\
         1) 在源码目录运行 `pnpm runtime`\n\
         2) 设置环境变量 WORKCOPILOT_WORKSPACE=你的仓库路径\n\
         3) 用 `pnpm --filter @workcopilot/desktop-agent tauri dev` 从源码启动桌面端"
            .to_string()
    })?;

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
        let child = spawn_runtime_process(&workspace)?;
        *guard = Some(child);
    }

    if wait_for_runtime(Duration::from_secs(20)) {
        return Ok(());
    }

    Err(
        "已尝试启动 Runtime，但 20 秒内未在 http://127.0.0.1:4317 就绪。请检查源码目录依赖是否已安装（pnpm install）。"
            .to_string(),
    )
}

#[tauri::command]
fn ensure_runtime(state: State<'_, RuntimeProcess>) -> Result<String, String> {
    start_runtime_if_needed(&state)?;
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
                if let Err(error) = start_runtime_if_needed(&state) {
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

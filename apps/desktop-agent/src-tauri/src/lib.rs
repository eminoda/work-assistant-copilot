use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, WindowEvent};

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

fn spawn_runtime() -> Option<Child> {
    let command_name = if cfg!(windows) { "pnpm.cmd" } else { "pnpm" };
    let workspace = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut command = Command::new(command_name);
    command
        .args(["--filter", "@workcopilot/agent-core", "dev"])
        .current_dir(&workspace)
        .env("WORKCOPILOT_HEADLESS", "false")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().ok()?;
    pipe_runtime_logs(child.stdout.take(), "stdout");
    pipe_runtime_logs(child.stderr.take(), "stderr");
    eprintln!(
        "[desktop] spawned local runtime in {} (headed Playwright)",
        workspace.display()
    );
    Some(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_or_create_runtime_token])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            app.manage(RuntimeProcess(Mutex::new(spawn_runtime())));
            let show = MenuItem::with_id(app, "show", "Show WorkCopilot", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
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

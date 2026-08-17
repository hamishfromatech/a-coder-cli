use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, Runtime,
};

const MENU_SHOW_WINDOW: &str = "show_window";
const MENU_QUIT: &str = "quit";

/// Build the system tray icon, menu, and event handlers.
pub fn build_tray<R: Runtime>(app_handle: &AppHandle<R>) -> Result<TrayIcon<R>, String> {
    let show_item =
        MenuItem::with_id(app_handle, MENU_SHOW_WINDOW, "Show Window", true, None::<&str>)
            .map_err(|e| format!("create show menu item: {}", e))?;

    let quit_item = MenuItem::with_id(app_handle, MENU_QUIT, "Quit", true, None::<&str>)
        .map_err(|e| format!("create quit menu item: {}", e))?;

    let menu = Menu::with_items(app_handle, &[&show_item, &quit_item])
        .map_err(|e| format!("create tray menu: {}", e))?;

    // Use the app's default icon for the tray.
    let icon = app_handle
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "no default window icon available".to_string())?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_tray_menu_event(app, event.id.as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            // Single left-click also shows the window (in addition to the menu).
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    show_main_window(tray.app_handle());
                }
            }
        })
        .build(app_handle)
        .map_err(|e| format!("build tray icon: {}", e))?;

    Ok(tray)
}

fn handle_tray_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        MENU_SHOW_WINDOW => show_main_window(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Check if minimize-to-tray is enabled (from cli's settings.json).
/// Defaults to true on macOS, false on other platforms.
pub fn minimize_to_tray_enabled() -> bool {
    // Try to read from the CLI's settings.json.
    let settings_path = crate::settings::home_dir()
        .ok()
        .map(|home| home.join(".a-coder-cli").join("agent").join("settings.json"));

    if let Some(settings_path) = settings_path {

        if settings_path.exists() {
            if let Ok(contents) = std::fs::read_to_string(&settings_path) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) {
                    if let Some(enabled) = value.get("minimizeToTray").and_then(|v| v.as_bool()) {
                        return enabled;
                    }
                }
            }
        }
    }

    // Default: true on macOS, false on other platforms.
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

use std::sync::Mutex;

use tauri::{
	menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
	tray::{TrayIcon, TrayIconBuilder},
	AppHandle, Emitter, Manager, Runtime,
};

const TRAY_ID: &str = "main-tray";
const MENU_STATUS: &str = "tray_status";
const MENU_NEW_SESSION: &str = "new_session";
const MENU_TOGGLE_HUD: &str = "toggle_hud";
const MENU_KEEP_RUNNING: &str = "keep_running";
const MENU_SHOW_WINDOW: &str = "show_window";
const MENU_QUIT: &str = "quit";

/// Tray status is pushed from the renderer (`working` / `needs-input` / `idle`)
/// and folded into the disabled status row and tooltip.
#[derive(Default)]
pub struct TrayState {
	status: Mutex<String>,
}

fn status_label(status: &str) -> &'static str {
	match status {
		"working" => "Working",
		"needs-input" => "Needs input",
		_ => "Idle",
	}
}

fn current_status<R: Runtime>(app: &AppHandle<R>) -> String {
	app.try_state::<TrayState>()
		.map(|state| state.status.lock().map(|value| value.clone()).unwrap_or_default())
		.unwrap_or_default()
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, String> {
	let status = current_status(app);
	let status_item = MenuItem::with_id(
		app,
		MENU_STATUS,
		format!("Status: {}", status_label(&status)),
		false,
		None::<&str>,
	)
	.map_err(|e| format!("create status menu item: {e}"))?;
	let new_session = MenuItem::with_id(app, MENU_NEW_SESSION, "New Session", true, None::<&str>)
		.map_err(|e| format!("create new-session menu item: {e}"))?;
	let toggle_hud = MenuItem::with_id(app, MENU_TOGGLE_HUD, "Toggle HUD", true, None::<&str>)
		.map_err(|e| format!("create HUD menu item: {e}"))?;
	let keep_running = CheckMenuItem::with_id(
		app,
		MENU_KEEP_RUNNING,
		"Keep Running in Tray",
		true,
		minimize_to_tray_enabled(),
		None::<&str>,
	)
	.map_err(|e| format!("create keep-running menu item: {e}"))?;
	let separator = PredefinedMenuItem::separator(app)
		.map_err(|e| format!("create tray separator: {e}"))?;
	let show_item = MenuItem::with_id(app, MENU_SHOW_WINDOW, "Show Window", true, None::<&str>)
		.map_err(|e| format!("create show menu item: {e}"))?;
	let quit_item = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)
		.map_err(|e| format!("create quit menu item: {e}"))?;

	Menu::with_items(
		app,
		&[
			&status_item,
			&new_session,
			&toggle_hud,
			&separator,
			&keep_running,
			&show_item,
			&quit_item,
		],
	)
	.map_err(|e| format!("create tray menu: {e}"))
}

/// Build the system tray icon, menu, and event handlers.
pub fn build_tray<R: Runtime>(app_handle: &AppHandle<R>) -> Result<TrayIcon<R>, String> {
	let menu = build_menu(app_handle)?;

	let icon = app_handle
		.default_window_icon()
		.cloned()
		.ok_or_else(|| "no default window icon available".to_string())?;

	let tray = TrayIconBuilder::with_id(TRAY_ID)
		.icon(icon)
		.menu(&menu)
		.tooltip(format!(
			"A-Coder Desktop — {}",
			status_label(&current_status(app_handle))
		))
		.show_menu_on_left_click(true)
		.on_menu_event(|app, event| {
			handle_tray_menu_event(app, event.id.as_ref());
		})
		.on_tray_icon_event(|tray, event| {
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
		.map_err(|e| format!("build tray icon: {e}"))?;

	Ok(tray)
}

/// Update the tray status row, tooltip, and keep-running check state.
pub fn set_status(app: &AppHandle, status: &str) {
	if let Some(state) = app.try_state::<TrayState>() {
		if let Ok(mut current) = state.status.lock() {
			*current = status.to_string();
		}
	}
	if let Some(tray) = app.tray_by_id(TRAY_ID) {
		if let Ok(menu) = build_menu(app) {
			let _ = tray.set_menu(Some(menu));
		}
		let tooltip = format!("A-Coder Desktop — {}", status_label(status));
		let _ = tray.set_tooltip(Some(tooltip.as_str()));
	}
}

#[tauri::command]
pub fn tray_status(app: AppHandle, status: String) -> Result<(), String> {
	set_status(&app, &status);
	Ok(())
}

fn handle_tray_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
	match id {
		MENU_SHOW_WINDOW => show_main_window(app),
		MENU_QUIT => app.exit(0),
		MENU_NEW_SESSION => {
			let _ = app.emit("tray-action", "new-session");
			show_main_window(app);
		}
		MENU_TOGGLE_HUD => {
			let _ = app.emit("tray-action", "toggle-hud");
		}
		MENU_KEEP_RUNNING => {
			toggle_minimize_to_tray();
			if let Some(tray) = app.tray_by_id(TRAY_ID) {
				if let Ok(menu) = build_menu(app) {
					let _ = tray.set_menu(Some(menu));
				}
			}
		}
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

fn toggle_minimize_to_tray() {
	let Ok(path) = crate::settings::global_settings_path() else {
		return;
	};
	let mut value = std::fs::read_to_string(&path)
		.ok()
		.and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
		.unwrap_or_else(|| serde_json::json!({}));
	if !value.is_object() {
		value = serde_json::json!({});
	}
	let next = !minimize_to_tray_enabled();
	value["minimizeToTray"] = serde_json::Value::Bool(next);
	if let Some(parent) = path.parent() {
		let _ = std::fs::create_dir_all(parent);
	}
	if let Ok(contents) = serde_json::to_string_pretty(&value) {
		let _ = std::fs::write(path, contents);
	}
}

/// Check if minimize-to-tray is enabled (from cli's settings.json).
/// Defaults to true on macOS, false on other platforms.
pub fn minimize_to_tray_enabled() -> bool {
	let settings_path = crate::settings::global_settings_path().ok();

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

	#[cfg(target_os = "macos")]
	{
		true
	}
	#[cfg(not(target_os = "macos"))]
	{
		false
	}
}

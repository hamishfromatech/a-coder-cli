use tauri::menu::{Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

const MENU_NEW_SESSION: &str = "new_session";
const MENU_COMPACT: &str = "compact";
const MENU_ABORT: &str = "abort";
const MENU_SETTINGS: &str = "settings";
const MENU_PROJECT: &str = "project";
const MENU_SUBAGENTS: &str = "subagents";
const MENU_TEAMS: &str = "teams";
const MENU_HOTKEYS: &str = "hotkeys";
const MENU_CHANGELOG: &str = "changelog";
const MENU_RELOAD: &str = "reload";
const MENU_CHECK_UPDATES: &str = "check_updates";

/// Build the application menu bar. On macOS this installs as the global app
/// menu; on Windows/Linux it appears as the window menu bar.
pub fn build_menu<R: Runtime>(app_handle: &AppHandle<R>) -> Result<Menu<R>, String> {
    let app_menu = SubmenuBuilder::new(app_handle, "A-Coder Desktop")
        .item(&PredefinedMenuItem::about(app_handle, None, None).map_err(|e| e.to_string())?)
        .separator()
        .item(
            &MenuItemBuilder::with_id(MENU_SETTINGS, "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_CHECK_UPDATES, "Check for Updates…")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(&PredefinedMenuItem::quit(app_handle, None).map_err(|e| e.to_string())?)
        .build()
        .map_err(|e| e.to_string())?;

    let file_menu = SubmenuBuilder::new(app_handle, "File")
        .item(
            &MenuItemBuilder::with_id(MENU_NEW_SESSION, "New Session")
                .accelerator("CmdOrCtrl+N")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_PROJECT, "Open Project…")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .build()
        .map_err(|e| e.to_string())?;

    let edit_menu = SubmenuBuilder::new(app_handle, "Edit")
        .item(&PredefinedMenuItem::undo(app_handle, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::redo(app_handle, None).map_err(|e| e.to_string())?)
        .separator()
        .item(&PredefinedMenuItem::cut(app_handle, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::copy(app_handle, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::paste(app_handle, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::select_all(app_handle, None).map_err(|e| e.to_string())?)
        .build()
        .map_err(|e| e.to_string())?;

    let session_menu = SubmenuBuilder::new(app_handle, "Session")
        .item(
            &MenuItemBuilder::with_id(MENU_COMPACT, "Compact Context")
                .accelerator("CmdOrCtrl+K")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_ABORT, "Abort")
                .accelerator("CmdOrCtrl+.")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id(MENU_SUBAGENTS, "Subagents")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_TEAMS, "Teams")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .build()
        .map_err(|e| e.to_string())?;

    let view_menu = SubmenuBuilder::new(app_handle, "View")
        .item(
            &MenuItemBuilder::with_id(MENU_HOTKEYS, "Keyboard Shortcuts")
                .accelerator("CmdOrCtrl+Shift+K")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_CHANGELOG, "Changelog")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_RELOAD, "Reload Resources")
                .accelerator("CmdOrCtrl+R")
                .build(app_handle)
                .map_err(|e| e.to_string())?,
        )
        .build()
        .map_err(|e| e.to_string())?;

    let window_menu = SubmenuBuilder::new(app_handle, "Window")
        .item(&PredefinedMenuItem::minimize(app_handle, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::close_window(app_handle, None).map_err(|e| e.to_string())?)
        .build()
        .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(
        app_handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &session_menu,
            &view_menu,
            &window_menu,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(menu)
}

/// Handle a menu activation by emitting a frontend event the React app can act on.
pub fn handle_menu_event<R: Runtime>(app_handle: &AppHandle<R>, event: MenuEvent) {
    let id = event.id.as_ref();
    let payload = match id {
        MENU_NEW_SESSION => Some("new_session"),
        MENU_COMPACT => Some("compact"),
        MENU_ABORT => Some("abort"),
        MENU_SETTINGS => Some("settings"),
        MENU_PROJECT => Some("project"),
        MENU_SUBAGENTS => Some("subagents"),
        MENU_TEAMS => Some("teams"),
        MENU_HOTKEYS => Some("hotkeys"),
        MENU_CHANGELOG => Some("changelog"),
        MENU_RELOAD => Some("reload"),
        MENU_CHECK_UPDATES => Some("check_updates"),
        _ => None,
    };

    if let Some(action) = payload {
        let _ = app_handle.emit("menu://action", action);
    }
}

// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod fs;
mod git;
mod menu;
mod resources;
mod rpc;
mod settings;
mod share;
mod state;
mod tray;

use rpc::commands as rpc_commands;
use state::AppState;

fn main() {
	tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_updater::Builder::new().build())
		.plugin(tauri_plugin_process::init())
		.manage(AppState::default())
		.invoke_handler(tauri::generate_handler![
			rpc_commands::connect,
			rpc_commands::disconnect,
			rpc_commands::send_command,
			rpc_commands::send_ui_response,
			git::git_status,
			git::git_diff,
			fs::read_text_file,
			fs::read_file_base64,
			fs::list_files,
			fs::list_directory,
			settings::get_settings_paths,
			settings::read_settings_file,
			settings::write_settings_file,
			settings::read_auth_file,
			settings::read_subagents_file,
			settings::get_project_trust,
			settings::set_project_trust,
			settings::write_auth_file,
			settings::read_models_file,
			settings::write_models_file,
			settings::read_keybindings_file,
			settings::write_keybindings_file,
			settings::get_memory,
			settings::set_memory,
			settings::reveal_in_file_manager,
			settings::open_file_in_editor,
			resources::resolve_resources,
			resources::list_packages,
			resources::install_package,
			resources::remove_package,
			resources::update_package,
			resources::toggle_resource,
		share::share_session_gist,
		])
		.setup(|app| {
			let app_handle = app.handle().clone();

			// Build and set the app menu.
			let menu = menu::build_menu(&app_handle)?;
			app_handle.set_menu(menu).map_err(|e| e.to_string())?;
			app_handle.on_menu_event(move |app, event| {
				menu::handle_menu_event(app, event);
			});

			// Build the system tray.
			let _tray = tray::build_tray(&app_handle)?;

			Ok(())
		})
		// Handle window close events for minimize-to-tray behavior. When enabled,
		// hiding the window keeps the app running in the tray instead of quitting.
		.on_window_event(|window, event| {
			use tauri::WindowEvent;
			if let WindowEvent::CloseRequested { api, .. } = event {
				if tray::minimize_to_tray_enabled() {
					let _ = window.hide();
					api.prevent_close();
				}
				// Otherwise, let the close proceed normally (app exits).
			}
		})
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

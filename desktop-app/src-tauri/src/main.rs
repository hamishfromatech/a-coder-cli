// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bench;
mod bootstrap;
mod browser;
mod cli;
mod fs;
mod git;
mod menu;
mod resources;
mod rpc;
mod serve;
mod settings;
mod share;
mod state;
mod tray;
mod voice;

use tauri::Manager;

use rpc::commands as rpc_commands;
use state::AppState;

fn main() {
	// Linux: WebKitGTK's DMABUF renderer can produce black/blank windows (or a
	// black webview the moment GPU-accelerated CSS lands, e.g. backdrop-filter
	// on a newly rendered message) on bleeding-edge GPU stacks — fresh distros
	// like Ubuntu 26.04 with new Mesa or NVIDIA drivers. Tauri's standard
	// workaround is disabling the DMABUF renderer; local compositing still uses
	// accelerated paths, and the visual difference is imperceptible for a chat
	// UI. Respect an explicit user override either way (they may set "0" or
	// have their own environment reasons).
	#[cfg(target_os = "linux")]
	if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
		std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
	}

	// On macOS, make sure the app is a foreground (regular) application before
	// any windows are created. Without this, launching from certain contexts
	// (terminal, installer, quarantined DMG) can leave the process running but
	// its windows hidden from the user because NSApplication is not activated.
	#[cfg(target_os = "macos")]
	#[allow(unexpected_cfgs)]
	unsafe {
		use objc::{msg_send, sel, sel_impl};
		let cls = objc::runtime::Class::get("NSApplication").expect("NSApplication");
		let app: *mut objc::runtime::Object = msg_send![cls, sharedApplication];
		let _: () = msg_send![app, activateIgnoringOtherApps: true];
	}

	let app = tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_updater::Builder::new().build())
		.plugin(tauri_plugin_process::init())
		.manage(AppState::default())
		.manage(bench::BenchState::default())
		.manage(serve::ServeState::default())
		.manage(browser::tabs::TabsState::default())
		.manage(browser::downloads::DownloadsState::default())
		.plugin(tauri_plugin_opener::init())
		.invoke_handler(tauri::generate_handler![
			browser::tabs::browser_supported,
			browser::tabs::browser_layered,
			browser::tabs::browser_set_page_input,
			browser::tabs::browser_tab_list,
			browser::tabs::browser_open_tab,
			browser::tabs::browser_view_show,
			browser::tabs::browser_navigate_tab,
			browser::tabs::browser_tab_action,
			browser::tabs::browser_set_tab_zoom,
			browser::tabs::browser_close_tab,
			browser::tabs::browser_find_in_page,
			browser::agent::browser_agent,
			browser::capture::browser_capture_supported,
			browser::capture::browser_capture,
			browser::mute::browser_tab_mute,
			browser::downloads::browser_download_decide,
			browser::downloads::browser_download_folder,
			browser::downloads::browser_download_folder_pick,
			browser::downloads::browser_download_open,
			browser::downloads::browser_download_reveal,
			browser::gateway::browser_gateway_url,
			browser::agentserver::browser_agent_server_url,
			cli::get_initial_workspace,
			bootstrap::bootstrap_cli,
			bench::bench_list_tasks,
			bench::bench_scaffold,
			bench::bench_start,
			bench::bench_stop,
			serve::serve_start,
			serve::serve_stop,
			serve::serve_status,
			voice::voice_transcribe,
			voice::voice_synthesize,
			rpc_commands::connect,
			rpc_commands::disconnect,
			rpc_commands::send_command,
			rpc_commands::send_ui_response,
			git::git_status,
			git::git_diff,
			fs::debug_log,
			fs::read_text_file,
			fs::read_file_base64,
			fs::list_files,
			fs::list_directory,
			settings::get_settings_paths,
			settings::read_settings_file,
			settings::write_settings_file,
			settings::read_auth_file,
			settings::read_subagents_file,
			settings::read_teams,
			settings::get_project_trust,
			settings::set_project_trust,
			settings::write_auth_file,
			settings::read_models_file,
			settings::write_models_file,
			settings::fetch_provider_models,
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
			// Register the menu event handler on every platform (cheap, no UI).
			app_handle.on_menu_event(move |app, event| {
				menu::handle_menu_event(app, event);
			});

			// Build and set the app menu + tray. On Linux this is deferred to
			// RunEvent::Ready (see the run handler below): GTK-backed menus
			// (muda menubar, libappindicator tray menu) can render empty when
			// their widgets are created before the glib main loop is servicing
			// events. macOS and Windows are unaffected and keep setup-time
			// creation so the app menu exists before the first window shows.
			#[cfg(not(target_os = "linux"))]
			{
				let menu = menu::build_menu(&app_handle)?;
				app_handle.set_menu(menu).map_err(|e| e.to_string())?;

				// Build the system tray.
				let _tray = tray::build_tray(&app_handle)?;
			}
			#[cfg(target_os = "linux")]
			{
				let _ = &app_handle;
			};

			// Explicitly show and focus the main window on startup. Frameless
			// windows (decorations=false on Windows/Linux; macOS uses the
			// overlay titlebar) can otherwise appear hidden or not respond to
			// Dock clicks / taskbar / cmd-tab activation.
			if let Some(window) = app_handle.get_webview_window("main") {
				let _ = window.unminimize();
				let _ = window.show();
				let _ = window.set_focus();

				// Linux: recover from WebKitGTK WebProcess crashes. A content-triggered
				// crash (huge tool output, GPU-path failure on exotic drivers) otherwise
				// leaves the window permanently black until a manual restart. The
				// signal fires on the main thread; log the reason, tell the frontend,
				// and reload the webview in place.
				#[cfg(target_os = "linux")]
				{
					use glib::object::ObjectExt as _;
					use tauri::Emitter;
					let handle = app_handle.clone();
					window.with_webview(move |platform| {
						let wk = platform.inner();
						let _ = wk.connect("web-process-terminated", false, move |values| {
							eprintln!(
								"linux: webview web process terminated (reason {:?}); reloading",
								values.get(1).and_then(|v| v.get::<i32>().ok()),
							);
							let _ = handle.emit("desktop://webprocess-crashed", ());
							if let Some(Ok(view)) =
								values.first().map(|v| v.get::<webkit2gtk::WebView>())
							{
								// The pinned webkit2gtk 2.0.2 bindings name the reload binding
								// `n` (gir mangling quirk); call the C symbol directly instead.
								use glib::translate::ToGlibPtr as _;
								unsafe {
									webkit2gtk::ffi::webkit_web_view_reload(view.to_glib_none().0);
								}
							}
							None
						});
					});
				}
			}

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
		.build(tauri::generate_context!())
		.expect("error while building tauri application");

	app.run(|app_handle, event| {
		// On Linux, build the menu bar + tray only after the event loop is
		// running. See the setup() comment for why.
		#[cfg(target_os = "linux")]
		if let tauri::RunEvent::Ready = event {
			match menu::build_menu(app_handle) {
				Ok(menu) => {
					if let Err(e) = app_handle.set_menu(menu) {
						eprintln!("linux: failed to set app menu: {e}");
					}
				}
				Err(e) => eprintln!("linux: failed to build app menu: {e}"),
			}
			if let Err(e) = tray::build_tray(app_handle) {
				eprintln!("linux: failed to build tray: {e}");
			}
		}

		// On macOS, clicking the Dock icon when the app is running emits Reopen.
		// Make sure the main window is shown and focused in that case.
		#[cfg(target_os = "macos")]
		if let tauri::RunEvent::Reopen { .. } = event {
			if let Some(window) = app_handle.get_webview_window("main") {
				let _ = window.unminimize();
				let _ = window.show();
				let _ = window.set_focus();
			}
		}
	});
}

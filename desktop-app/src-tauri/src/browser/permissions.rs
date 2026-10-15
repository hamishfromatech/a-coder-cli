//! Windows-only webview permissions (WebView2): per-tab site-permission
//! resets for the agent's page views. A page remembered its mic grant in
//! the WebView2 profile, not in the page; the agent tool surface gets a
//! reset command so a stored grant can be revoked without touching the
//! profile's other permissions.

use tauri::Runtime;
use tauri::{Manager, Webview};

use super::require_main;
#[cfg(windows)]
use super::tabs;

// The page's CURRENT document origin (scheme://host, no path); the reset
// only touches that origin's mic grant in the profile.
#[cfg(any(windows, test))]
fn origin_of(uri: &str) -> Option<String> {
	let (scheme, rest) = uri.split_once("://")?;
	if scheme != "https" && scheme != "http" {
		return None;
	}
	let host = rest.split('/').next().unwrap_or(rest);
	if host.is_empty() {
		return None;
	}
	Some(format!("{scheme}://{host}"))
}

#[cfg(test)]
mod tests {
	use super::origin_of;

	#[test]
	fn origins_strip_the_path_and_reject_non_web_schemes() {
		assert_eq!(origin_of("https://example.com/a?q=1"), Some("https://example.com".into()));
		assert_eq!(origin_of("http://localhost:1425/"), Some("http://localhost:1425".into()));
		assert_eq!(origin_of("file:///tmp/a.html"), None);
		assert_eq!(origin_of("about:blank"), None);
		assert_eq!(origin_of("https://"), None);
	}
}
/// resets `COREWEBVIEW2_PERMISSION_STATE_DEFAULT`, the ask-again state, for
/// the tab's origin in its profile). Other platforms answer not supported —
/// WebKit pages re-ask per load already; the panel never persists grants.
#[tauri::command]
pub async fn browser_reset_mic_permission<R: Runtime>(
	webview: Webview<R>,
	tab_id: String,
) -> Result<(), String> {
	require_main(&webview)?;
	reset_mic(&webview.app_handle(), &tab_id)
}

#[cfg(windows)]
fn reset_mic<R: Runtime>(app: &tauri::AppHandle<R>, tab_id: &str) -> Result<(), String> {
	// Completed handlers + pwstr helpers re-export at the webview2_com root.
	use webview2_com::Microsoft::Web::WebView2::Win32::{
		ICoreWebView2, ICoreWebView2_13, ICoreWebView2Profile4,
		COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
	};
	use webview2_com::{take_pwstr, SetPermissionStateCompletedHandler};
	use windows_core::{HSTRING, Interface as _, PWSTR};

	let page = app
		.get_webview(&format!("{}{tab_id}", tabs::LABEL_PREFIX))
		.ok_or_else(|| "That tab is closed".to_string())?;
	// with_webview blocks the caller on the webview's dispatch thread and
	// cannot return the async COM result's outcome directly; every failure is
	// captured into the channel before we answer.
	let (sender, receiver) = std::sync::mpsc::channel();
	page.with_webview(move |platform: tauri::webview::PlatformWebview| {
		let core = match unsafe { platform.controller().CoreWebView2() } {
			Ok(core) => core,
			Err(_) => {
				let _ = sender.send(Err("The webview controller was gone".to_string()));
				return;
			}
		};
		// The permission state lives on the profile (ICoreWebView2_13 carries
		// Profile; Profile4 carries the origin-scoped setter). Old runtimes
		// answer with the runtime message.
		let too_old = || "The WebView2 runtime is too old for permission resets".to_string();
		let profile = match core.cast::<ICoreWebView2_13>() {
			Ok(profile_host) => match unsafe { profile_host.Profile() } {
				Ok(profile) => profile,
				Err(_) => {
					let _ = sender.send(Err(too_old()));
					return;
				}
			},
			Err(_) => {
				let _ = sender.send(Err(too_old()));
				return;
			}
		};
		let profile = match profile.cast::<ICoreWebView2Profile4>() {
			Ok(profile) => profile,
			Err(_) => {
				let _ = sender.send(Err(too_old()));
				return;
			}
		};
		// Read the page's CURRENT document origin (scheme://host, no path) —
		// the reset only touches that origin's mic grant in the profile.
		let mut uri = PWSTR::null();
		if unsafe { core.Source(&mut uri) }.is_err() {
			let _ = sender.send(Err("The page's origin is unreadable".to_string()));
			return;
		}
		let uri = take_pwstr(uri);
		let Some(origin) = origin_of(&uri) else {
			let _ = sender.send(Err("The page has no web origin".to_string()));
			return;
		};
		let origin = HSTRING::from(origin);
		// Safety: COM calls on the controller's dispatch thread inside
		// with_webview; the handler runs on the same thread after completion.
		let sender = sender.clone();
		let handler = SetPermissionStateCompletedHandler::create(Box::new(move |error_code| {
			if error_code.is_err() {
				let _ = sender.send(Err(format!("{error_code:?}")));
			} else {
				let _ = sender.send(Ok(()));
			}
			Ok(())
		}));
		unsafe {
			let _ = profile.SetPermissionState(
				COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
				&origin,
				COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
				&handler,
			);
		}
	})
	.map_err(|error| error.to_string())?;
	receiver
		.recv()
		.unwrap_or_else(|_| Err("The permission reset never completed".into()))
}

#[cfg(not(windows))]
fn reset_mic<R: Runtime>(_app: &tauri::AppHandle<R>, _tab_id: &str) -> Result<(), String> {
	Err("This platform has no WebView2 permissions to reset".into())
}
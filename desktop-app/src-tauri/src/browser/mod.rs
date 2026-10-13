//! The agent browser panel: one native child webview per tab, living under the
//! app's own webview. Pages are untrusted:
//! - Their webview labels fall outside every capability, and their remote
//!   origin is ACL-rejected anyway, so a page cannot call app commands. Every
//!   command additionally checks `require_main`.
//! - All network traffic goes through the loopback `proxy`, which refuses
//!   private answers after resolving DNS itself.
//! - Navigations must be http(s) to a public host; other schemes are handed to
//!   the OS. Each page gets its own persistent data store, never the app's.

pub mod agent;
pub mod agentserver;
pub mod capture;
pub mod downloads;
#[cfg(target_os = "macos")]
pub mod gateway;
#[cfg(target_os = "macos")]
pub mod layer;
pub mod mute;
pub mod proxy;
pub mod security;
pub mod tabs;

use serde::{Deserialize, Serialize};
use tauri::{Runtime, Webview};

/// A rect in the calling webview's CSS pixels, plus the caller's width in CSS
/// pixels, so Rust can scale by the page zoom the frontend reports.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewBounds {
	pub x: f64,
	pub y: f64,
	pub width: f64,
	pub height: f64,
	pub viewport_width: f64,
}

impl ViewBounds {
	pub fn parts(&self) -> (f64, f64, f64, f64, f64) {
		(self.x, self.y, self.width, self.height, self.viewport_width)
	}
}

/// Everything the panel learns about its pages, on one channel
/// (`desktop://browser`) with a one-of payload.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum BrowserEvent {
	/// A page started or finished loading; `started` is a commit (WebKit) or
	/// content loading (WebView2), never a download.
	Load {
		tab_id: String,
		url: String,
		#[serde(rename = "started")]
		loading: bool,
	},
	Title {
		tab_id: String,
		title: String,
	},
	/// The page's address changed without a load (pushState, or the poll saw it).
	Url {
		tab_id: String,
		url: String,
	},
	/// Whether history offers back/forward for the panel's buttons.
	History {
		tab_id: String,
		back: bool,
		forward: bool,
	},
	/// A navigation or popup the panel will not load; the panel passes it to
	/// the OS's default handler.
	External {
		tab_id: String,
		url: String,
	},
	/// A target=_blank link: the panel opens it as a tab (the popup is denied).
	NewTab {
		tab_id: String,
		url: String,
	},
	/// The proxy could not route the page: it stays blank by policy. The panel
	/// toasts so a blank tab is never silent.
	ProxyFailed {
		tab_id: String,
		url: String,
	},
	/// An agent tool needs a tab while none is open: the panel comes up with
	/// the page. Frontend-only (it drives browser_open_tab).
	OpenPanel {
		url: String,
	},
	Closed {
		tab_id: String,
	},
	DownloadPrompt {
		id: String,
		tab_id: String,
		url: String,
		site: String,
		name: String,
	},
	DownloadSettled {
		id: String,
		success: bool,
		path: Option<String>,
	},
}

pub(crate) fn emit<R: Runtime>(app: &tauri::AppHandle<R>, event: BrowserEvent) {
	use tauri::Emitter;
	let name = event.name();
	if let Some(extra) = event.describe() {
		log::info!("agent event -> {name} {extra}");
	} else {
		log::info!("agent event -> {name}");
	}
	if let Err(error) = app.emit(tabs::EVENT_NAME, event) {
		log::warn!("agent event emit failed: {error}");
	}
}

/// Only the panel (the `main` webview) may call browser commands; a page
/// cannot reach here anyway (no capabilities + remote origin), but the check
/// keeps a label mistake from widening anything.
/// A value from the desktop browser's prefs block ("browser" object) in the
/// CLI's global settings file — the settings page owns the values; the Rust
/// side reads them where a default is needed (download folder, tool gating).
pub(crate) fn browser_pref(key: &str) -> Option<serde_json::Value> {
	let path = crate::settings::global_settings_path().ok()?;
	let text = std::fs::read_to_string(path).ok()?;
	let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
	parsed.get("browser")?.get(key).cloned()
}

pub(crate) fn require_main<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
	if webview.label() != tabs::MAIN_LABEL {
		return Err("browser commands answer only to the panel".into());
	}
	Ok(())
}

/// Opens a downloaded file with the system's default handler.
pub(crate) fn open_path<R: Runtime>(app: &tauri::AppHandle<R>, path: &str) -> Result<(), String> {
	use tauri_plugin_opener::OpenerExt as _;
	app.opener()
		.open_path(path.to_string(), None::<&str>)
		.map_err(|error| error.to_string())
}

/// Shows a downloaded file in its folder.
pub(crate) fn reveal_path<R: Runtime>(
	app: &tauri::AppHandle<R>,
	path: &std::path::Path,
) -> Result<(), String> {
	use tauri_plugin_opener::OpenerExt as _;
	app.opener()
		.reveal_item_in_dir(path)
		.map_err(|error| error.to_string())
}

impl BrowserEvent {
	/// The camelCase tag the frontend sees, for log lines.
	pub(crate) fn name(&self) -> &'static str {
		match self {
			Self::Load { .. } => "load",
			Self::Title { .. } => "title",
			Self::Url { .. } => "url",
			Self::History { .. } => "history",
			Self::External { .. } => "external",
			Self::NewTab { .. } => "newTab",
			Self::ProxyFailed { .. } => "proxyFailed",
			Self::OpenPanel { .. } => "openPanel",
			Self::Closed { .. } => "closed",
			Self::DownloadPrompt { .. } => "downloadPrompt",
			Self::DownloadSettled { .. } => "downloadSettled",
		}
	}

	/// One-line payload sketch for the same log lines.
	pub(crate) fn describe(&self) -> Option<String> {
		match self {
			Self::Load {
				tab_id,
				url,
				loading,
			} => Some(format!("tab={tab_id} started={loading} {url}")),
			Self::Title { tab_id, title } => Some(format!("tab={tab_id} {title}")),
			Self::Url { tab_id, url } => Some(format!("tab={tab_id} {url}")),
			Self::History {
				tab_id,
				back,
				forward,
			} => Some(format!("tab={tab_id} back={back} fwd={forward}")),
			Self::External { tab_id, url } => Some(format!("tab={tab_id} {url}")),
			Self::NewTab { tab_id, url } => Some(format!("tab={tab_id} {url}")),
			Self::ProxyFailed { tab_id, url } => Some(format!("tab={tab_id} {url}")),
			Self::OpenPanel { url } => Some(url.clone()),
			Self::Closed { tab_id } => Some(format!("tab={tab_id}")),
			_ => None,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn bounds_round_trip_with_the_panel() {
		let bounds = ViewBounds {
			x: 1.0,
			y: 2.0,
			width: 30.0,
			height: 400.0,
			viewport_width: 100.0,
		};
		assert_eq!(bounds.parts(), (1.0, 2.0, 30.0, 400.0, 100.0));
		let json = serde_json::to_string(&bounds).unwrap();
		assert!(json.contains("\"viewportWidth\":100.0"), "{json}");
		let back: ViewBounds = serde_json::from_str(&json).unwrap();
		assert_eq!(back.width, bounds.width);
	}
}

//! Opening a folder handed to the app by the OS.
//!
//! Three entry points feed one path: a `file://` URL delivered through
//! `RunEvent::Opened` (macOS Finder "Open With"), a path argument on the
//! command line (Windows Explorer verb, Linux `.desktop` handler, terminal),
//! and the `A_CODER_DESKTOP_WORKSPACE` environment variable used by
//! `a-coder-cli --desktop`.
//!
//! A fresh launch resolves the path through [`initial`] before the frontend
//! boots. An already-running app receives it as [`OPEN_EVENT`] and the
//! frontend switches workspaces without restarting the engine.

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Event carrying a folder the OS asked this app to open.
pub const OPEN_EVENT: &str = "desktop://open-workspace";

static PENDING: Mutex<Option<String>> = Mutex::new(None);

/// Accept only an existing directory. Handles plain paths and `file://` URLs.
pub fn normalize(raw: &str) -> Option<String> {
	let trimmed = raw.trim();
	if trimmed.is_empty() || trimmed.starts_with('-') {
		return None;
	}
	let path: PathBuf = if trimmed.starts_with("file://") {
		url::Url::parse(trimmed).ok()?.to_file_path().ok()?
	} else {
		PathBuf::from(trimmed)
	};
	if !path.is_dir() {
		return None;
	}
	let resolved = path.canonicalize().unwrap_or(path);
	Some(resolved.to_string_lossy().into_owned())
}

/// Remember a path for the next [`initial`] call.
pub fn remember(raw: &str) {
	if let Some(path) = normalize(raw) {
		*PENDING.lock().unwrap() = Some(path);
	}
}

/// Peeks without consuming: the frontend may resolve its workspace twice
/// (StrictMode, reload) and must see the same folder both times.
fn peek() -> Option<String> {
	PENDING.lock().unwrap().clone()
}

/// The workspace a launch should open: the CLI launcher's env var, a path the
/// OS handed this process, or the first directory argument.
pub fn initial() -> Option<String> {
	std::env::var("A_CODER_DESKTOP_WORKSPACE")
		.ok()
		.and_then(|value| normalize(&value))
		.or_else(peek)
		.or_else(|| std::env::args().skip(1).find_map(|arg| normalize(&arg)))
}

/// Deliver a folder to the running app: remembered for a later boot and
/// emitted to the frontend now. Returns false when the argument is not a
/// directory (e.g. an unrelated command-line flag).
pub fn deliver(app: &AppHandle, raw: &str) -> bool {
	let Some(path) = normalize(raw) else {
		return false;
	};
	remember(&path);
	let _ = app.emit(OPEN_EVENT, path);
	true
}

/// Bring the main window forward. A second launch without a path argument
/// (a plain double-click on the app icon) should still surface the running
/// window instead of appearing to do nothing.
pub fn focus_main(app: &AppHandle) {
	if let Some(window) = app.get_webview_window("main") {
		let _ = window.unminimize();
		let _ = window.show();
		let _ = window.set_focus();
	}
}

/// Windows Explorer integration: "Open with A-Coder Desktop" on a folder and
/// on the background of an open folder. HKCU, no elevation, idempotent.
#[cfg(windows)]
pub fn register_explorer_verbs() {
	use winreg::enums::HKEY_CURRENT_USER;
	use winreg::RegKey;

	let Ok(exe) = std::env::current_exe() else {
		return;
	};
	let exe = exe.to_string_lossy().into_owned();
	let hkcu = RegKey::predef(HKEY_CURRENT_USER);
	for (key, argument) in [
		(r"Software\Classes\Directory\shell\ACoderDesktop", "%1"),
		(r"Software\Classes\Directory\Background\shell\ACoderDesktop", "%V"),
	] {
		let Ok((verb, _)) = hkcu.create_subkey(key) else {
			continue;
		};
		let _ = verb.set_value("", &"Open with A-Coder Desktop");
		let _ = verb.set_value("Icon", &exe);
		if let Ok((command, _)) = hkcu.create_subkey(format!("{key}\\command")) {
			let _ = command.set_value("", &format!("\"{exe}\" \"{argument}\""));
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rejects_flags_and_missing_paths() {
		assert_eq!(normalize("--flag"), None);
		assert_eq!(normalize(""), None);
		assert_eq!(normalize("/definitely/not/a/directory"), None);
	}

	#[test]
	fn accepts_a_directory_and_resolves_file_urls() {
		let dir = std::env::temp_dir();
		let plain = normalize(dir.to_string_lossy().as_ref()).expect("temp dir opens");
		assert!(PathBuf::from(&plain).is_dir());
		let url = url::Url::from_directory_path(&dir).expect("file url");
		assert_eq!(normalize(url.as_str()).as_deref(), Some(plain.as_str()));
	}
}

//! macOS privacy (TCC) guidance for filesystem errors.
//!
//! The desktop app and the engine it spawns share one grant, tied to the app's
//! code signature. When macOS denies access it returns `EPERM`
//! ("operation not permitted") for a path the user owns, which reads like a
//! permissions bug. These helpers append the actual cause and the fix.

use std::path::{Path, PathBuf};

/// Guarded folders under the user's home directory, with their display names.
#[cfg(target_os = "macos")]
const GUARDED_FOLDERS: [(&str, &str); 7] = [
	("Desktop", "Desktop"),
	("Documents", "Documents"),
	("Downloads", "Downloads"),
	("Movies", "Movies"),
	("Music", "Music"),
	("Pictures", "Pictures"),
	("Library/Mobile Documents", "iCloud Drive"),
];

/// Hint explaining how to restore access, when `path` is in a guarded folder.
#[cfg(target_os = "macos")]
pub fn privacy_hint(path: &Path) -> Option<String> {
	let home = PathBuf::from(std::env::var_os("HOME")?);
	for (sub, label) in GUARDED_FOLDERS {
		let root = home.join(sub);
		if path == root || path.starts_with(&root) {
			return Some(format!(
				"macOS is blocking access to ~/{label}. Open System Settings → Privacy & Security → Files and Folders (or Full Disk Access), enable access for A-Coder Desktop, then restart it."
			));
		}
	}
	None
}

#[cfg(not(target_os = "macos"))]
pub fn privacy_hint(_path: &Path) -> Option<String> {
	None
}

/// Format a filesystem failure, adding the privacy hint when macOS denied access.
pub fn fs_error(path: &Path, message: String, error: &std::io::Error) -> String {
	let mut message = message;
	if error.kind() == std::io::ErrorKind::PermissionDenied {
		if let Some(hint) = privacy_hint(path) {
			message.push('\n');
			message.push_str(&hint);
		}
	}
	message
}

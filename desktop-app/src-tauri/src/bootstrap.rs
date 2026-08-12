//! First-launch CLI bootstrap.
//!
//! When the desktop app can't find `a-coder-cli` on PATH (a fresh install with
//! only the desktop app, not the CLI), this downloads the matching
//! `pi-<platform>-<arch>` archive from the GitHub release and installs it into
//! `~/.a-coder/lib/a-coder-cli/` + a `a-coder-cli` command in `~/.a-coder/bin/`,
//! mirroring `install-a-coder.sh`. The frontend boot-failure card exposes a
//! one-click "Install the A-Coder CLI engine" button that calls this command
//! and retries the connect.

use std::path::{Path, PathBuf};

use serde::Deserialize;

const REPO: &str = "hamishfromatech/pi-mono";

#[derive(Deserialize)]
struct Release {
	tag_name: String,
}

/// Download + install the a-coder-cli engine into `~/.a-coder` when the desktop
/// app can't find it on PATH. Returns the resolved path to the `pi` binary so
/// the frontend can immediately retry the connect with it.
#[tauri::command]
pub async fn bootstrap_cli() -> Result<String, String> {
	// Already resolvable? Nothing to do — return the existing path.
	if let Ok(p) = crate::cli::resolve_cli_path(None) {
		return Ok(p.display().to_string());
	}

	let install_dir = a_coder_dir();
	let lib_dir = install_dir.join("lib").join("a-coder-cli");
	let bin_dir = install_dir.join("bin");

	// Resolve the "latest" release tag via the GitHub API.
	let tag = resolve_latest_tag().await?;

	let (platform, arch) = platform_arch();
	let archive_ext = if platform == "windows" { "zip" } else { "tar.gz" };
	let asset = format!("pi-{}-{}.{}", platform, arch, archive_ext);
	let url = format!("https://github.com/{}/releases/download/{}/{}", REPO, tag, asset);

	// Download to a temp file.
	let tmp = std::env::temp_dir().join(format!("ac-bootstrap-{}-{}", tag, asset));
	download(&url, &tmp).await?;

	// Clear + recreate the lib dir.
	let _ = std::fs::remove_dir_all(&lib_dir);
	std::fs::create_dir_all(&lib_dir).map_err(|e| e.to_string())?;

	// Extract: shell out to `tar` (cross-platform — Windows 10 1803+ ships
	// tar.exe and can read both tarballs and zips). The tarball wraps its
	// contents in a top-level `pi/` dir; strip it so the binary + assets land
	// directly in lib_dir.
	if archive_ext == "zip" {
		extract_zip(&tmp, &lib_dir)?;
	} else {
		extract_tarball(&tmp, &lib_dir)?;
	}
	let _ = std::fs::remove_file(&tmp);

	// Locate the compiled binary.
	let bin_name = if platform == "windows" { "pi.exe" } else { "pi" };
	let binary = lib_dir.join(bin_name);
	if !binary.is_file() {
		return Err(format!(
			"Binary not found after extraction: {}. Archive contents: {:?}",
			binary.display(),
			std::fs::read_dir(&lib_dir)
				.map(|d| d
					.filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
					.collect::<Vec<_>>())
				.unwrap_or_default()
		));
	}

	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		let _ = std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755));
	}

	// Create the command shim/symlink in bin_dir so future PATH lookups find it.
	std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
	let command = bin_dir.join(if platform == "windows" {
		"a-coder-cli.cmd".to_string()
	} else {
		"a-coder-cli".to_string()
	});
	if platform == "windows" {
		let rel = "@\"%~dp0..\\lib\\a-coder-cli\\pi.exe\" %*\r\n";
		std::fs::write(&command, rel).map_err(|e| e.to_string())?;
	} else {
		let _ = std::fs::remove_file(&command);
		#[cfg(unix)]
		{
			use std::os::unix::fs::symlink;
			symlink("../lib/a-coder-cli/pi", &command)
				.map_err(|e| format!("Failed to symlink a-coder-cli: {}", e))?;
		}
	}

	// Persist a version marker (matches install-a-coder.sh).
	let _ = std::fs::write(install_dir.join("VERSION"), &tag);

	Ok(binary.display().to_string())
}

async fn resolve_latest_tag() -> Result<String, String> {
	let url = format!("https://api.github.com/repos/{}/releases/latest", REPO);
	let client = reqwest::Client::builder()
		.user_agent("a-coder-desktop")
		.build()
		.map_err(|e| e.to_string())?;
	let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
	if !resp.status().is_success() {
		return Err(format!("GitHub API returned status {}", resp.status()));
	}
	let rel: Release = resp.json().await.map_err(|e| e.to_string())?;
	Ok(rel.tag_name)
}

async fn download(url: &str, out: &Path) -> Result<(), String> {
	let client = reqwest::Client::builder()
		.user_agent("a-coder-desktop")
		.build()
		.map_err(|e| e.to_string())?;
	let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
	if !resp.status().is_success() {
		return Err(format!("Download failed (status {})", resp.status()));
	}
	let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
	std::fs::write(out, &bytes).map_err(|e| e.to_string())?;
	Ok(())
}

fn extract_tarball(archive: &Path, dest: &Path) -> Result<(), String> {
	let out = std::process::Command::new("tar")
		.arg("-xzf")
		.arg(archive)
		.arg("-C")
		.arg(dest)
		.arg("--strip-components=1")
		.output()
		.map_err(|e| format!("failed to run tar: {}", e))?;
	if !out.status.success() {
		return Err(format!(
			"tar extraction failed: {}",
			String::from_utf8_lossy(&out.stderr)
		));
	}
	Ok(())
}

/// Extract a zip. Prefer `unzip`; fall back to `tar -xf` (Windows 10+ tar.exe
/// can read zip archives).
fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
	let out = std::process::Command::new("unzip")
		.arg("-qo")
		.arg(archive)
		.arg("-d")
		.arg(dest)
		.output();
	match out {
		Ok(o) if o.status.success() => Ok(()),
		_ => {
			let out2 = std::process::Command::new("tar")
				.arg("-xf")
				.arg(archive)
				.arg("-C")
				.arg(dest)
				.output()
				.map_err(|e| format!("failed to run tar for zip: {}", e))?;
			if out2.status.success() {
				Ok(())
			} else {
				Err(format!(
					"zip extraction failed: {}",
					String::from_utf8_lossy(&out2.stderr)
				))
			}
		}
	}
}

fn a_coder_dir() -> PathBuf {
	let home = if cfg!(windows) {
		std::env::var("USERPROFILE").unwrap_or_default()
	} else {
		std::env::var("HOME").unwrap_or_default()
	};
	PathBuf::from(home).join(".a-coder")
}

fn platform_arch() -> (String, String) {
	let platform = if cfg!(target_os = "macos") {
		"darwin"
	} else if cfg!(target_os = "windows") {
		"windows"
	} else if cfg!(target_os = "linux") {
		"linux"
	} else {
		std::env::consts::OS
	};
	let arch = if cfg!(target_arch = "x86_64") {
		"x64"
	} else if cfg!(target_arch = "aarch64") {
		"arm64"
	} else {
		std::env::consts::ARCH
	};
	(platform.to_string(), arch.to_string())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn platform_arch_matches_release_naming() {
		let (p, _a) = platform_arch();
		assert!(matches!(p.as_str(), "darwin" | "linux" | "windows"));
	}

	#[test]
	fn a_coder_dir_under_home() {
		let dir = a_coder_dir();
		assert!(dir.ends_with(".a-coder"));
	}
}
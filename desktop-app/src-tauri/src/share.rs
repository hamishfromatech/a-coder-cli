use std::process::Command;

use serde::{Deserialize, Serialize};

/// Arguments for sharing a session file as a secret GitHub gist.
#[derive(Debug, Deserialize)]
pub struct ShareGistArgs {
	/// Absolute path to the JSONL file to share.
	pub path: String,
	/// Optional public flag (default: secret/private).
	pub public: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ShareGistResult {
	pub url: String,
}

/// Share a file as a GitHub gist using the `gh` CLI. Requires `gh` on PATH and
/// an authenticated GitHub account (`gh auth login`).
#[tauri::command]
pub async fn share_session_gist(args: ShareGistArgs) -> Result<ShareGistResult, String> {
	// Validate gh is available before attempting the upload so we can return a
	// helpful error message instead of a raw spawn failure.
	let which = Command::new("which").arg("gh").output();
	let gh_missing = match which {
		Ok(out) => !out.status.success() || out.stdout.is_empty(),
		Err(_) => true,
	};
	if gh_missing {
		return Err(
			"GitHub CLI (`gh`) not found on PATH. Install it and run `gh auth login` to share sessions."
				.to_string(),
		);
	}

	let mut cmd = Command::new("gh");
	cmd.arg("gist").arg("create").arg(&args.path);
	if args.public.unwrap_or(false) {
		cmd.arg("--public");
	} else {
		cmd.arg("--secret");
	}

	let output = cmd
		.output()
		.map_err(|e| format!("Failed to run `gh gist create`: {e}"))?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
		let msg = if !stderr.is_empty() { stderr } else { stdout };
		return Err(if msg.is_empty() {
			"`gh gist create` failed".to_string()
		} else {
			msg
		});
	}

	// `gh gist create` prints the gist URL to stdout.
	let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if url.is_empty() {
		return Err("`gh gist create` did not return a URL".to_string());
	}
	Ok(ShareGistResult { url })
}
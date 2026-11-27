use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
	Modified,
	Added,
	Deleted,
	Renamed,
	Untracked,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitFileChange {
	pub path: String,
	pub status: FileStatus,
	/// True when the change is staged in the index; false when only the working tree has it.
	pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitBranch {
	pub name: String,
	pub ahead: u32,
	pub behind: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitStatus {
	pub branch: Option<GitBranch>,
	pub staged: Vec<GitFileChange>,
	pub unstaged: Vec<GitFileChange>,
	pub untracked: Vec<GitFileChange>,
}

/// Run `git status --porcelain=v1 --branch` inside `cwd` and parse the result.
/// Errors with a string if git is missing or the directory is not a repo.
#[tauri::command]
pub fn git_status(cwd: String) -> Result<GitStatus, String> {
	let cwd_path = Path::new(&cwd);
	if !cwd_path.exists() {
		return Err(format!("Directory does not exist: {cwd}"));
	}

	let output = Command::new("git")
		.args([
			"status",
			"--porcelain=v1",
			"--branch",
			"--untracked-files=normal",
		])
		.current_dir(cwd_path)
		.output()
		.map_err(|e| format!("Failed to invoke git: {e}. Is git installed and on PATH?"))?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		// An empty stderr with non-zero status usually means not a git repo.
		if stderr.is_empty() {
			return Err("Not a git repository (or no git binary on PATH)".to_string());
		}
		return Err(stderr);
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	parse_git_status(&stdout)
}

/// Content of a path at a revision, for the IDE's diff view.
/// `rev` is "HEAD" (last commit) or "index" (staged snapshot). A missing blob
/// (new/deleted file) is `None`, which the viewer renders as an empty side.
#[tauri::command]
pub fn git_file_content(cwd: String, path: String, rev: String) -> Result<Option<String>, String> {
	let cwd_path = Path::new(&cwd);
	if !cwd_path.exists() {
		return Err(format!("Directory does not exist: {cwd}"));
	}
	let spec = if rev == "index" {
		format!(":{path}")
	} else {
		format!("HEAD:{path}")
	};
	let output = Command::new("git")
		.args(["show", &spec])
		.current_dir(cwd_path)
		.output()
		.map_err(|e| format!("Failed to invoke git: {e}. Is git installed and on PATH?"))?;
	if !output.status.success() {
		// New file (index) or deleted file (HEAD): no blob, not an error.
		return Ok(None);
	}
	Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned()))
}

/// Run `git diff [--staged] -- <path>` and return the unified diff text.
/// `staged` controls whether we look at the index or the working tree.
#[tauri::command]
pub fn git_diff(cwd: String, path: String, staged: bool) -> Result<String, String> {
	let cwd_path = Path::new(&cwd);
	if !cwd_path.exists() {
		return Err(format!("Directory does not exist: {cwd}"));
	}

	let mut args: Vec<&str> = vec!["diff"];
	if staged {
		args.push("--staged");
	}
	args.push("--no-color");
	args.push("--");
	args.push(&path);

	let output = Command::new("git")
		.args(&args)
		.current_dir(cwd_path)
		.output()
		.map_err(|e| format!("Failed to invoke git: {e}"))?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		if !stderr.is_empty() {
			return Err(stderr);
		}
	}

	Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_git_status(raw: &str) -> Result<GitStatus, String> {
	let mut branch: Option<GitBranch> = None;
	let mut staged: Vec<GitFileChange> = Vec::new();
	let mut unstaged: Vec<GitFileChange> = Vec::new();
	let mut untracked: Vec<GitFileChange> = Vec::new();

	for line in raw.lines() {
		if line.is_empty() {
			continue;
		}

		// Porcelain v1 header: `## <branch>...<upstream> [ahead N, behind M]`.
		if let Some(rest) = line.strip_prefix("## ") {
			let (name, counts) = match rest.split_once('[') {
				Some((name, counts)) => (name.trim(), Some(counts.trim_end_matches(']'))),
				None => (rest.trim(), None),
			};
			let name = name
				.split_once("...")
				.map(|(local, _upstream)| local)
				.unwrap_or(name)
				.trim();
			let name = name
				.strip_prefix("No commits yet on ")
				.unwrap_or(name)
				.strip_suffix(" (no branch)")
				.unwrap_or(name)
				.trim();
			let (mut ahead, mut behind) = (0u32, 0u32);
			if let Some(counts) = counts {
				for part in counts.split(',') {
					let part = part.trim();
					if let Some(value) = part.strip_prefix("ahead ") {
						ahead = value.trim().parse().unwrap_or(0);
					} else if let Some(value) = part.strip_prefix("behind ") {
						behind = value.trim().parse().unwrap_or(0);
					}
				}
			}
			branch = Some(GitBranch {
				name: if name.is_empty() {
					"HEAD".to_string()
				} else {
					name.to_string()
				},
				ahead,
				behind,
			});
			continue;
		}

		// Ignored files are not part of the working tree.
		if line.starts_with("!! ") {
			continue;
		}

		// Untracked files use '??'.
		if let Some(rest) = line.strip_prefix("?? ") {
			untracked.push(GitFileChange {
				path: rest.to_string(),
				status: FileStatus::Untracked,
				staged: false,
			});
			continue;
		}

		// Porcelain v1 entries are exactly `XY path`: X is index status,
		// Y is working-tree status, and the path follows the first space.
		if line.len() < 4 {
			continue;
		}

		let bytes = line.as_bytes();
		let x = bytes[0] as char;
		let y = bytes[1] as char;
		let raw_path = line[3..].to_string();
		let path = raw_path
			.rsplit_once(" -> ")
			.map(|(_old, new)| new.to_string())
			.unwrap_or(raw_path);

		if x != ' ' && x != '?' {
			if let Some(status) = map_status(x) {
				staged.push(GitFileChange {
					path: path.clone(),
					status,
					staged: true,
				});
			}
		}
		if y != ' ' && y != '?' {
			if let Some(status) = map_status(y) {
				unstaged.push(GitFileChange {
					path,
					status,
					staged: false,
				});
			}
		}
	}

	Ok(GitStatus {
		branch,
		staged,
		unstaged,
		untracked,
	})
}

fn map_status(code: char) -> Option<FileStatus> {
	match code {
		'M' => Some(FileStatus::Modified),
		'A' => Some(FileStatus::Added),
		'D' => Some(FileStatus::Deleted),
		'R' => Some(FileStatus::Renamed),
		'C' => Some(FileStatus::Added),
		'T' => Some(FileStatus::Modified),
		// Unmerged entries (UU/AA/DU/...) still need to surface in the panel.
		'U' => Some(FileStatus::Modified),
		_ => None,
	}
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
	let output = Command::new("git")
		.args(args)
		.current_dir(cwd)
		.output()
		.map_err(|e| format!("Failed to invoke git: {e}. Is git installed and on PATH?"))?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		if stderr.is_empty() {
			return Err("git command failed".to_string());
		}
		return Err(stderr);
	}
	Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Stage the given paths (git add --).
#[tauri::command]
pub fn git_stage(cwd: String, paths: Vec<String>) -> Result<(), String> {
	if paths.is_empty() {
		return Ok(());
	}
	let cwd_path = Path::new(&cwd);
	if !cwd_path.exists() {
		return Err(format!("Directory does not exist: {cwd}"));
	}
	let mut args: Vec<&str> = vec!["add", "--"];
	for path in &paths {
		args.push(path);
	}
	run_git(cwd_path, &args).map(|_out| ())
}

/// Unstage the given paths (git reset HEAD --). Works on empty-repo index too.
#[tauri::command]
pub fn git_unstage(cwd: String, paths: Vec<String>) -> Result<(), String> {
	if paths.is_empty() {
		return Ok(());
	}
	let cwd_path = Path::new(&cwd);
	if !cwd_path.exists() {
		return Err(format!("Directory does not exist: {cwd}"));
	}
	let mut args: Vec<&str> = vec!["reset", "HEAD", "--"];
	for path in &paths {
		args.push(path);
	}
	run_git(cwd_path, &args).map(|_out| ())
}

/// Discard working-tree changes to a tracked path (git checkout -- path).
#[tauri::command]
pub fn git_discard(cwd: String, path: String) -> Result<(), String> {
	let cwd_path = Path::new(&cwd);
	if !cwd_path.exists() {
		return Err(format!("Directory does not exist: {cwd}"));
	}
	run_git(cwd_path, &["checkout", "--", &path]).map(|_out| ())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_porcelain_v1_branch_and_tracked_changes() {
		let raw = concat!(
			"## feat/desktop-unified-release...origin/feat/desktop-unified-release [ahead 5, behind 97]\n",
			" M desktop-app/src/App.tsx\n",
			"M  desktop-app/src/main.ts\n",
			"?? desktop-app/src/launch.ts\n",
			"!! dist/generated.js\n",
		);
		let status = parse_git_status(raw).expect("parse status");
		let branch = status.branch.expect("branch");
		assert_eq!(branch.name, "feat/desktop-unified-release");
		assert_eq!(branch.ahead, 5);
		assert_eq!(branch.behind, 97);
		assert_eq!(status.unstaged.len(), 1);
		assert_eq!(status.unstaged[0].path, "desktop-app/src/App.tsx");
		assert_eq!(status.unstaged[0].status, FileStatus::Modified);
		assert_eq!(status.staged.len(), 1);
		assert_eq!(status.staged[0].path, "desktop-app/src/main.ts");
		assert_eq!(status.staged[0].status, FileStatus::Modified);
		assert_eq!(status.untracked.len(), 1);
		assert_eq!(status.untracked[0].path, "desktop-app/src/launch.ts");
	}

	#[test]
	fn parses_renames_and_detached_head() {
		let raw = concat!(
			"## HEAD (no branch)\n",
			"R  old/name.ts -> desktop-app/src/new-name.ts\n",
			"?? notes.md\n",
		);
		let status = parse_git_status(raw).expect("parse status");
		assert_eq!(status.branch.expect("branch").name, "HEAD");
		assert_eq!(status.staged.len(), 1);
		assert_eq!(status.staged[0].path, "desktop-app/src/new-name.ts");
		assert_eq!(status.staged[0].status, FileStatus::Renamed);
		assert_eq!(status.untracked[0].path, "notes.md");
	}

	#[test]
	fn parses_branch_without_upstream() {
		let status = parse_git_status("## main\n").expect("parse status");
		let branch = status.branch.expect("branch");
		assert_eq!(branch.name, "main");
		assert_eq!(branch.ahead, 0);
		assert_eq!(branch.behind, 0);
	}
}

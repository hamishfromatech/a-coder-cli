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

/// Run `git status --porcelain=v2 --branch` inside `cwd` and parse the result.
/// Errors with a string if git is missing or the directory is not a repo.
#[tauri::command]
pub fn git_status(cwd: String) -> Result<GitStatus, String> {
    let cwd_path = Path::new(&cwd);
    if !cwd_path.exists() {
        return Err(format!("Directory does not exist: {cwd}"));
    }

    let output = Command::new("git")
        .args(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"])
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

        // Branch header lines start with '#' and look like:
        //   # branch.alias main
        //   # branch.ab +0 -0
        if let Some(rest) = line.strip_prefix("# ") {
            if let Some(branch_name) = rest.strip_prefix("branch.alias ") {
                branch = Some(GitBranch {
                    name: branch_name.trim().to_string(),
                    ahead: branch.as_ref().map(|b| b.ahead).unwrap_or(0),
                    behind: branch.as_ref().map(|b| b.behind).unwrap_or(0),
                });
            } else if let Some(ab) = rest.strip_prefix("branch.ab ") {
                let mut ahead = 0u32;
                let mut behind = 0u32;
                for token in ab.split_whitespace() {
                    if let Some(n) = token.strip_prefix('+') {
                        ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = token.strip_prefix('-') {
                        behind = n.parse().unwrap_or(0);
                    }
                }
                if let Some(b) = branch.as_mut() {
                    b.ahead = ahead;
                    b.behind = behind;
                } else {
                    // branch line came after ab line; create a placeholder
                    branch = Some(GitBranch {
                        name: "HEAD".to_string(),
                        ahead,
                        behind,
                    });
                }
            }
            continue;
        }

        // Untracked files use '?' prefix.
        if let Some(rest) = line.strip_prefix("? ") {
            untracked.push(GitFileChange {
                path: rest.to_string(),
                status: FileStatus::Untracked,
                staged: false,
            });
            continue;
        }

        // The X/Y porcelain-v2 format: e.g. "1 M.", "2 A.", "1 .M", "1 R."
        // X is the index status, Y is the working-tree status.
        // We treat ' ' as "no change" and parse the rest as 2-char codes.
        if line.len() < 4 {
            continue;
        }

        let bytes = line.as_bytes();
        let x = bytes[1] as char;
        let y = bytes[2] as char;
        let path = line[3..].to_string();

        // Index change (staged)
        if x != ' ' && x != '?' {
            if let Some(status) = map_status(x) {
                staged.push(GitFileChange {
                    path: path.clone(),
                    status,
                    staged: true,
                });
            }
        }
        // Working-tree change (unstaged)
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
        _ => None,
    }
}

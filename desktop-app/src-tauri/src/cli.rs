use std::path::PathBuf;

/// Workspace path forwarded by the `pi --desktop` CLI launcher via the
/// `A_CODER_DESKTOP_WORKSPACE` environment variable. Returns `None` when the
/// desktop app was launched normally (no workspace preselected), so the
/// frontend falls back to the persisted project or the picker.
#[tauri::command]
pub fn get_initial_workspace() -> Option<String> {
    std::env::var("A_CODER_DESKTOP_WORKSPACE")
        .ok()
        .filter(|s| !s.is_empty())
}

/// Resolve the a-coder-cli executable from PATH, with an optional override.
pub fn resolve_cli_path(override_path: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = override_path {
        let p = PathBuf::from(path);
        if p.exists() {
            return Ok(p);
        }
        return Err(format!("Configured CLI path does not exist: {}", p.display()));
    }

    // Try the canonical command name first, then the npm global binary name.
    for name in ["a-coder-cli", "pi"] {
        if let Ok(path) = which::which(name) {
            return Ok(path);
        }
    }

    // GUI apps on macOS do not inherit the user's shell PATH, so `which::which`
    // frequently fails to find globally installed CLIs. Reconstruct the likely
    // PATH and common npm global bin directories as fallbacks.
    let candidate_dirs = candidate_bin_dirs();
    let names = cli_names();
    for name in &names {
        for dir in &candidate_dirs {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // Bootstrap fallback: the desktop app's first-launch CLI installer (and the
    // curl install-a-coder.sh / Install-A-Coder.ps1 scripts) place the binary at
    // ~/.a-coder/lib/a-coder-cli/pi and a shim at ~/.a-coder/bin/a-coder-cli.
    // Check both so a fresh install (CLI bootstrapped by the desktop app itself)
    // is found without a terminal restart.
    let suffix = std::env::consts::EXE_SUFFIX;
    if let Some(a_coder_dir) = a_coder_install_dir() {
        let lib_bin = a_coder_dir
            .join("lib")
            .join("a-coder-cli")
            .join(format!("pi{}", suffix));
        if lib_bin.is_file() {
            return Ok(lib_bin);
        }
        let shim_bin = a_coder_dir.join("bin").join(format!("a-coder-cli{}", suffix));
        if shim_bin.is_file() {
            return Ok(shim_bin);
        }
    }

    // Development fallback: when the desktop app is run from inside the monorepo,
    // a-coder-cli lives at <parent-of-cwd>/packages/coding-agent/dist/cli.js.
    // This lets `npm run tauri:dev` and direct binary launches find the local
    // CLI even when the shell PATH is not set up.
    if let Some(sibling) = sibling_workspace_cli_path() {
        if sibling.is_file() {
            return Ok(sibling);
        }
    }

    let searched = candidate_dirs
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "a-coder-cli not found in PATH. Searched: {searched}. Install it globally or set a CLI path override."
    ))
}

/// Reconstruct a PATH-like string that includes the current process PATH, the
/// user's shell PATH (on Unix), and common npm global bin directories. GUI
/// apps on macOS inherit a minimal PATH, so this is used both to discover the
/// CLI and to spawn `node` with the correct environment.
pub fn reconstructed_path() -> String {
    let mut dirs = Vec::new();

    // 1. Directories from the current process PATH.
    if let Ok(path_var) = std::env::var("PATH") {
        let sep = path_separator();
        for part in path_var.split(sep) {
            dirs.push(PathBuf::from(part));
        }
    }

    // 2. Try to reconstruct the user's shell PATH on Unix systems.
    #[cfg(unix)]
    if let Some(shell_path) = user_shell_path() {
        for part in shell_path.split(':') {
            dirs.push(PathBuf::from(part));
        }
    }

    // 3. Common npm global bin directories.
    let common = [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "~/.holaboss/node/bin",
        "~/.npm-global/bin",
        "~/.config/npm/node_global/bin",
        "~/.local/bin",
        "~/.yarn/bin",
        "~/.a-coder/bin",
        "~/.config/yarn/global/node_modules/.bin",
        "/usr/local/lib/node_modules/.bin",
        "/opt/homebrew/lib/node_modules/.bin",
    ];
    for raw in &common {
        dirs.push(expand_home(raw));
    }

    // 4. nvm installs.
    if let Ok(home) = std::env::var("HOME") {
        let nvm_versions = PathBuf::from(&home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin");
                if bin.is_dir() {
                    dirs.push(bin);
                }
            }
        }
    }

    // Deduplicate while preserving order.
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));

    let sep = path_separator();
    dirs.iter()
        .map(|p| p.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(&sep.to_string())
}

fn path_separator() -> char {
    if cfg!(windows) { ';' } else { ':' }
}

/// Produce a list of likely directories that could contain the a-coder-cli
/// executable. This includes the current process PATH, the user's shell PATH,
/// and common npm global install locations across macOS/Linux/Windows.
fn candidate_bin_dirs() -> Vec<PathBuf> {
    reconstructed_path()
        .split(path_separator())
        .map(PathBuf::from)
        .collect()
}

/// Run the user's default shell in non-interactive mode to capture its PATH.
#[cfg(unix)]
fn user_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        #[cfg(target_os = "macos")]
        return "/bin/zsh".into();
        #[cfg(not(target_os = "macos"))]
        return "/bin/sh".into();
    });

    let output = std::process::Command::new(&shell)
        .arg("-c")
        .arg("echo $PATH")
        .output()
        .ok()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Some(path);
        }
    }

    None
}

/// Look for a sibling workspace copy of a-coder-cli relative to the current
/// working directory. This supports running the desktop app directly from the
/// `desktop-app` folder in the monorepo without requiring a global install.
fn sibling_workspace_cli_path() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let workspace_root = cwd.parent()?;
    Some(workspace_root.join("packages").join("coding-agent").join("dist").join("cli.js"))
}

/// The ~/.a-coder install dir used by install-a-coder.sh / Install-A-Coder.ps1
/// and the desktop app's own first-launch bootstrap. Returns None if the home
/// dir can't be determined.
fn a_coder_install_dir() -> Option<PathBuf> {
	let home = (if cfg!(windows) {
		std::env::var("USERPROFILE").ok()
	} else {
		std::env::var("HOME").ok()
	})?;
	if home.is_empty() {
		return None;
	}
	Some(PathBuf::from(home).join(".a-coder"))
}

/// Expand a leading `~` to the user's home directory.
fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

/// Possible CLI executable names, including platform-specific extensions.
fn cli_names() -> Vec<String> {
    let suffix = std::env::consts::EXE_SUFFIX;
    ["a-coder-cli", "pi"]
        .iter()
        .map(|name| {
            if suffix.is_empty() {
                name.to_string()
            } else {
                format!("{}{}", name, suffix)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::tempdir;

    #[test]
    fn test_resolve_cli_path_with_override() {
        let dir = tempdir().expect("Failed to create temp dir");
        let file_path = dir.path().join("a-coder-cli");
        File::create(&file_path).expect("Failed to create file");

        let result = resolve_cli_path(Some(file_path.to_string_lossy().to_string()));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), file_path);
    }

    #[test]
    fn test_resolve_cli_path_override_not_found() {
        let result = resolve_cli_path(Some("/nonexistent/path/to/cli".to_string()));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Configured CLI path does not exist"));
    }

    #[test]
    fn test_expand_home() {
        let result = expand_home("~/test/path");
        // Should expand ~ to $HOME if set
        if let Ok(home) = std::env::var("HOME") {
            assert!(result.starts_with(&home));
        }
    }

    #[test]
    fn test_expand_home_no_tilde() {
        let result = expand_home("/absolute/path");
        assert_eq!(result, PathBuf::from("/absolute/path"));
    }

    #[test]
    fn test_cli_names_includes_a_coder_cli() {
        let names = cli_names();
        assert!(names.iter().any(|n| n.starts_with("a-coder-cli")));
    }

    #[test]
    fn test_cli_names_includes_pi() {
        let names = cli_names();
        assert!(names.iter().any(|n| n.starts_with("pi")));
    }

    #[test]
    fn test_path_separator() {
        let sep = path_separator();
        #[cfg(target_os = "windows")]
        assert_eq!(sep, ';');
        #[cfg(not(target_os = "windows"))]
        assert_eq!(sep, ':');
    }

    #[test]
    fn test_reconstructed_path_is_non_empty() {
        let path = reconstructed_path();
        assert!(!path.is_empty());
    }

    #[test]
    fn test_reconstructed_path_contains_common_dirs() {
        let path = reconstructed_path();
        // Should contain standard bin directories on Unix
        #[cfg(unix)]
        {
            assert!(path.contains("/usr/local/bin") || path.contains("/opt/homebrew/bin"));
        }
    }

    #[test]
    fn test_candidate_bin_dirs_returns_vec() {
        let dirs = candidate_bin_dirs();
        assert!(!dirs.is_empty());
    }
}

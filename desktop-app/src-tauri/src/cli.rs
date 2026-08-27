use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

/// On Windows, prevent a console window from flashing up when the GUI app
/// spawns the CLI (and the CLI's child MCP servers / skill CLIs). On other
/// platforms this is a no-op.
#[cfg(windows)]
fn suppress_console(cmd: &mut Command) {
	use std::os::windows::process::CommandExt;
	const CREATE_NO_WINDOW: u32 = 0x0800_0000;
	cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn suppress_console(_cmd: &mut Command) {}

/// Read the first `len` bytes of a file, returning an empty slice on failure.
fn read_file_header(path: &Path, len: usize) -> Vec<u8> {
	let mut buf = vec![0u8; len];
	if let Ok(mut file) = std::fs::File::open(path) {
		if let Ok(n) = file.read(&mut buf) {
			buf.truncate(n);
			return buf;
		}
	}
	buf.truncate(0);
	buf
}

/// Detect native executables by their file header.
fn is_executable_binary(path: &Path) -> bool {
	if let Some(ext) = path.extension() {
		if ext.to_string_lossy().eq_ignore_ascii_case("exe") {
			return true;
		}
	}
	let header = read_file_header(path, 32);
	if header.starts_with(b"\x7fELF") || header.starts_with(b"MZ") {
		return true;
	}
	if header.len() >= 4 {
		let magic = u32::from_ne_bytes([header[0], header[1], header[2], header[3]]);
		const MH_MAGIC_64: u32 = 0xfeedfacf;
		const MH_MAGIC: u32 = 0xfeedface;
		const FAT_MAGIC: u32 = 0xcafebabe;
		const FAT_MAGIC_64: u32 = 0xbebafeca;
		if magic == MH_MAGIC_64 || magic == MH_MAGIC || magic == FAT_MAGIC || magic == FAT_MAGIC_64 {
			return true;
		}
		let magic_be = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
		if magic_be == FAT_MAGIC || magic_be == FAT_MAGIC_64 {
			return true;
		}
	}
	false
}

/// Detect JS/shebang scripts that must be executed through Node.
fn is_node_script(path: &Path) -> bool {
	if let Some(ext) = path.extension() {
		let ext = ext.to_string_lossy().to_lowercase();
		if matches!(ext.as_str(), "js" | "mjs" | "cjs" | "ts") {
			return true;
		}
	}
	let header = read_file_header(path, 256);
	if header.starts_with(b"#!") {
		if let Ok(line) = std::str::from_utf8(header.split(|&b| b == b'\n').next().unwrap_or(&header)) {
			return line.contains("node");
		}
	}
	false
}

/// If `path` is a Windows batch shim that delegates to a release binary next
/// to it, return the binary path so the desktop can own the process directly.
/// Handles both shim layouts: the product-nested one
/// (`~/.a-coder/cli/bin/a-coder-cli.cmd` -> `../lib/a-coder-cli/pi.exe`) and
/// the legacy one (`~/.a-coder/bin/a-coder-cli.cmd` ->
/// `../cli/lib/a-coder-cli/pi.exe`).
fn resolve_windows_release_binary(path: &Path) -> Option<PathBuf> {
	let ext = path.extension()?.to_string_lossy().to_lowercase();
	if ext != "cmd" && ext != "bat" {
		return None;
	}
	let shim_dir = path.parent()?;
	for rel in ["../lib/a-coder-cli", "../cli/lib/a-coder-cli"] {
		let candidate = shim_dir
			.join(rel)
			.join(format!("pi{}", std::env::consts::EXE_SUFFIX));
		if candidate.is_file() {
			return Some(candidate);
		}
	}
	None
}

/// Build a `Command` that runs the CLI at `cli_path` with the given arguments.
///
/// The unified release ships a compiled Bun binary (`pi` / `pi.exe`) that must
/// be executed directly, while development/source installs are plain Node
/// scripts (`dist/cli.js`). Windows batch shims are handled via `cmd /c` or,
/// when possible, resolved to the underlying binary.
///
/// GUI apps on macOS and some Linux desktops inherit a minimal `PATH`, so the
/// returned command is always given a reconstructed `PATH` that includes the
/// user's shell PATH, common npm/nvm locations, and the bootstrap install
/// directories. This ensures wrapper scripts that delegate to `node` (or other
/// tools) can resolve the interpreter they need.
pub fn build_cli_command(cli_path: &Path, args: &[String]) -> Result<Command, String> {
	if !cli_path.is_file() {
		return Err(format!("CLI path is not a file: {}", cli_path.display()));
	}

	let mut cmd = build_cli_command_inner(cli_path, args)?;
	suppress_console(&mut cmd);
	cmd.env("PATH", reconstructed_path());
	Ok(cmd)
}

fn build_cli_command_inner(cli_path: &Path, args: &[String]) -> Result<Command, String> {

	if let Some(ext) = cli_path.extension() {
		let ext = ext.to_string_lossy().to_lowercase();
		if ext == "cmd" || ext == "bat" {
			if let Some(binary) = resolve_windows_release_binary(cli_path) {
				let mut cmd = Command::new(binary);
				cmd.args(args);
				return Ok(cmd);
			}
			let mut cmd = Command::new("cmd");
			cmd.arg("/c").arg(cli_path).args(args);
			return Ok(cmd);
		}
	}

	if is_executable_binary(cli_path) {
		let mut cmd = Command::new(cli_path);
		cmd.args(args);
		return Ok(cmd);
	}

	if is_node_script(cli_path) {
		let mut cmd = Command::new("node");
		cmd.arg(cli_path).args(args);
		return Ok(cmd);
	}

	// Fallback: trust the OS to interpret the file (shell scripts, etc.).
	let mut cmd = Command::new(cli_path);
	cmd.args(args);
	Ok(cmd)
}

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

    // Prefer the unified-release Bun binary installed by the desktop bootstrap
    // or the official installer. It lives at ~/.a-coder/cli/lib/a-coder-cli/pi
    // (product-nested; older installs used ~/.a-coder/lib/a-coder-cli) and does
    // not depend on Node, so it is more reliable than PATH-resolved shims
    // (e.g. the ~/.local/bin/a-coder-cli wrapper left by older installs).
    let suffix = std::env::consts::EXE_SUFFIX;
    if let Some(a_coder_dir) = a_coder_install_dir() {
        // Product-nested layout first, then the legacy flat layout.
        let lib_dirs = [
            a_coder_dir.join("cli").join("lib").join("a-coder-cli"),
            a_coder_dir.join("lib").join("a-coder-cli"),
        ];
        for lib_dir in lib_dirs {
            let lib_bin = lib_dir.join(format!("pi{}", suffix));
            if lib_bin.is_file() {
                return Ok(lib_bin);
            }
        }
        let shim_dirs = [a_coder_dir.join("cli").join("bin"), a_coder_dir.join("bin")];
        for shim_dir in shim_dirs {
            let shim_bin = shim_dir.join(format!("a-coder-cli{}", suffix));
            if shim_bin.is_file() {
                return Ok(shim_bin);
            }
        }
    }

    // Try the canonical command name first, then the npm global binary name.
    for name in ["a-coder-cli", "pi"] {
        if let Ok(path) = which::which(name) {
            // On Windows, `which` may find the release `.cmd` shim. Run the
            // underlying binary directly when possible.
            if let Some(binary) = resolve_windows_release_binary(&path) {
                return Ok(binary);
            }
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
        "~/.a-coder/cli/bin",
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

/// The shared ~/.a-coder product root used by install-a-coder.sh /
/// Install-A-Coder.ps1 and the desktop app's own first-launch bootstrap (the
/// CLI itself nests under it at ~/.a-coder/cli). Returns None if the home dir
/// can't be determined.
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

/// Expand a leading `~` to the user's home directory. On Windows, falls back to
/// USERPROFILE when HOME is not set.
fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = if cfg!(windows) {
            std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()
        } else {
            std::env::var("HOME").ok()
        };
        if let Some(home) = home {
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
    #[cfg(unix)]
    fn test_build_cli_command_injects_reconstructed_path() {
        let dir = tempdir().expect("Failed to create temp dir");
        let script = dir.path().join("print-path.sh");
        std::fs::write(
            &script,
            "#!/bin/sh\necho \"$PATH\"",
        )
        .expect("Failed to write script");
        let mut perms = std::fs::metadata(&script).expect("Failed to read metadata").permissions();
        use std::os::unix::fs::PermissionsExt;
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).expect("Failed to set permissions");

        let mut cmd = build_cli_command(&script, &[]).expect("build_cli_command failed");
        let output = cmd.output().expect("Failed to run script");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let reconstructed = reconstructed_path();
        for part in reconstructed.split(':') {
            if part.is_empty() {
                continue;
            }
            assert!(
                stdout.contains(part),
                "child PATH missing expected segment {part}\nchild={stdout}\nreconstructed={reconstructed}"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn test_resolve_cli_path_prefers_bootstrap_binary() {
        use std::env;
        let dir = tempdir().expect("Failed to create temp dir");
        let home = dir.path().join("home");
        std::fs::create_dir_all(home.join(".a-coder").join("lib").join("a-coder-cli"))
            .expect("Failed to create bootstrap dirs");
        std::fs::create_dir_all(home.join(".local").join("bin")).expect("Failed to create local/bin");

        let bootstrap_bin = home.join(".a-coder").join("lib").join("a-coder-cli").join("pi");
        let shim = home.join(".local").join("bin").join("a-coder-cli");
        std::fs::write(
            &bootstrap_bin,
            b"",
        )
        .expect("Failed to write bootstrap binary");
        std::fs::write(
            &shim,
            b"#!/bin/sh\n",
        )
        .expect("Failed to write shim");

        let previous_home = env::var("HOME").ok();
        env::set_var("HOME", home.to_string_lossy().to_string());
        let result = resolve_cli_path(None);
        if let Some(prev) = previous_home {
            env::set_var("HOME", prev);
        } else {
            env::remove_var("HOME");
        }

        assert!(result.is_ok(), "{}", result.unwrap_err());
        assert_eq!(result.unwrap(), bootstrap_bin);
    }

    #[test]
    #[cfg(unix)]
    fn test_resolve_cli_path_prefers_nested_layout() {
        use std::env;
        let dir = tempdir().expect("Failed to create temp dir");
        let home = dir.path().join("home");
        // Both layouts present: the product-nested one must win.
        std::fs::create_dir_all(home.join(".a-coder/cli/lib/a-coder-cli"))
            .expect("Failed to create nested dirs");
        std::fs::create_dir_all(home.join(".a-coder/lib/a-coder-cli"))
            .expect("Failed to create legacy dirs");

        let nested_bin = home.join(".a-coder/cli/lib/a-coder-cli/pi");
        let legacy_bin = home.join(".a-coder/lib/a-coder-cli/pi");
        std::fs::write(&nested_bin, b"").expect("Failed to write nested binary");
        std::fs::write(&legacy_bin, b"").expect("Failed to write legacy binary");

        let previous_home = env::var("HOME").ok();
        env::set_var("HOME", home.to_string_lossy().to_string());
        let result = resolve_cli_path(None);
        if let Some(prev) = previous_home {
            env::set_var("HOME", prev);
        } else {
            env::remove_var("HOME");
        }

        assert!(result.is_ok(), "{}", result.unwrap_err());
        assert_eq!(result.unwrap(), nested_bin);
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

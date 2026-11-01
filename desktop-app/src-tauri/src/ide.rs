use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

use crate::cli::reconstructed_path;
use crate::macos_permissions::fs_error;

/// Write a UTF-8 text file for the IDE editor surface (editor save). A hard
/// cap keeps a runaway write from pinning memory; the model's copy in the
/// engine is separate and untouched by this UI path.
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
	if content.len() > 2 * 1024 * 1024 {
		return Err("File too large to write from the editor (2 MiB cap).".to_string());
	}
	let path = std::path::PathBuf::from(&path);
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent)
			.map_err(|e| fs_error(parent, format!("Failed to create parent directory: {e}"), &e))?;
	}
	std::fs::write(&path, content)
		.map_err(|e| fs_error(&path, format!("Failed to write {}", path.display()), &e))
}

// ============================================================================
// File management: create/delete/rename for the explorer surface.
// ============================================================================

#[tauri::command]
pub fn ide_create_dir(path: String) -> Result<(), String> {
	if path.trim().is_empty() {
		return Err("Directory path is empty.".to_string());
	}
	std::fs::create_dir_all(&path).map_err(|e| format!("mkdir failed: {e}"))
}

#[tauri::command]
pub fn ide_create_file(path: String) -> Result<(), String> {
	if path.trim().is_empty() {
		return Err("File path is empty.".to_string());
	}
	let path_buf = std::path::PathBuf::from(&path);
	if path_buf.exists() {
		return Err(format!("Already exists: {}", path_buf.display()));
	}
	if let Some(parent) = path_buf.parent() {
		std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
	}
	std::fs::File::create(&path_buf).map_err(|e| format!("create failed: {e}"))?.sync_all().map_err(|e| format!("sync failed: {e}"))
}

#[tauri::command]
pub fn ide_delete_path(path: String, is_dir: bool) -> Result<(), String> {
	if path.trim().is_empty() {
		return Err("Path is empty.".to_string());
	}
	let result = if is_dir {
		std::fs::remove_dir_all(&path)
	} else {
		std::fs::remove_file(&path)
	};
	result.map_err(|e| format!("delete failed: {e}"))
}

#[tauri::command]
pub fn ide_rename_path(from: String, to: String) -> Result<(), String> {
	if to.trim().is_empty() {
		return Err("New name is empty.".to_string());
	}
	if std::path::Path::new(&to).exists() {
		return Err(format!("Already exists: {to}"));
	}
	std::fs::rename(&from, &to).map_err(|e| format!("rename failed: {e}"))
}

// ============================================================================
// Explorer: one directory level at a time (lazy), plus a flat file index for
// Quick Open. Loading the whole tree up front was the slowest thing the IDE
// did on a real repository; expansion now costs one read_dir, and the index is
// a single bounded walk reused by the picker.
// ============================================================================

const INDEX_SKIP_DIRS: &[&str] = &[
	".git", "node_modules", "target", "dist", "build", ".next", ".cache",
	".turbo", "out", ".venv", "venv", "__pycache__", ".gradle", "vendor",
	"coverage", ".idea", ".vscode-test",
];
const INDEX_MAX_FILES: usize = 20_000;
const INDEX_MAX_DEPTH: u8 = 16;

#[derive(serde::Serialize, Clone, Debug)]
pub struct IdeDirEntry {
	pub path: String,
	pub name: String,
	pub is_dir: bool,
}

/// One directory level, directories first then case-insensitive name order.
#[tauri::command]
pub fn ide_list_dir(path: String) -> Result<Vec<IdeDirEntry>, String> {
	let dir = std::path::PathBuf::from(&path);
	if !dir.is_dir() {
		return Err(format!("Directory does not exist: {path}"));
	}
	let entries = std::fs::read_dir(&dir).map_err(|e| format!("read_dir failed: {e}"))?;
	let mut out: Vec<IdeDirEntry> = Vec::new();
	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().into_owned();
		// Finder metadata is noise in every tree.
		if name == ".DS_Store" {
			continue;
		}
		let Ok(file_type) = entry.file_type() else { continue };
		out.push(IdeDirEntry {
			path: entry.path().to_string_lossy().into_owned(),
			name,
			is_dir: file_type.is_dir(),
		});
	}
	out.sort_by(|a, b| {
		b.is_dir
			.cmp(&a.is_dir)
			.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
	});
	Ok(out)
}

/// Workspace-relative file paths ('/' separators) for Quick Open, bounded by
/// depth and count. The frontend caches this and refreshes it on file events.
#[tauri::command]
pub fn ide_index_files(root: String) -> Result<Vec<String>, String> {
	let root_path = std::path::PathBuf::from(&root);
	if !root_path.is_dir() {
		return Err(format!("Directory does not exist: {root}"));
	}
	let mut out: Vec<String> = Vec::new();
	index_walk(&root_path, &root_path, 0, &mut out);
	Ok(out)
}

fn index_walk(
	dir: &std::path::Path,
	root: &std::path::Path,
	depth: u8,
	out: &mut Vec<String>,
) {
	if depth >= INDEX_MAX_DEPTH || out.len() >= INDEX_MAX_FILES {
		return;
	}
	let Ok(entries) = std::fs::read_dir(dir) else { return };
	for entry in entries.flatten() {
		if out.len() >= INDEX_MAX_FILES {
			return;
		}
		let name = entry.file_name().to_string_lossy().into_owned();
		if name == ".DS_Store" {
			continue;
		}
		let Ok(file_type) = entry.file_type() else { continue };
		let path = entry.path();
		if file_type.is_dir() {
			if INDEX_SKIP_DIRS.contains(&name.as_ref()) {
				continue;
			}
			index_walk(&path, root, depth + 1, out);
		} else if file_type.is_file() {
			if let Ok(relative) = path.strip_prefix(root) {
				out.push(relative.to_string_lossy().replace('\\', "/"));
			}
		}
	}
}

/// Show a path in the OS file manager (Finder / Explorer / file manager).
#[tauri::command]
pub fn ide_reveal_path(path: String) -> Result<(), String> {
	if path.trim().is_empty() {
		return Err("Path is empty.".to_string());
	}
	#[cfg(target_os = "macos")]
	{
		std::process::Command::new("open")
			.arg("-R")
			.arg(&path)
			.spawn()
			.map(|_| ())
			.map_err(|e| format!("reveal failed: {e}"))
	}
	#[cfg(target_os = "windows")]
	{
		std::process::Command::new("explorer")
			.arg(format!("/select,{path}"))
			.spawn()
			.map(|_| ())
			.map_err(|e| format!("reveal failed: {e}"))
	}
	#[cfg(all(unix, not(target_os = "macos")))]
	{
		let target = std::path::PathBuf::from(&path);
		let parent = if target.is_dir() {
			target
		} else {
			target.parent().map(|p| p.to_path_buf()).unwrap_or(target)
		};
		std::process::Command::new("xdg-open")
			.arg(parent)
			.spawn()
			.map(|_| ())
			.map_err(|e| format!("reveal failed: {e}"))
	}
}

// ============================================================================
// Workspace text search: bounded substring scan. The engine's agent does deep
// searching; this backs the IDE quick-search panel where latency matters more
// than recall. Case sensitivity and whole-word matching are the panel's toggles.
// ============================================================================

const SEARCH_SKIP_DIRS: &[&str] = &[
	".git", "node_modules", "target", "dist", "build", ".next", ".cache",
	".turbo", "out", ".venv", "venv", "__pycache__", ".gradle", "vendor",
	"coverage",
];
const SEARCH_MAX_FILE_BYTES: u64 = 512 * 1024;
const SEARCH_MAX_MATCHES: usize = 200;
const SEARCH_MAX_FILES: usize = 6000;

#[derive(serde::Serialize, Clone, Debug)]
pub struct WorkspaceMatch {
	/// Path relative to the search root ('/' separators).
	pub path: String,
	/// 1-based line number.
	pub line: u64,
	/// The matched line, trimmed to 200 chars.
	pub text: String,
}

#[tauri::command]
pub fn ide_search_workspace(
	root: String,
	query: String,
	case_sensitive: Option<bool>,
	whole_word: Option<bool>,
) -> Result<Vec<WorkspaceMatch>, String> {
	let needle = query.trim().to_string();
	if needle.is_empty() {
		return Ok(Vec::new());
	}
	let root_path = std::path::PathBuf::from(&root);
	if !root_path.is_dir() {
		return Err(format!("Directory does not exist: {root}"));
	}
	let options = SearchOptions {
		needle,
		case_sensitive: case_sensitive.unwrap_or(false),
		whole_word: whole_word.unwrap_or(false),
	};
	let mut matches: Vec<WorkspaceMatch> = Vec::new();
	let mut files_scanned = 0usize;
	search_walk(&root_path, &root_path, &options, 8, &mut files_scanned, &mut matches);
	Ok(matches)
}

struct SearchOptions {
	needle: String,
	case_sensitive: bool,
	whole_word: bool,
}

/// True when `line` contains `options.needle` under the requested constraints.
/// Whole-word checks count `_` as a word character, matching editor behavior.
fn line_matches(line: &str, options: &SearchOptions) -> bool {
	let (haystack, needle) = if options.case_sensitive {
		(line.to_string(), options.needle.clone())
	} else {
		(line.to_lowercase(), options.needle.to_lowercase())
	};
	if !options.whole_word {
		return haystack.contains(&needle);
	}
	let mut from = 0;
	while let Some(found) = haystack[from..].find(&needle) {
		let start = from + found;
		let end = start + needle.len();
		let before = haystack[..start].chars().next_back();
		let after = haystack[end..].chars().next();
		let boundary = |c: Option<char>| match c {
			Some(ch) => !(ch.is_alphanumeric() || ch == '_'),
			None => true,
		};
		if boundary(before) && boundary(after) {
			return true;
		}
		// Advance one char, not one byte, so multibyte text cannot split.
		from = start + haystack[start..].chars().next().map(char::len_utf8).unwrap_or(1);
		if from >= haystack.len() {
			break;
		}
	}
	false
}

fn search_walk(
	dir: &std::path::Path,
	root: &std::path::Path,
	options: &SearchOptions,
	depth: u8,
	files_scanned: &mut usize,
	matches: &mut Vec<WorkspaceMatch>,
) {
	if depth == 0 || matches.len() >= SEARCH_MAX_MATCHES || *files_scanned >= SEARCH_MAX_FILES {
		return;
	}
	let Ok(entries) = std::fs::read_dir(dir) else {
		return;
	};
	let mut names: Vec<std::fs::DirEntry> = entries.flatten().collect();
	names.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
	for entry in names {
		if matches.len() >= SEARCH_MAX_MATCHES || *files_scanned >= SEARCH_MAX_FILES {
			return;
		}
		let path = entry.path();
		let name = entry.file_name();
		let name_str = name.to_string_lossy();
		if path.is_dir() {
			if SEARCH_SKIP_DIRS.contains(&name_str.as_ref()) {
				continue;
			}
			search_walk(&path, root, options, depth - 1, files_scanned, matches);
		} else {
			if name_str.starts_with('.') {
				continue;
			}
			let Ok(meta) = entry.metadata() else { continue };
			if !meta.is_file() || meta.len() > SEARCH_MAX_FILE_BYTES {
				continue;
			}
			let Ok(content) = std::fs::read_to_string(&path) else { continue };
			*files_scanned += 1;
			for (index, line) in content.lines().enumerate() {
				if line_matches(line, options) {
					matches.push(WorkspaceMatch {
						path: path.strip_prefix(root).unwrap_or(&path).to_string_lossy().into_owned(),
						line: (index as u64) + 1,
						text: line.chars().take(200).collect(),
					});
					if matches.len() >= SEARCH_MAX_MATCHES {
						return;
					}
				}
			}
		}
	}
}

// ============================================================================
// Integrated terminal: real PTY via portable-pty, streamed as desktop:// events.
// ============================================================================

struct PtyHandle {
	/// Close = EOF to the shell. Taken once per session; Mutex for &Map access.
	writer: Mutex<Box<dyn Write + Send>>,
	/// Resize target.
	master: Box<dyn MasterPty + Send>,
	/// Best-effort kill; the child handle itself lives in the reader thread
	/// so we can reap it and report the real exit code.
	killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

pub struct IdeState {
	ptys: Mutex<HashMap<u32, PtyHandle>>,
	next_id: AtomicU32,
}

impl Default for IdeState {
	fn default() -> Self {
		Self {
			ptys: Mutex::new(HashMap::new()),
			next_id: AtomicU32::new(1),
		}
	}
}

#[derive(serde::Serialize, Clone, Copy, Debug)]
pub struct PtySpawned {
	id: u32,
}

fn shell_command_for_host() -> (String, Vec<String>) {
	if cfg!(windows) {
		("powershell.exe".to_string(), Vec::new())
	} else {
		let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
		(shell, vec!["-l".to_string()])
	}
}

/// Spawn an interactive shell bound to `cwd`. Output streams on
/// `desktop://ide-pty-output` ({ id, chunk }); after the child exits one final
/// `desktop://ide-pty-exit` ({ id, code }) arrives and the id retires.
#[tauri::command]
pub fn ide_pty_spawn(app: AppHandle, state: State<'_, IdeState>, cwd: String) -> Result<PtySpawned, String> {
	let cwd_path = std::path::PathBuf::from(&cwd);
	if !cwd_path.is_dir() {
		return Err(format!("Directory does not exist: {cwd}"));
	}

	let pty_system = native_pty_system();
	// 80x24 matches the xterm default; the frontend resizes right after mount.
	let pair = pty_system
		.openpty(PtySize {
			rows: 24,
			cols: 80,
			pixel_width: 0,
			pixel_height: 0,
		})
		.map_err(|e| format!("Failed to open pty: {e}"))?;

	let (program, args) = shell_command_for_host();
	let mut cmd = portable_pty::CommandBuilder::new(program);
	for (key, value) in std::env::vars() {
		// TERM/COLORTERM are ours; keep the rest (including NO_COLOR if set).
		if key != "TERM" && key != "COLORTERM" {
			cmd.env(key, value);
		}
	}
	cmd.env("TERM", "xterm-256color");
	cmd.env("COLORTERM", "truecolor");
	// The desktop app process often carries a Finder PATH, not a login one.
	cmd.env("PATH", reconstructed_path());
	cmd.cwd(cwd_path);
	cmd.args(args);

	let child: Box<dyn portable_pty::Child + Send + Sync> = pair
		.slave
		.spawn_command(cmd)
		.map_err(|e| format!("Failed to spawn shell: {e}"))?;
	drop(pair.slave); // the parent holds the master; keeping the slave open would mask EOF

	let id = state.next_id.fetch_add(1, Ordering::SeqCst);
	let writer = pair.master.take_writer().map_err(|e| format!("pty writer: {e}"))?;
	let killer = child.clone_killer();

	// Reader thread: stream chunks until EOF, then reap the child and emit one
	// exit event with the real code.
	let reader = pair
		.master
		.try_clone_reader()
		.map_err(|e| format!("pty reader: {e}"))?;
	std::thread::spawn(move || {
		let mut reader = reader;
		let mut child = child;
		let mut buf = [0u8; 8192];
		loop {
			match reader.read(&mut buf) {
				Ok(0) | Err(_) => break,
				Ok(n) => {
					let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
					if app
						.emit("desktop://ide-pty-output", serde_json::json!({ "id": id, "chunk": chunk }))
						.is_err()
					{
						// Webview gone; the writer stays until kill/cleanup below.
						break;
					}
				}
			}
		}
		let code = child.wait().ok().map(|status| status.exit_code());
		let _ = app.emit("desktop://ide-pty-exit", serde_json::json!({ "id": id, "code": code }));
	});

	state.ptys.lock().expect("ide ptys poisoned").insert(
		id,
		PtyHandle {
			writer: Mutex::new(writer),
			master: pair.master,
			killer,
		},
	);

	Ok(PtySpawned { id })
}

#[tauri::command]
pub fn ide_pty_write(state: State<'_, IdeState>, id: u32, data: String) -> Result<(), String> {
	let ptys = state.ptys.lock().expect("ide ptys poisoned");
	if let Some(handle) = ptys.get(&id) {
		let mut writer = handle.writer.lock().expect("pty writer poisoned");
		writer
			.write_all(data.as_bytes())
			.and_then(|()| writer.flush())
			.map_err(|e| format!("pty write failed: {e}"))
	} else {
		Err("Terminal session went away; open a new one.".to_string())
	}
}

#[tauri::command]
pub fn ide_pty_resize(state: State<'_, IdeState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
	let ptys = state.ptys.lock().expect("ide ptys poisoned");
	if let Some(handle) = ptys.get(&id) {
		handle
			.master
			.resize(PtySize {
				rows,
				cols,
				pixel_width: 0,
				pixel_height: 0,
			})
			.map_err(|e| format!("pty resize failed: {e}"))
	} else {
		Err("Terminal session went away; open a new one.".to_string())
	}
}

/// Kill the shell and drop the session. The reader thread unblocks (EOF), reaps
/// the child, and emits the exit event.
#[tauri::command]
pub fn ide_pty_kill(state: State<'_, IdeState>, id: u32) -> Result<(), String> {
	let mut ptys = state.ptys.lock().expect("ide ptys poisoned");
	if let Some(mut handle) = ptys.remove(&id) {
		let _ = handle.killer.kill();
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::{line_matches, SearchOptions};

	fn opts(needle: &str, case_sensitive: bool, whole_word: bool) -> SearchOptions {
		SearchOptions {
			needle: needle.to_string(),
			case_sensitive,
			whole_word,
		}
	}

	#[test]
	fn case_insensitive_by_default() {
		assert!(line_matches("const Foo = 1;", &opts("foo", false, false)));
		assert!(!line_matches("const Foo = 1;", &opts("foo", true, false)));
	}

	#[test]
	fn whole_word_respects_boundaries() {
		assert!(!line_matches("foobar", &opts("foo", false, true)));
		assert!(line_matches("a foo b", &opts("foo", false, true)));
		assert!(!line_matches("a_foo", &opts("foo", false, true)));
		assert!(line_matches("a.foo(", &opts("foo", false, true)));
	}

	#[test]
	fn multibyte_lines_do_not_panic() {
		assert!(line_matches("héllo foo", &opts("foo", false, true)));
		assert!(!line_matches("héllo", &opts("ll", false, true)));
	}
}

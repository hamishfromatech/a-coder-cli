use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

use crate::cli::reconstructed_path;

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
			.map_err(|e| format!("Failed to create parent directory: {e}"))?;
	}
	std::fs::write(&path, content).map_err(|e| format!("Failed to write {}: {e}", path.display()))
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
// Workspace text search: bounded case-insensitive substring scan. The engine's
// agent does deep searching; this backs the IDE quick-search panel where
// latency matters more than recall.
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
pub fn ide_search_workspace(root: String, query: String) -> Result<Vec<WorkspaceMatch>, String> {
	let query_lower = query.trim().to_lowercase();
	if query_lower.is_empty() {
		return Ok(Vec::new());
	}
	let root_path = std::path::PathBuf::from(&root);
	if !root_path.is_dir() {
		return Err(format!("Directory does not exist: {root}"));
	}
	let mut matches: Vec<WorkspaceMatch> = Vec::new();
	let mut files_scanned = 0usize;
	search_walk(&root_path, &root_path, &query_lower, 8, &mut files_scanned, &mut matches);
	Ok(matches)
}

fn search_walk(
	dir: &std::path::Path,
	root: &std::path::Path,
	query: &str,
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
			search_walk(&path, root, query, depth - 1, files_scanned, matches);
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
				if line.to_lowercase().contains(query) {
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
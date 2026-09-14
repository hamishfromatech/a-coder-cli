//! A-Coder Bench: task listing and headless benchmark runs.
//!
//! The desktop settings panel hosts its own bench UI (config form, task
//! list, safety acknowledgment). Runs execute the same CLI headlessly via
//! `bench run --json`; stdout lines are streamed to the frontend as
//! `desktop://bench-line` events and completion as `desktop://bench-exit`.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::cli::{build_cli_command, reconstructed_path};

/// Handle to the running bench child so it can be cancelled and polled.
#[derive(Default)]
pub struct BenchState {
	pub child: Arc<Mutex<Option<Child>>>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BenchTaskInfo {
	pub id: String,
	pub title: String,
	pub tags: Vec<String>,
	pub timeout_seconds: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BenchRunConfig {
	pub bench_dir: String,
	pub model: String,
	pub endpoint: Option<String>,
	pub api: Option<String>,
	pub api_key: Option<String>,
	pub runs: u32,
	pub tasks: Option<String>,
}

/// Read `bench/tasks/*/task.json` into structured task info.
#[tauri::command]
pub fn bench_list_tasks(bench_dir: String) -> Result<Vec<BenchTaskInfo>, String> {
	let tasks_dir = std::path::Path::new(&bench_dir).join("tasks");
	if !tasks_dir.is_dir() {
		return Err(format!("No tasks directory at {}", tasks_dir.display()));
	}
	let mut entries: Vec<BenchTaskInfo> = Vec::new();
	for entry in std::fs::read_dir(&tasks_dir).map_err(|e| format!("Failed to read {}: {}", tasks_dir.display(), e))? {
		let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}
		let task_path = path.join("task.json");
		if !task_path.is_file() {
			continue;
		}
		let raw = std::fs::read_to_string(&task_path).map_err(|e| format!("Failed to read {}: {}", task_path.display(), e))?;
		match parse_task_json(&raw) {
			Some(info) => entries.push(info),
			None => return Err(format!("Invalid task.json in {}", path.display())),
		}
	}
	entries.sort_by(|a, b| a.id.cmp(&b.id));
	Ok(entries)
}

fn parse_task_json(raw: &str) -> Option<BenchTaskInfo> {
	let value: serde_json::Value = serde_json::from_str(raw).ok()?;
	let id = value.get("id")?.as_str()?.to_string();
	let title = value.get("title").and_then(|v| v.as_str()).unwrap_or_else(|| id.as_str()).to_string();
	let tags = value
		.get("tags")
		.and_then(|v| v.as_array())
		.map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
		.unwrap_or_default();
	let timeout_seconds = value.get("timeoutSeconds").and_then(|v| v.as_u64()).unwrap_or(300);
	Some(BenchTaskInfo {
		id,
		title,
		tags,
		timeout_seconds,
	})
}

/// Spawn a headless benchmark run. Progress lines arrive as
/// `desktop://bench-line` events; completion as `desktop://bench-exit` with
/// the process exit code (i64).
#[tauri::command]
pub async fn bench_start(app: AppHandle, state: State<'_, BenchState>, config: BenchRunConfig) -> Result<String, String> {
	{
		let guard = state.child.lock().await;
		if guard.is_some() {
			return Err("A benchmark run is already in progress.".into());
		}
	}

	let cli_path = crate::cli::resolve_cli_path(None)?;
	let mut args: Vec<String> = vec![
		"bench".into(),
		"run".into(),
		"--json".into(),
		"--model".into(),
		config.model.clone(),
		"--runs".into(),
		config.runs.max(1).to_string(),
		"--bench-dir".into(),
		config.bench_dir.clone(),
	];
	if let Some(endpoint) = config.endpoint.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
		args.push("--endpoint".into());
		args.push(endpoint.to_string());
		args.push("--api-key".into());
		args.push(config.api_key.clone().unwrap_or_else(|| "bench".into()));
	}
	if let Some(api) = config.api.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
		args.push("--api".into());
		args.push(api.to_string());
	}
	if let Some(tasks) = config.tasks.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
		args.push("--tasks".into());
		args.push(tasks.to_string());
	}

	// Run from the bench dir's parent (repo root) so relative paths behave.
	let cwd = std::path::Path::new(&config.bench_dir)
		.parent()
		.map(|p| p.to_path_buf())
		.unwrap_or_else(|| PathBuf::from("."));

	let mut command = build_cli_command(&cli_path, &args)?;
	command.env("PATH", reconstructed_path());
	let mut child = tokio::process::Command::from(command)
		.current_dir(&cwd)
		.stdin(std::process::Stdio::null())
		.stdout(std::process::Stdio::piped())
		.stderr(std::process::Stdio::piped())
		.kill_on_drop(true)
		.spawn()
		.map_err(|e| format!("Failed to spawn bench run: {}", e))?;

	if let Some(stdout) = child.stdout.take() {
		let emitter = app.clone();
		tokio::spawn(async move {
			let mut reader = tokio::io::BufReader::new(stdout);
			let mut line = String::new();
			loop {
				line.clear();
				match reader.read_line(&mut line).await {
					Ok(0) | Err(_) => break,
					Ok(_) => {
						let trimmed = line.trim_end().to_string();
						if !trimmed.is_empty() {
							let _ = emitter.emit("desktop://bench-line", trimmed);
						}
					}
				}
			}
		});
	}
	if let Some(stderr) = child.stderr.take() {
		let emitter = app.clone();
		tokio::spawn(async move {
			let mut reader = tokio::io::BufReader::new(stderr);
			let mut line = String::new();
			loop {
				line.clear();
				match reader.read_line(&mut line).await {
					Ok(0) | Err(_) => break,
					Ok(_) => {
						let trimmed = line.trim_end().to_string();
						if !trimmed.is_empty() {
							let wrapped = serde_json::json!({ "type": "bench_stderr", "message": trimmed }).to_string();
							let _ = emitter.emit("desktop://bench-line", wrapped);
						}
					}
				}
			}
		});
	}

	*state.child.lock().await = Some(child);

	// Completion watcher: poll the slot so bench_stop can still lock it.
	let exit_emitter = app.clone();
	let poll_slot = state.child.clone();
	tokio::spawn(async move {
		let mut exit_code: i32 = -1;
		loop {
			let resolved: Option<i32> = {
				let mut guard = poll_slot.lock().await;
				match guard.as_mut() {
					None => Some(-1), // slot cleared externally; nothing to watch
					Some(child) => match child.try_wait() {
						Ok(Some(status)) => Some(status.code().unwrap_or(-1)),
						Ok(None) => None,
						Err(_) => Some(-1),
					},
				}
			};
			match resolved {
				Some(code) => {
					exit_code = code;
					break;
				}
				None => tokio::time::sleep(std::time::Duration::from_millis(250)).await,
			}
		}
		let _ = exit_emitter.emit("desktop://bench-exit", exit_code);
		let mut guard = poll_slot.lock().await;
		*guard = None;
	});

	Ok("started".into())
}

/// Kill the running benchmark, if any.
#[tauri::command]
pub async fn bench_stop(state: State<'_, BenchState>) -> Result<String, String> {
	let mut guard = state.child.lock().await;
	match guard.as_mut() {
		Some(child) => {
			child.start_kill();
			*guard = None;
			Ok("stopped".into())
		}
		None => Ok("no bench run in progress".into()),
	}
}
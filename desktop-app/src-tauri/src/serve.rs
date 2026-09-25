//! A-Coder serve (mobile bridge) management from the desktop settings panel.
//!
//! Spawns `a-coder-cli serve --cwd <dir>` as a child process — the same CLI
//! the user would run manually — and streams its stderr (pairing banner: the
//! listening address, token, QR and mDNS notice, plus `[serve]` logs) to the
//! frontend as `desktop://serve-line` events. Exit arrives as
//! `desktop://serve-exit`. The CLI owns token persistence; the desktop just
//! relays the banner.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::cli::{build_cli_command, reconstructed_path};

/// Handle to the running serve child so it can be stopped and polled.
#[derive(Default)]
pub struct ServeState {
	pub child: Arc<Mutex<Option<Child>>>,
}

/// Spawn `a-coder-cli serve` for a workspace directory. Banner/log lines are
/// emitted as `desktop://serve-line` (JSON strings); exit as
/// `desktop://serve-exit` with the process exit code (i64).
#[tauri::command]
pub async fn serve_start(app: AppHandle, state: State<'_, ServeState>, cwd: String, port: Option<u16>) -> Result<String, String> {
	{
		let guard = state.child.lock().await;
		if guard.is_some() {
			return Err("The mobile bridge is already running.".into());
		}
	}

	let cli_path = crate::cli::resolve_cli_path(None)?;
	let mut args: Vec<String> = vec!["serve".into(), "--cwd".into(), cwd.clone()];
	if let Some(p) = port {
		args.push("--port".into());
		args.push(p.to_string());
	}
	let mut command = build_cli_command(&cli_path, &args)?;
	command.env("PATH", reconstructed_path());
	let mut child = tokio::process::Command::from(command)
		.current_dir(&cwd)
		.stdin(std::process::Stdio::null())
		.stdout(std::process::Stdio::null())
		.stderr(std::process::Stdio::piped())
		.kill_on_drop(true)
		.spawn()
		.map_err(|e| format!("Failed to spawn serve: {}", e))?;

	if let Some(stderr) = child.stderr.take() {
		let emitter = app.clone();
		tokio::spawn(async move {
			let mut reader = BufReader::new(stderr);
			let mut line = String::new();
			loop {
				line.clear();
				match reader.read_line(&mut line).await {
					Ok(0) | Err(_) => break,
					Ok(_) => {
						let trimmed = line.trim_end().to_string();
						if !trimmed.is_empty() {
							let _ = emitter.emit("desktop://serve-line", trimmed);
						}
					}
				}
			}
		});
	}

	*state.child.lock().await = Some(child);

	// Completion watcher: poll the slot so serve_stop can still clear it.
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
		let _ = exit_emitter.emit("desktop://serve-exit", exit_code);
		let mut guard = poll_slot.lock().await;
		*guard = None;
	});

	Ok("started".into())
}

/// Kill the running mobile bridge, if any.
#[tauri::command]
pub async fn serve_stop(state: State<'_, ServeState>) -> Result<String, String> {
	let mut guard = state.child.lock().await;
	match guard.as_mut() {
		Some(child) => {
			child.start_kill();
			*guard = None;
			Ok("stopped".into())
		}
		None => Ok("no serve bridge in progress".into()),
	}
}

/// Whether a serve child is currently alive.
#[tauri::command]
pub async fn serve_status(state: State<'_, ServeState>) -> Result<bool, String> {
	let mut guard = state.child.lock().await;
	match guard.as_mut() {
		Some(child) => Ok(child.try_wait().map_err(|e| e.to_string())?.is_none()),
		None => Ok(false),
	}
}
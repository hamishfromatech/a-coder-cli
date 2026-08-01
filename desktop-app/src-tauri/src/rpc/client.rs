use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use crate::cli::reconstructed_path;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;
use uuid::Uuid;

/// A pending request waiting for a correlated response.
struct PendingRequest {
	resolve: oneshot::Sender<Result<Value, String>>,
}

pub struct RpcClient {
	stdin_tx: mpsc::Sender<String>,
	pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
	_app_handle: AppHandle,
	_io_handle: JoinHandle<()>,
}

impl RpcClient {
	pub async fn spawn(
		cli_path: PathBuf,
		cwd: Option<String>,
		provider: Option<String>,
		model: Option<String>,
		continue_session: bool,
		app_handle: AppHandle,
	) -> Result<Self, String> {
		let mut cmd = Command::new("node");
		// `--continue` resumes the most recent session for this project's cwd
		// instead of starting a fresh one, so chat history persists across app
		// restarts and version upgrades. It is opt-in: the app opens into a fresh
		// session by default and loads past sessions into the tree in the
		// background. Project switches / reconnects pass `continue_session = true`
		// to resume that project's last session.
		let mut args: Vec<String> = vec![
			"--mode".into(),
			"rpc".into(),
		];
		if continue_session {
			args.push("--continue".into());
		}
		if let Some(p) = provider {
			args.push("--provider".into());
			args.push(p);
		}
		if let Some(m) = model {
			args.push("--model".into());
			args.push(m);
		}

		let mut child = cmd
			.arg(cli_path)
			.args(args)
			.current_dir(cwd.unwrap_or_else(|| ".".into()))
			.env("PATH", reconstructed_path())
			.stdin(Stdio::piped())
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.spawn()
			.map_err(|e| format!("Failed to spawn CLI: {}", e))?;

		let pending: Arc<Mutex<HashMap<String, PendingRequest>>> = Arc::new(Mutex::new(HashMap::new()));
		let (stdin_tx, stdin_rx) = mpsc::channel::<String>(64);
		let io_handle = Self::start_io(&mut child, stdin_rx, pending.clone(), app_handle.clone())?;

		Ok(Self {
			stdin_tx,
			pending,
			_app_handle: app_handle,
			_io_handle: io_handle,
		})
	}

	/// Send a command and wait for its correlated response.
	pub async fn send(&self, command: Value) -> Result<Value, String> {
		let id = Uuid::new_v4().to_string();
		let mut command_with_id = command.clone();
		if let Some(obj) = command_with_id.as_object_mut() {
			obj.insert("id".to_string(), Value::String(id.clone()));
		} else {
			return Err("Command must be a JSON object".to_string());
		}

		let (tx, rx) = oneshot::channel::<Result<Value, String>>();
		{
			let mut pending = self.pending.lock().await;
			pending.insert(id, PendingRequest { resolve: tx });
		}

		let line = serde_json::to_string(&command_with_id).map_err(|e| e.to_string())?;
		self.stdin_tx
			.send(line)
			.await
			.map_err(|e| format!("Failed to send command: {}", e))?;

		rx.await.map_err(|_| "RPC channel closed".to_string())?
	}

	/// Send a raw line without waiting for a response (used for extension UI responses).
	pub async fn send_raw(&self, line: String) -> Result<(), String> {
		self.stdin_tx
			.send(line)
			.await
			.map_err(|e| format!("Failed to send raw command: {}", e))
	}

	fn start_io(
		child: &mut Child,
		mut stdin_rx: mpsc::Receiver<String>,
		pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
		app_handle: AppHandle,
	) -> Result<JoinHandle<()>, String> {
		let stdout = child.stdout.take().expect("stdout pipe");
		let stdin = child.stdin.take().expect("stdin pipe");
		let stderr = child.stderr.take().expect("stderr pipe");

		let handle: JoinHandle<()> = tokio::spawn(async move {
			// Forward queued commands to the CLI stdin.
			let forwarder = tokio::spawn(async move {
				let mut stdin = stdin;
				while let Some(line) = stdin_rx.recv().await {
					let _ = stdin.write_all(line.as_bytes()).await;
					let _ = stdin.write_all(b"\n").await;
					let _ = stdin.flush().await;
				}
			});

			// Read stdout line by line and dispatch responses/events.
			let reader = BufReader::new(stdout);
			let mut lines = reader.lines();
			while let Ok(Some(line)) = lines.next_line().await {
				match serde_json::from_str::<Value>(&line) {
					Ok(value) => {
						Self::dispatch_line(value, &pending, &app_handle).await;
					}
					Err(e) => {
						tracing::warn!("Failed to parse RPC line: {} | line: {}", e, line);
					}
				}
			}

			// Drain stderr for diagnostics.
			let err_reader = BufReader::new(stderr);
			let mut err_lines = err_reader.lines();
			while let Ok(Some(line)) = err_lines.next_line().await {
				tracing::error!("cli stderr: {}", line);
			}

			let _ = forwarder.await;
		});

		Ok(handle)
	}

	async fn dispatch_line(
		value: Value,
		pending: &Arc<Mutex<HashMap<String, PendingRequest>>>,
		app_handle: &AppHandle,
	) {
		// Separate responses from events. Responses have type: "response".
		if value.get("type").and_then(|t| t.as_str()) == Some("response") {
			if let Some(id) = value.get("id").and_then(|id| id.as_str()) {
				let mut guard = pending.lock().await;
				if let Some(req) = guard.remove(id) {
					let result = if value.get("success").and_then(|s| s.as_bool()) == Some(true) {
						Ok(value.get("data").cloned().unwrap_or(Value::Null))
					} else {
						Err(value
							.get("error")
							.and_then(|e| e.as_str())
							.unwrap_or("Unknown RPC error")
							.to_string())
					};
					let _ = req.resolve.send(result);
				}
			}
			return;
		}

		// Everything else is an event to forward to the frontend.
		let _ = app_handle.emit("rpc://event", value);
	}
}

impl Drop for RpcClient {
	fn drop(&mut self) {
		self._io_handle.abort();
	}
}

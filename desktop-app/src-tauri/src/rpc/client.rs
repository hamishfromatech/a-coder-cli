use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::cli::{build_cli_command, reconstructed_path};

use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Child;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use uuid::Uuid;

/// A pending request waiting for a correlated response.
pub(crate) struct PendingRequest {
	pub(crate) resolve: oneshot::Sender<Result<Value, Value>>,
}

/// Structured error returned to the frontend. `message` is preserved for older
/// call sites; `code`/`retryable`/`details` are additive.
pub(crate) fn rpc_error(code: &str, message: &str, retryable: bool) -> Value {
	json!({ "code": code, "message": message, "retryable": retryable })
}

pub struct RpcClient {
	stdin_tx: mpsc::Sender<String>,
	pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
	/// False once the stdout reader loop has ended (engine exited). Guards
	/// fire-and-forget sends: without it, a UI response written to a dead
	/// engine's stdin fails silently and the agent blocks on a prompt nobody
	/// can answer.
	alive: Arc<AtomicBool>,
	/// Flipped once the frontend listener is registered; events before that are
	/// buffered so the engine's handshake and initial snapshots cannot be lost.
	ready: Arc<AtomicBool>,
	buffered: Arc<Mutex<Vec<String>>>,
	app_handle: AppHandle,
	_io_handle: JoinHandle<()>,
	// Retain the Child so kill_on_drop keeps the CLI alive for the client's
	// lifetime (and kills it on disconnect). Without this the Child is dropped
	// at the end of spawn and kill_on_drop would kill the CLI immediately.
	_child: Child,
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
		// `--continue` resumes the most recent session for this project's cwd
		// instead of starting a fresh one, so chat history persists across app
		// restarts and version upgrades. It is opt-in: the app opens into a fresh
		// session by default and loads past sessions into the tree in the
		// background. Project switches / reconnects pass `continue_session = true`
		// to resume that project's last session.
		let mut args: Vec<String> = vec!["--mode".into(), "rpc".into()];
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

		let mut child = tokio::process::Command::from(build_cli_command(&cli_path, &args)?)
			.current_dir(cwd.unwrap_or_else(|| ".".into()))
			.env("PATH", reconstructed_path())
			.stdin(Stdio::piped())
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.kill_on_drop(true)
			.spawn()
			.map_err(|e| format!("Failed to spawn CLI: {}", e))?;

		let pending: Arc<Mutex<HashMap<String, PendingRequest>>> =
			Arc::new(Mutex::new(HashMap::new()));
		let (stdin_tx, stdin_rx) = mpsc::channel::<String>(64);
		let alive = Arc::new(AtomicBool::new(true));
		let ready = Arc::new(AtomicBool::new(false));
		let buffered: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
		let io_handle = Self::start_io(
			&mut child,
			stdin_rx,
			pending.clone(),
			alive.clone(),
			ready.clone(),
			buffered.clone(),
			app_handle.clone(),
		)?;

		Ok(Self {
			stdin_tx,
			pending,
			alive,
			ready,
			buffered,
			app_handle,
			_io_handle: io_handle,
			_child: child,
		})
	}

	/// Clone the send handles so a caller can send + await the response WITHOUT
	/// holding the client lock (Tauri/Tokio best practice: don't hold a MutexGuard
	/// across a long await — a lost response would otherwise block every later
	/// invoke that needs the client).
	pub(crate) fn handles(
		&self,
	) -> (
		mpsc::Sender<String>,
		Arc<Mutex<HashMap<String, PendingRequest>>>,
	) {
		(self.stdin_tx.clone(), self.pending.clone())
	}

	/// Frontend listener is registered: replay buffered event lines in order and
	/// switch to live delivery.
	pub async fn mark_ready(&self) -> usize {
		let buffered = {
			let mut guard = self.buffered.lock().await;
			// Flip under the lock so a producer that already decided to buffer
			// re-checks and emits live instead of stranding the frame.
			self.ready.store(true, Ordering::SeqCst);
			std::mem::take(&mut *guard)
		};
		for line in &buffered {
			let _ = self.app_handle.emit("rpc://event", line);
		}
		buffered.len()
	}

	/// Send + await a response using cloned handles (no client lock held during the
	/// await). A response timeout guarantees a lost/unmatched response can never
	/// hang the caller indefinitely.
	pub(crate) async fn send_with(
		stdin_tx: mpsc::Sender<String>,
		pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
		command: Value,
	) -> Result<Value, Value> {
		// Honor a caller-supplied id so `cancel_command` can target it.
		let supplied_id = command.get("id").and_then(|v| v.as_str()).map(str::to_string);
		let id = supplied_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
		let mut command_with_id = command.clone();
		if let Some(obj) = command_with_id.as_object_mut() {
			if supplied_id.is_none() {
				obj.insert("id".to_string(), Value::String(id.clone()));
			}
		} else {
			return Err(rpc_error("invalid_command", "Command must be a JSON object", false));
		}

		let (tx, rx) = oneshot::channel::<Result<Value, Value>>();
		{
			let mut guard = pending.lock().await;
			guard.insert(id.clone(), PendingRequest { resolve: tx });
		}

		let line = serde_json::to_string(&command_with_id)
			.map_err(|e| rpc_error("serialize_failed", &e.to_string(), false))?;
		tracing::debug!("RPC send: {}", line);
		stdin_tx
			.send(line)
			.await
			.map_err(|e| rpc_error("engine_exited", &format!("Failed to send command: {}", e), false))?;

		// Per-command bounds: session/history reads can be large, prompt/steer
		// settle immediately, and everything else gets a generous default.
		let timeout_secs = match command.get("type").and_then(|t| t.as_str()) {
			Some("get_messages" | "list_sessions" | "switch_session" | "import_jsonl" | "export_jsonl" | "export_html") => 120,
			Some("prompt" | "steer" | "follow_up" | "abort" | "clear_queue" | "queue_remove" | "get_state" | "client_info" | "cancel_command") => 30,
			_ => 60,
		};
		match timeout(Duration::from_secs(timeout_secs), rx).await {
			Ok(Ok(result)) => result,
			Ok(Err(_)) => Err(rpc_error("engine_exited", "RPC channel closed", false)),
			Err(_) => {
				pending.lock().await.remove(&id);
				Err(rpc_error("timeout", "RPC response timed out", true))
			}
		}
	}

	/// Send a raw line without waiting for a response (used for extension UI responses).
	/// Fails when the engine is no longer running so callers can surface the
	/// loss instead of writing into a closed pipe.
	pub async fn send_raw(&self, line: String) -> Result<(), String> {
		if !self.alive.load(Ordering::SeqCst) {
			return Err("Engine is not running".to_string());
		}
		self.stdin_tx
			.send(line)
			.await
			.map_err(|e| format!("Failed to send raw command: {}", e))
	}

	fn start_io(
		child: &mut Child,
		mut stdin_rx: mpsc::Receiver<String>,
		pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
		alive: Arc<AtomicBool>,
		ready: Arc<AtomicBool>,
		buffered: Arc<Mutex<Vec<String>>>,
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

			// Drain stderr concurrently for the whole child lifetime. Reading it only
			// after stdout closes deadlocks: a CLI that writes >1 pipe buffer (~64KB)
			// of stderr blocks on write and the app looks hung. Closing stderr is NOT
			// an exit signal — only stdout drives `alive`/cli-exited.
			let stderr_task = tokio::spawn(async move {
				let err_reader = BufReader::new(stderr);
				let mut err_lines = err_reader.lines();
				while let Ok(Some(line)) = err_lines.next_line().await {
					tracing::error!("cli stderr: {}", line);
				}
			});

			// Read stdout line by line and dispatch responses/events.
			let reader = BufReader::new(stdout);
			let mut lines = reader.lines();
			while let Ok(Some(line)) = lines.next_line().await {
				// Responses are the only frames we need to parse in Rust (to match
				// request ids). Event lines are forwarded as raw JSON strings and
				// parsed once in the frontend, avoiding a Value round trip per token.
				let is_response = line.starts_with("{\"id\":") || line.starts_with("{\"type\":\"response\"");
				if !is_response {
					if ready.load(Ordering::SeqCst) {
						let _ = app_handle.emit("rpc://event", &line);
					} else {
						let mut guard = buffered.lock().await;
						if ready.load(Ordering::SeqCst) {
							drop(guard);
							let _ = app_handle.emit("rpc://event", &line);
						} else {
							if guard.len() >= 500 {
								guard.remove(0);
							}
							guard.push(line);
						}
					}
					continue;
				}

				// Disable serde_json's default ~128-level recursion limit: nested
				// responses (for clients still asking for the nested tree) can be
				// hundreds of levels deep. serde_stacker moves the deserialize stack
				// to the heap so deep input cannot overflow the task stack.
				let mut de = serde_json::Deserializer::from_str(&line);
				de.disable_recursion_limit();
				match Value::deserialize(serde_stacker::Deserializer::new(&mut de)) {
					Ok(value) => {
						tracing::debug!("RPC recv: {}", &line);
						Self::dispatch_line(value, &pending, &app_handle).await;
					}
					Err(e) => {
						tracing::warn!("Failed to parse RPC line: {}", e);
					}
				}
			}

			// The CLI engine exited (stdout closed). Without this signal the
			// frontend keeps rendering a dead session — sends silently time out and
			// the window looks frozen. Tell it so it can surface a reconnect
			// affordance. The alive flag flips first so any send racing the exit
			// is refused (an error) rather than silently dropped.
			alive.store(false, Ordering::SeqCst);
			{
				let mut guard = pending.lock().await;
				for (_, request) in guard.drain() {
					let _ = request
						.resolve
						.send(Err(rpc_error("engine_exited", "RPC channel closed", false)));
				}
			}
			let _ = app_handle.emit("desktop://cli-exited", ());

			// Emit first, then wait for stderr (it may stay open until process exit).
			let _ = stderr_task.await;
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
				let matched = guard.remove(id);
				if let Some(req) = matched {
					let result = if value.get("success").and_then(|s| s.as_bool()) == Some(true) {
						Ok(value.get("data").cloned().unwrap_or(Value::Null))
					} else {
						let code = value
							.get("code")
							.and_then(|c| c.as_str())
							.unwrap_or("command_failed");
						let message = value
							.get("error")
							.and_then(|e| e.as_str())
							.unwrap_or("Unknown RPC error");
						let retryable = value
							.get("retryable")
							.and_then(|r| r.as_bool())
							.unwrap_or(false);
						let mut err = rpc_error(code, message, retryable);
						if let Some(details) = value.get("details") {
							err["details"] = details.clone();
						}
						Err(err)
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

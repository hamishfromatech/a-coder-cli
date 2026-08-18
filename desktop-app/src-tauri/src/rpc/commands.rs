use std::path::PathBuf;

use serde_json::Value;
use tauri::{command, State};

use crate::rpc::RpcClient;
use crate::state::AppState;

#[derive(Debug, serde::Deserialize)]
pub struct ConnectArgs {
	pub cwd: String,
	pub cli_path: Option<String>,
	pub provider: Option<String>,
	pub model: Option<String>,
	/// When true, spawn with `--continue` to resume the most recent session for
	/// `cwd`. Defaults to false so the app opens into a fresh session and loads
	/// past sessions into the tree in the background instead.
	pub continue_session: Option<bool>,
}

#[command]
pub async fn connect(
	app_handle: tauri::AppHandle,
	state: State<'_, AppState>,
	args: ConnectArgs,
) -> Result<String, String> {
	// If the user supplied an explicit CLI override, honor it without updating.
	// Otherwise make sure the globally installed CLI matches the desktop app's
	// version so resumed sessions don't run against a stale engine.
	let cli_path = if let Some(override_path) = args.cli_path {
		PathBuf::from(override_path)
	} else {
		crate::bootstrap::ensure_cli_version_matches().await?
	};
	let client = RpcClient::spawn(
		cli_path,
		Some(args.cwd),
		args.provider,
		args.model,
		args.continue_session.unwrap_or(false),
		app_handle,
	)
	.await?;
	let mut guard = state.client.lock().await;
	*guard = Some(client);
	Ok("connected".into())
}

#[command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<String, String> {
	let mut guard = state.client.lock().await;
	*guard = None;
	Ok("disconnected".into())
}

#[command]
pub async fn send_command(
	state: State<'_, AppState>,
	command: Value,
) -> Result<Value, String> {
	// Lock only long enough to clone the send handles, then drop the guard so a
	// slow/lost response can't block other invoke calls (Tauri/Tokio: don't hold a
	// MutexGuard across a long await). send_with bounds the wait with a timeout.
	let (stdin_tx, pending) = {
		let guard = state.client.lock().await;
		let client = guard.as_ref().ok_or("Not connected to engine")?;
		client.handles()
	};
	crate::rpc::client::RpcClient::send_with(stdin_tx, pending, command).await
}

#[command]
pub async fn send_ui_response(
	state: State<'_, AppState>,
	response: Value,
) -> Result<Value, String> {
	let guard = state.client.lock().await;
	let client = guard.as_ref().ok_or("Not connected to engine")?;
	let line = serde_json::to_string(&response).map_err(|e| e.to_string())?;
	client.send_raw(line).await?;
	Ok(Value::Null)
}

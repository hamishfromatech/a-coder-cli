//! A-Coder serve (mobile bridge) management from the desktop settings panel.
//!
//! Spawns `a-coder-cli serve --cwd <dir>` as a child process — the same CLI
//! the user would run manually — and streams its stderr (pairing banner: the
//! listening address, token, QR and mDNS notice, plus `[serve]` logs) to the
//! frontend as `desktop://serve-line` events. Exit arrives as
//! `desktop://serve-exit`. The parsed banner is also cached in `ServeState` and
//! emitted as `desktop://serve-info`, so the settings card can remount (or be
//! reopened) without losing the pairing QR.
//!
//! The CLI owns token persistence and the pairing registry; the desktop reads
//! the registry to list/remove device records but never rewrites the token.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::cli::{build_cli_command, reconstructed_path};

/// Pairing banner state for the settings card. `running` is the child-process
/// state; `starting` is true between spawn and the listening line.
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeSnapshot {
	pub running: bool,
	pub starting: bool,
	pub endpoint: Option<String>,
	pub port: Option<u16>,
	pub tls: bool,
	pub pin: Option<String>,
	pub token: Option<String>,
	pub manual: Option<String>,
	pub name: Option<String>,
}

/// Handle to the running serve child so it can be stopped and polled. The
/// generation counter keeps an old completion watcher from observing a newer
/// child (which happens during rotate: stop, then start).
#[derive(Default)]
pub struct ServeState {
	pub child: Arc<Mutex<Option<Child>>>,
	pub snapshot: Arc<Mutex<ServeSnapshot>>,
	pub generation: Arc<AtomicU64>,
}

/// One device in the bridge's pairing registry (`serve/clients.json`).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeDevice {
	pub id: String,
	pub name: String,
	pub platform: Option<String>,
	pub last_seen: Option<String>,
	pub added_at: Option<String>,
}

/// Registry read result. `available` is false when the bridge has not created
/// the file yet; `error` carries parse/read failures without hiding the path.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeRegistry {
	pub available: bool,
	pub path: String,
	pub devices: Vec<ServeDevice>,
	pub error: Option<String>,
}

fn emit_snapshot(app: &AppHandle, snapshot: &ServeSnapshot) {
	let _ = app.emit("desktop://serve-info", snapshot);
}

/// Fold one stderr line into the snapshot. Returns true when it changed.
fn apply_banner_line(snapshot: &mut ServeSnapshot, line: &str) -> bool {
	// Log lines (including the mDNS notice) carry the bridge's `[serve]` prefix;
	// the pairing banner itself does not.
	let line = line.strip_prefix("[serve] ").unwrap_or(line);
	let mut changed = false;
	if let Some(rest) = line.strip_prefix("a-coder-cli serve listening on ") {
		let endpoint = rest.trim();
		if !endpoint.is_empty() {
			snapshot.endpoint = Some(endpoint.to_string());
			snapshot.port = endpoint
				.rsplit_once(':')
				.and_then(|(_, port)| port.trim().parse::<u16>().ok());
			snapshot.tls = endpoint.starts_with("wss://");
			snapshot.starting = false;
			changed = true;
		}
	}
	if let Some(rest) = line.strip_prefix("TLS certificate pin (SHA-256): ") {
		let pin = rest.trim();
		if !pin.is_empty() {
			snapshot.pin = Some(pin.to_string());
			snapshot.tls = true;
			changed = true;
		}
	}
	if let Some(rest) = line.strip_prefix("Pairing token: ") {
		snapshot.token = Some(rest.trim().to_string());
		changed = true;
	}
	if let Some(rest) = line.strip_prefix("  manual: ") {
		snapshot.manual = Some(rest.trim().to_string());
		changed = true;
	}
	if let Some(rest) = line.strip_prefix("mDNS: ") {
		if let Some((_, name)) = rest.split_once(" announced as \"") {
			snapshot.name = Some(name.trim_end_matches('"').to_string());
			changed = true;
		}
	}
	changed
}

fn serve_dir() -> Result<PathBuf, String> {
	crate::settings::global_serve_dir()
}

fn registry_path() -> Result<PathBuf, String> {
	Ok(serve_dir()?.join("clients.json"))
}

fn first_string<'a>(entry: &'a Value, keys: &[&str]) -> Option<&'a str> {
	for key in keys {
		if let Some(value) = entry.get(*key).and_then(Value::as_str) {
			if !value.trim().is_empty() {
				return Some(value);
			}
		}
	}
	None
}

fn device_key(entry: &Value, index: usize) -> String {
	if let Some(id) = first_string(entry, &["id", "deviceId", "device_id", "tokenId"]) {
		return id.to_string();
	}
	let name = first_string(
		entry,
		&["name", "deviceName", "device_name", "device", "label"],
	)
	.unwrap_or("Device");
	let added = first_string(
		entry,
		&["addedAt", "added_at", "pairedAt", "paired_at", "createdAt"],
	)
	.unwrap_or("");
	format!("{name}|{added}|{index}")
}

fn registry_entries(value: &Value) -> Vec<&Value> {
	match value {
		Value::Array(items) => items.iter().collect(),
		Value::Object(map) => map
			.get("devices")
			.and_then(Value::as_array)
			.map(|items| items.iter().collect())
			.unwrap_or_default(),
		_ => Vec::new(),
	}
}

fn normalize_device(entry: &Value, index: usize) -> ServeDevice {
	ServeDevice {
		id: device_key(entry, index),
		name: first_string(
			entry,
			&["name", "deviceName", "device_name", "device", "label"],
		)
		.unwrap_or("Unknown device")
		.to_string(),
		platform: first_string(entry, &["platform", "os", "kind"]).map(str::to_string),
		last_seen: first_string(
			entry,
			&["lastSeen", "last_seen", "lastConnected", "last_connected"],
		)
		.map(str::to_string),
		added_at: first_string(
			entry,
			&["addedAt", "added_at", "pairedAt", "paired_at", "createdAt"],
		)
		.map(str::to_string),
	}
}

fn read_registry() -> ServeRegistry {
	let path = match registry_path() {
		Ok(path) => path,
		Err(error) => {
			return ServeRegistry {
				available: false,
				path: String::new(),
				devices: Vec::new(),
				error: Some(error),
			};
		}
	};
	let display_path = path.display().to_string();
	if !path.exists() {
		return ServeRegistry {
			available: false,
			path: display_path,
			devices: Vec::new(),
			error: None,
		};
	}
	let bytes = match std::fs::read(&path) {
		Ok(bytes) => bytes,
		Err(error) => {
			return ServeRegistry {
				available: true,
				path: display_path,
				devices: Vec::new(),
				error: Some(format!("Could not read the device registry: {error}")),
			};
		}
	};
	let value: Value = match serde_json::from_slice(&bytes) {
		Ok(value) => value,
		Err(error) => {
			return ServeRegistry {
				available: true,
				path: display_path,
				devices: Vec::new(),
				error: Some(format!("The device registry is not valid JSON: {error}")),
			};
		}
	};
	let devices = registry_entries(&value)
		.iter()
		.enumerate()
		.map(|(index, entry)| normalize_device(entry, index))
		.collect();
	ServeRegistry {
		available: true,
		path: display_path,
		devices,
		error: None,
	}
}

/// Remove one entry from a parsed registry, preserving the container shape and
/// every other key (forward-compatible with fields the bridge adds later).
fn remove_device_from_registry(value: &mut Value, device_id: &str) -> bool {
	match value {
		Value::Array(items) => {
			let before = items.len();
			let mut index = 0;
			items.retain(|entry| {
				let key = device_key(entry, index);
				index += 1;
				key != device_id
			});
			before != items.len()
		}
		Value::Object(map) => {
			let Some(Value::Array(items)) = map.get_mut("devices") else {
				return false;
			};
			let before = items.len();
			let mut index = 0;
			items.retain(|entry| {
				let key = device_key(entry, index);
				index += 1;
				key != device_id
			});
			before != items.len()
		}
		_ => false,
	}
}

fn write_registry(path: &PathBuf, value: &Value) -> Result<(), String> {
	let bytes = serde_json::to_vec_pretty(value)
		.map_err(|error| format!("Could not serialise the device registry: {error}"))?;
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent)
			.map_err(|error| format!("Could not create the serve state directory: {error}"))?;
	}
	let tmp = path.with_extension("json.tmp");
	std::fs::write(&tmp, bytes)
		.map_err(|error| format!("Could not write the device registry: {error}"))?;
	// Windows does not replace an existing file with rename(); remove it first.
	#[cfg(windows)]
	let _ = std::fs::remove_file(path);
	std::fs::rename(&tmp, path)
		.map_err(|error| format!("Could not replace the device registry: {error}"))?;
	Ok(())
}

/// Stop the child gracefully: SIGTERM so `serve` can stop its engine, then a
/// short grace period before SIGKILL.
async fn terminate_child(child: &mut Child) {
	#[cfg(unix)]
	{
		if let Some(pid) = child.id() {
			// Safety: `pid` is this child's live process id; SIGTERM has no
			// memory-safety consequences.
			unsafe {
				libc::kill(pid as i32, libc::SIGTERM);
			}
		}
		if tokio::time::timeout(Duration::from_secs(3), child.wait())
			.await
			.is_err()
		{
			let _ = child.start_kill();
			let _ = child.wait().await;
		}
		return;
	}
	#[cfg(not(unix))]
	{
		let _ = child.start_kill();
		let _ = child.wait().await;
	}
}

async fn clear_snapshot(app: &AppHandle, state: &ServeState) {
	let snapshot = {
		let mut guard = state.snapshot.lock().await;
		*guard = ServeSnapshot::default();
		guard.clone()
	};
	emit_snapshot(app, &snapshot);
}

/// Spawn `a-coder-cli serve` for a workspace directory. Pass `rotate` to
/// regenerate the persisted pairing token (old clients fail to reconnect with
/// 401). Banner/log lines are emitted as `desktop://serve-line`; the parsed
/// banner as `desktop://serve-info`; exit as `desktop://serve-exit`.
#[tauri::command]
pub async fn serve_start(
	app: AppHandle,
	state: State<'_, ServeState>,
	cwd: String,
	port: Option<u16>,
	rotate: Option<bool>,
) -> Result<String, String> {
	{
		let mut guard = state.child.lock().await;
		if let Some(child) = guard.as_mut() {
			match child.try_wait() {
				Ok(None) => return Err("The mobile bridge is already running.".into()),
				// A stale handle from a process that already exited: replace it.
				_ => *guard = None,
			}
		}
	}

	let cli_path = crate::cli::resolve_cli_path(None)?;
	let mut args: Vec<String> = vec!["serve".into(), "--cwd".into(), cwd.clone()];
	if let Some(p) = port {
		args.push("--port".into());
		args.push(p.to_string());
	}
	if rotate == Some(true) {
		args.push("--rotate".into());
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

	let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
	{
		let mut guard = state.snapshot.lock().await;
		*guard = ServeSnapshot {
			running: true,
			starting: true,
			..ServeSnapshot::default()
		};
		emit_snapshot(&app, &guard);
	}

	if let Some(stderr) = child.stderr.take() {
		let emitter = app.clone();
		let snapshot_slot = state.snapshot.clone();
		tokio::spawn(async move {
			let mut reader = BufReader::new(stderr);
			let mut line = String::new();
			loop {
				line.clear();
				match reader.read_line(&mut line).await {
					Ok(0) | Err(_) => break,
					Ok(_) => {
						let trimmed = line.trim_end().to_string();
						if trimmed.is_empty() {
							continue;
						}
						let _ = emitter.emit("desktop://serve-line", trimmed.clone());
						let updated = {
							let mut snapshot = snapshot_slot.lock().await;
							if apply_banner_line(&mut snapshot, &trimmed) {
								Some(snapshot.clone())
							} else {
								None
							}
						};
						if let Some(snapshot) = updated {
							emit_snapshot(&emitter, &snapshot);
						}
					}
				}
			}
		});
	}

	*state.child.lock().await = Some(child);

	// Completion watcher: poll the slot so serve_stop can still clear it. The
	// generation check makes a watcher bow out when a newer serve replaced it.
	let exit_emitter = app.clone();
	let poll_slot = state.child.clone();
	let poll_snapshot = state.snapshot.clone();
	let poll_generation = state.generation.clone();
	tokio::spawn(async move {
		let exit_code;
		loop {
			if poll_generation.load(Ordering::SeqCst) != generation {
				return;
			}
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
				None => tokio::time::sleep(Duration::from_millis(250)).await,
			}
		}
		if poll_generation.load(Ordering::SeqCst) == generation {
			let snapshot = {
				let mut guard = poll_snapshot.lock().await;
				*guard = ServeSnapshot::default();
				guard.clone()
			};
			emit_snapshot(&exit_emitter, &snapshot);
			let _ = exit_emitter.emit("desktop://serve-exit", exit_code);
			let mut guard = poll_slot.lock().await;
			*guard = None;
		}
	});

	Ok("started".into())
}

/// Stop the running mobile bridge, if any. The child gets SIGTERM first so the
/// CLI can shut its engine down cleanly.
#[tauri::command]
pub async fn serve_stop(app: AppHandle, state: State<'_, ServeState>) -> Result<String, String> {
	let child = { state.child.lock().await.take() };
	match child {
		Some(mut child) => {
			terminate_child(&mut child).await;
			clear_snapshot(&app, &state).await;
			Ok("stopped".into())
		}
		None => {
			clear_snapshot(&app, &state).await;
			Ok("no serve bridge in progress".into())
		}
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

/// Current bridge state + parsed pairing banner (survives settings remounts).
#[tauri::command]
pub async fn serve_info(state: State<'_, ServeState>) -> Result<ServeSnapshot, String> {
	Ok(state.snapshot.lock().await.clone())
}

/// Devices recorded by the bridge in `serve/clients.json`.
#[tauri::command]
pub async fn serve_devices() -> Result<ServeRegistry, String> {
	Ok(read_registry())
}

/// Remove one device record from the bridge registry. Access revocation is a
/// token-level operation (`serve_start` with `rotate`); this only clears the
/// pairing record shown in Settings.
#[tauri::command]
pub async fn serve_remove_device(device_id: String) -> Result<ServeRegistry, String> {
	let path = registry_path()?;
	let bytes = std::fs::read(&path).map_err(|error| {
		format!(
			"Could not read the device registry at {}: {error}",
			path.display()
		)
	})?;
	let mut value: Value = serde_json::from_slice(&bytes)
		.map_err(|error| format!("The device registry is not valid JSON: {error}"))?;
	if !remove_device_from_registry(&mut value, &device_id) {
		return Err("That device is no longer in the registry.".into());
	}
	write_registry(&path, &value)?;
	Ok(read_registry())
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn parses_plain_ws_banner() {
		let mut snapshot = ServeSnapshot::default();
		assert!(apply_banner_line(
			&mut snapshot,
			"a-coder-cli serve listening on ws://192.168.1.20:8787"
		));
		assert_eq!(snapshot.endpoint.as_deref(), Some("ws://192.168.1.20:8787"));
		assert_eq!(snapshot.port, Some(8787));
		assert!(!snapshot.tls);
		assert!(!snapshot.starting);
	}

	#[test]
	fn parses_prefixed_mdns_line() {
		let mut snapshot = ServeSnapshot::default();
		assert!(apply_banner_line(
			&mut snapshot,
			"[serve] mDNS: _a-coder._tcp announced as \"A-Coder on mac\"",
		));
		assert_eq!(snapshot.name.as_deref(), Some("A-Coder on mac"));
	}

	#[test]
	fn parses_tls_banner_and_pin() {
		let mut snapshot = ServeSnapshot::default();
		apply_banner_line(
			&mut snapshot,
			"a-coder-cli serve listening on wss://10.0.0.4:9443",
		);
		apply_banner_line(&mut snapshot, "TLS certificate pin (SHA-256): abcd1234");
		apply_banner_line(&mut snapshot, "Pairing token: tok");
		apply_banner_line(&mut snapshot, "  manual: tok-1234");
		apply_banner_line(
			&mut snapshot,
			"mDNS: _a-coder._tcp announced as \"A-Coder on mac\"",
		);
		assert!(snapshot.tls);
		assert_eq!(snapshot.pin.as_deref(), Some("abcd1234"));
		assert_eq!(snapshot.token.as_deref(), Some("tok"));
		assert_eq!(snapshot.manual.as_deref(), Some("tok-1234"));
		assert_eq!(snapshot.name.as_deref(), Some("A-Coder on mac"));
	}

	#[test]
	fn normalises_both_registry_shapes() {
		let array = json!([
			{"id": "d1", "name": "iPhone", "platform": "ios", "lastSeen": "2026-11-03T12:00:00Z", "addedAt": "2026-11-01T10:00:00Z"}
		]);
		let devices: Vec<_> = registry_entries(&array)
			.iter()
			.enumerate()
			.map(|(i, entry)| normalize_device(entry, i))
			.collect();
		assert_eq!(devices.len(), 1);
		assert_eq!(devices[0].id, "d1");
		assert_eq!(devices[0].name, "iPhone");
		assert_eq!(devices[0].platform.as_deref(), Some("ios"));

		let object = json!({"version": 1, "devices": [{"device_name": "Pixel", "last_seen": "x"}]});
		let devices: Vec<_> = registry_entries(&object)
			.iter()
			.enumerate()
			.map(|(i, entry)| normalize_device(entry, i))
			.collect();
		assert_eq!(devices.len(), 1);
		assert_eq!(devices[0].name, "Pixel");
		assert_eq!(devices[0].last_seen.as_deref(), Some("x"));
	}

	#[test]
	fn removes_a_device_and_keeps_other_keys() {
		let mut value = json!({
			"version": 1,
			"devices": [
				{"id": "a", "name": "iPhone"},
				{"id": "b", "name": "Pixel"}
			],
			"note": "keep me"
		});
		assert!(remove_device_from_registry(&mut value, "a"));
		assert_eq!(value["note"], "keep me");
		assert_eq!(value["devices"].as_array().unwrap().len(), 1);
		assert_eq!(value["devices"][0]["id"], "b");
		assert!(!remove_device_from_registry(&mut value, "missing"));
	}

	#[test]
	fn derives_a_key_without_an_id() {
		let entry = json!({"name": "iPhone", "addedAt": "2026-11-01"});
		assert_eq!(device_key(&entry, 0), "iPhone|2026-11-01|0");
	}
}

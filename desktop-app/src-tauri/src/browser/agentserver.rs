//! The agent browser MCP server: the coding-agent connects to this loopback
//! streamable-HTTP endpoint and gets browser tools — the same hands the
//! panel's page agent has, delivered over the CLI's `mcpServers` http
//! transport. Every op runs in the agent's tab (the one the panel currently
//! shows); navigation obeys the same public-host allow-list as the panel, and
//! real link clicks are handed back to the panel the way user clicks are.
//!
//! Minimal streamable-HTTP: JSON responses for requests, 202 for
//! notifications, `mcp-session-id` issued at initialize. No server→client
//! streams: tools answer complete results.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

static START: OnceLock<()> = OnceLock::new();
static PORT: OnceLock<u16> = OnceLock::new();
static SESSION: Mutex<Option<String>> = Mutex::new(None);
/// The settings page can turn the tools off; a disabled server answers no URLs
/// and refuses calls. Defaults on; the setting persists in the settings file.
static ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
const READ_CAP: usize = 256 * 1024;
/// The endpoint's fixed port, so the CLI's `mcpServers` entry survives app
/// restarts. Taken? The server binds an ephemeral port and reports that
/// instead (the panel surfaces the changed URL).
const PREFERRED_PORT: u16 = 47615;

/// Exposed to settings/docs: where the CLI's `mcpServers` http entry points.
/// Answers nothing on platforms without native page views (the tools would
/// need them).
#[tauri::command]
pub fn browser_agent_server_url<R: Runtime>(app: AppHandle<R>) -> Option<String> {
	start(&app).map(|port| format!("http://127.0.0.1:{port}/mcp"))
}

/// Starts the server once (called at app setup; settings later only gate
/// dispatch and the reported URL). None when the platform has no native page
/// views or the settings file says the tools are off.
pub(crate) fn ensure_started<R: Runtime>(app: &AppHandle<R>) -> Option<u16> {
	start(app)
}

fn start<R: Runtime>(app: &AppHandle<R>) -> Option<u16> {
	if !super::tabs::native_pages_supported() {
		return None;
	}
	if !enabled_at_startup() {
		log::info!("agent browser MCP server disabled in settings");
		return None;
	}
	if START.get().is_some() {
		return PORT.get().copied();
	}
	if START.set(()).is_err() {
		return PORT.get().copied();
	}
	let port = tauri::async_runtime::block_on(async {
		match TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).await {
			Ok(listener) => listener.local_addr().expect("local addr").port(),
			// Another listener owns the preferred port: fall back.
			Err(_) => TcpListener::bind(("127.0.0.1", 0))
				.await
				.expect("bind agent server")
				.local_addr()
				.expect("local addr")
				.port(),
		}
	});
	let _ = PORT.set(port);
	let app2 = app.clone();
	tauri::async_runtime::spawn(serve_loop(port, app2));
	log::info!("agent browser MCP server listening on port {port}");
	Some(port)
}

async fn serve_loop<R: Runtime>(port: u16, app: AppHandle<R>) {
	let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await else {
		return;
	};
	loop {
		match listener.accept().await {
			Ok((client, _)) => {
				let app = app.clone();
				tauri::async_runtime::spawn(async move {
					let _ = serve_connection(client, &app).await;
				});
			}
			Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
		}
	}
}

async fn serve_connection<R: Runtime>(
	mut client: tokio::net::TcpStream,
	app: &AppHandle<R>,
) -> Result<(), String> {
	let (method, path, headers, body) = read_request(&mut client).await.ok_or("no request")?;
	if path.split('?').next() != Some("/mcp") {
		respond(&mut client, 404, false, &json!({ "error": "not found" })).await;
		return Ok(());
	}
	match method.as_str() {
		"POST" => {
			let message: Value =
				serde_json::from_str(body.trim()).map_err(|error| error.to_string())?;
			let rpc_method = message
				.get("method")
				.and_then(Value::as_str)
				.unwrap_or_default()
				.to_string();
			if message.get("id").is_none() {
				// A notification (`notifications/initialized` and friends).
				respond(&mut client, 202, false, &json!({})).await;
				return Ok(());
			}
			let id = message.get("id").cloned().unwrap_or(Value::Null);
			let result: Result<Value, (i64, String)> = match rpc_method.as_str() {
				"initialize" => {
					let requested = message
						.pointer("/params/protocolVersion")
						.and_then(Value::as_str)
						.unwrap_or("2025-03-26");
					let protocol =
						if ["2024-11-05", "2025-03-26", "2025-06-18"].contains(&requested) {
							requested
						} else {
							"2025-03-26"
						};
					let session = Uuid::new_v4().to_string();
					let stored = session.clone();
					*SESSION.lock().map_err(|_| "session poisoned".to_string())? = Some(stored);
					respond_sessioned(
						&mut client,
						200,
						&id,
						&json!({
							"protocolVersion": protocol,
							"capabilities": { "tools": {} },
							"serverInfo": { "name": "a-coder-desktop-browser", "version": env!("CARGO_PKG_VERSION") }
						}),
						Some(&session),
					)
					.await;
					return Ok(());
				}
				"initialized" | "notifications/initialized" => {
					respond(&mut client, 202, false, &json!({})).await;
					return Ok(());
				}
				"ping" => Ok(json!({})),
				"tools/list" => Ok(tools_list()),
				"tools/call" => {
					let name = message
						.pointer("/params/name")
						.and_then(Value::as_str)
						.unwrap_or_default();
					let args = message
						.pointer("/params/arguments")
						.cloned()
						.unwrap_or(json!({}));
					match call_tool_checked(&app, name, &args).await {
						Ok(content) => Ok(json!({ "content": [content], "isError": false })),
						Err(error) => Ok(json!({
							"content": [{ "type": "text", "text": error }],
							"isError": true
						})),
					}
				}
				other => Err((-32601, format!("method not found: {other}"))),
			};
			let session = SESSION.lock().ok().and_then(|guard| guard.clone());
			match result {
				Ok(value) => {
					respond_sessioned(&mut client, 200, &id, &value, session.as_deref()).await
				}
				Err((code, message)) => {
					let payload = json!({
						"jsonrpc": "2.0", "id": id,
						"error": { "code": code, "message": message }
					});
					respond(&mut client, 200, false, &payload).await;
				}
			}
		}
		// No server→client streams on this endpoint.
		"GET" => {
			respond(
				&mut client,
				405,
				false,
				&json!({ "error": "no event streams" }),
			)
			.await
		}
		"DELETE" => {
			*SESSION.lock().map_err(|_| "session poisoned".to_string())? = None;
			respond(&mut client, 200, true, &json!({})).await;
		}
		_ => {
			respond(
				&mut client,
				405,
				false,
				&json!({ "error": "method not allowed" }),
			)
			.await
		}
	}
	Ok(())
}

/// The persisted preference at startup (the live toggling is a command).
fn enabled_at_startup() -> bool {
	super::browser_pref("agentTools")
		.and_then(|value| value.as_bool())
		.unwrap_or(true)
}

/// The settings toggle, applied live.
#[tauri::command]
pub fn browser_set_agent_server_enabled(enabled: bool) -> Result<(), String> {
	ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
	Ok(())
}

async fn call_tool_checked<R: Runtime>(
	app: &AppHandle<R>,
	name: &str,
	args: &Value,
) -> Result<Value, String> {
	if !ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
		return Err("Browser tools are disabled in Desktop settings.".into());
	}
	call_tool(app, name, args).await
}

fn tools_list() -> Value {
	let def = |name: &str, description: &str, properties: Value, required: Value| {
		json!({
			"name": name,
			"description": description,
			"inputSchema": { "type": "object", "properties": properties, "required": required }
		})
	};
	json!({
		"tools": [
			def("browser_tabs", "List the desktop browser panel's open tabs. browser tools run in the active tab; browser_navigate switches pages there.",
				json!({}), json!([])),
			def("browser_navigate", "Navigate the active tab to an http(s) URL (public hosts only). Opens the panel if it is closed.",
				json!({ "url": { "type": "string", "description": "The address to open, including https://" } }), json!(["url"])),
			def("browser_snapshot", "Read the page as text with stable [rN] element refs (buttons, links, fields with names, values and states). Use a ref from the answer for browser_click/type. Hidden text never appears.",
				json!({
					"fullPage": { "type": "boolean", "description": "Read the whole document instead of the visible viewport (bigger budget)." },
					"ref": { "type": "string", "description": "Read only inside a previously returned element ref (e.g. r12)." }
				}), json!([])),
			def("browser_click", "Click a page element by ref. Real links navigate the tab (reported in the answer). An error names the covering overlay when a dialog hides the element.",
				json!({ "ref": { "type": "string", "description": "A ref from browser_snapshot, e.g. r12" } }), json!(["ref"])),
			def("browser_type", "Type into a field: replaces its value the way frameworks see it. Secrets like password fields are redacted in every answer — you can fill, but you can never read one.",
				json!({
					"ref": { "type": "string" },
					"text": { "type": "string" },
					"submit": { "type": "boolean", "description": "Press Enter after typing. The answer includes the form's action and whether it contains a password field; the user must approve anything that sends their credentials." }
				}), json!(["ref", "text"])),
			def("browser_select", "Choose a dropdown option by its value or visible label.",
				json!({ "ref": { "type": "string" }, "value": { "type": "string" } }), json!(["ref", "value"])),
			def("browser_scroll", "Scroll down or up (about a viewport).",
				json!({ "direction": { "type": "string", "enum": ["down", "up", "top"] } }), json!(["direction"])),
			def("browser_press", "Press a key (e.g. Escape, Enter) on the focused element.",
				json!({ "key": { "type": "string" } }), json!(["key"])),
			def("browser_find", "Search the visible page for text; answers with refs, like snapshot.",
				json!({ "query": { "type": "string" } }), json!(["query"])),
			def("browser_screenshot", "Capture the active tab as a PNG image. Secret fields are masked by the page first, and frames are hidden.",
				json!({}), json!([])),
		]
	})
}

async fn call_tool<R: Runtime>(
	app: &AppHandle<R>,
	name: &str,
	args: &Value,
) -> Result<Value, String> {
	let shown = {
		let state = app.state::<super::tabs::TabsState>();
		let shown = state.inner.lock().unwrap().shown.clone();
		shown
	};
	if shown.is_none() && name != "browser_navigate" {
		return Err(
			"No browser tab is open. Call browser_navigate to open one first (the panel opens for the user)."
				.to_string(),
		);
	}
	let tab_id = shown;
	let no_tab = || {
		"No browser tab is open. Call browser_navigate to open one first (the panel opens for the user)."
			.to_string()
	};
	let text = |value: String| json!({ "type": "text", "text": value });
	match name {
		"browser_tabs" => {
			let state = app.state::<super::tabs::TabsState>();
			let inner = state.inner.lock().unwrap();
			let shown = inner.shown.clone();
			let tabs: Vec<Value> = inner
				.created
				.iter()
				.map(|tab_id| {
					json!({
						"tabId": tab_id,
						"url": inner.urls.get(tab_id).cloned().unwrap_or_default(),
						"title": inner.titles.get(tab_id).cloned().unwrap_or_default(),
						"active": shown.as_deref() == Some(tab_id.as_str()),
					})
				})
				.collect();
			Ok(text(format!(
				"Open tabs:\n\n{}",
				serde_json::to_string_pretty(&tabs).unwrap_or_default()
			)))
		}
		"browser_navigate" => {
			let url = args
				.get("url")
				.and_then(Value::as_str)
				.ok_or("missing url")?;
			// The panel may be closed: the user sees it open with the page.
			if app
				.state::<super::tabs::TabsState>()
				.inner
				.lock()
				.unwrap()
				.created
				.is_empty()
			{
				super::emit(
					app,
					super::BrowserEvent::OpenPanel {
						url: url.to_string(),
					},
				);
				return Ok(text(format!(
					"Opening {url} in a new panel tab for the user; the page loads there."
				)));
			}
			let tab_id = tab_id.ok_or_else(no_tab)?;
			super::tabs::navigate_tab(app, &tab_id, url).await?;
			Ok(text(format!(
				"Navigating the active tab to {url}; call browser_snapshot once it settles (~1s)."
			)))
		}
		"browser_snapshot" | "browser_find" | "browser_click" | "browser_type"
		| "browser_select" | "browser_scroll" | "browser_press" => {
			let op = match name {
				"browser_snapshot" => {
					json!({ "op": "snapshot", "fullPage": args.get("fullPage").and_then(Value::as_bool).unwrap_or(false),
					"ref": args.get("ref") })
				}
				"browser_find" => {
					json!({ "op": "find", "query": args.get("query").and_then(Value::as_str).unwrap_or_default() })
				}
				"browser_click" => {
					json!({ "op": "click", "ref": args.get("ref"), "navigateLinks": true })
				}
				"browser_type" => {
					json!({ "op": "type", "ref": args.get("ref"), "text": args.get("text"),
					"submit": args.get("submit").and_then(Value::as_bool).unwrap_or(false) })
				}
				"browser_select" => {
					json!({ "op": "select", "ref": args.get("ref"), "value": args.get("value") })
				}
				"browser_scroll" => {
					json!({ "op": "scroll", "direction": args.get("direction").and_then(Value::as_str).unwrap_or("down") })
				}
				"browser_press" => {
					json!({ "op": "press", "key": args.get("key").and_then(Value::as_str).unwrap_or("Enter") })
				}
				_ => return Err("unknown op".into()),
			};
			let tab_id = tab_id.ok_or_else(no_tab)?;
			let answer = super::agent::run_op(app, &tab_id, &op, true).await?;
			// A navigation handed back from a click must go through the panel,
			// exactly like a user's click: the address stays true.
			let mut inner = answer.get("result").cloned().unwrap_or(json!({}));
			if let Some(navigate_url) = inner
				.get("navigate")
				.and_then(Value::as_str)
				.map(str::to_string)
			{
				let navigated = navigate_url.len() <= super::security::MAX_REPORTABLE_URL;
				if navigated {
					super::tabs::navigate_tab(app, &tab_id, &navigate_url).await?;
				}
				if let Some(obj) = inner.as_object_mut() {
					obj.remove("navigate");
				}
				let answer_note = if navigated {
					format!("The click followed a link; the tab is navigating to {navigate_url}. Take a new browser_snapshot when it settles.")
				} else {
					"The link's address is too long to follow. Snapshot the page and use its navigation another way.".to_string()
				};
				Ok(text(format!(
					"{}\n\n{answer_note}",
					serde_json::to_string_pretty(&inner).unwrap_or_default()
				)))
			} else {
				Ok(text(format!(
					"{}\n\n(quietMs = how long the page has been idle; re-snapshot after actions.)",
					serde_json::to_string_pretty(&answer).unwrap_or_default()
				)))
			}
		}
		"browser_screenshot" => {
			let tab_id = tab_id.ok_or_else(no_tab)?;
			let png = super::capture::capture_png(app, &tab_id).await?;
			Ok(
				json!({ "type": "image", "data": BASE64_STANDARD.encode(png), "mimeType": "image/png" }),
			)
		}
		_ => Err(format!("unknown tool: {name}")),
	}
}

async fn read_request(
	client: &mut tokio::net::TcpStream,
) -> Option<(String, String, Vec<(String, String)>, String)> {
	let mut buffer = Vec::new();
	let mut chunk = [0u8; 8192];
	let head_end = loop {
		let read = client.read(&mut chunk).await.ok()?;
		if read == 0 {
			return None;
		}
		buffer.extend_from_slice(&chunk[..read]);
		if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
			break end;
		}
		if buffer.len() > 64 * 1024 {
			return None;
		}
	};
	let head_text = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
	let mut lines = head_text.split("\r\n");
	let request_line = lines.next()?.to_string();
	let mut parts = request_line.split_ascii_whitespace();
	let method = parts.next()?.to_string();
	let path = parts.next()?.to_string();
	let mut headers = Vec::new();
	for line in lines {
		if let Some((name, value)) = line.split_once(':') {
			headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
		}
	}
	let length: usize = headers
		.iter()
		.find(|(name, _)| name == "content-length")
		.and_then(|(_, value)| value.parse().ok())
		.unwrap_or(0);
	let mut body = buffer.split_off(head_end + 4);
	while body.len() < length && body.len() <= READ_CAP {
		let read = client.read(&mut chunk).await.ok()?;
		if read == 0 {
			break;
		}
		body.extend_from_slice(&chunk[..read]);
	}
	body.truncate(length.min(READ_CAP));
	Some((
		method,
		path,
		headers,
		String::from_utf8_lossy(&body).into_owned(),
	))
}

async fn respond(mut client: &mut tokio::net::TcpStream, status: u16, empty: bool, body: &Value) {
	respond_sessioned(&mut client, status, &Value::Null, body, None).await;
	let _ = empty;
}

async fn respond_sessioned(
	mut client: &mut tokio::net::TcpStream,
	status: u16,
	id: &Value,
	body: &Value,
	session: Option<&str>,
) {
	let reason = match status {
		200 => "OK",
		202 => "Accepted",
		404 => "Not Found",
		405 => "Method Not Allowed",
		_ => "Server Error",
	};
	let text = if id.is_null() {
		serde_json::to_string(body).unwrap_or_else(|_| "{}".into())
	} else {
		serde_json::to_string(&json!({ "jsonrpc": "2.0", "id": id, "result": body }))
			.unwrap_or_else(|_| "{}".into())
	};
	let session_header = session
		.map(|session| format!("Mcp-Session-Id: {session}\r\n"))
		.unwrap_or_default();
	let head = format!(
		"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{session_header}Connection: close\r\n\r\n{text}",
		text.len()
	);
	let _ = client.write_all(head.as_bytes()).await;
	let _ = client.flush().await;
}

use base64::Engine as _;
static BASE64_STANDARD: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

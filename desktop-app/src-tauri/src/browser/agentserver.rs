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

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, Url};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

static START: OnceLock<()> = OnceLock::new();
static PORT: OnceLock<u16> = OnceLock::new();
/** Guards the one-time engine-settings provisioning (first decision wins). */
static SETTINGS_PROVISIONED: OnceLock<()> = OnceLock::new();
static SESSION: Mutex<Option<String>> = Mutex::new(None);
/// The settings page can turn the tools off; a disabled server answers no URLs
/// and refuses calls. Defaults on; the setting persists in the settings file.
static ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
const READ_CAP: usize = 256 * 1024;
/// The endpoint's fixed port, so the CLI's `mcpServers` entry survives app
/// restarts. Taken? The server binds an ephemeral port and reports that
/// instead (the panel surfaces the changed URL).
const PREFERRED_PORT: u16 = 47615;

/// Request-aware quiet: after a navigation, no request may be in flight and
/// at least this much time must have passed since the last request change.
const SETTLE_WINDOW_MS: u64 = 120;
/// How long a settle may wait before giving up and answering anyway.
const SETTLE_CAP: Duration = Duration::from_millis(10_000);
/// The readiness poll interval while a settle is waiting.
const SETTLE_POLL: Duration = Duration::from_millis(250);

/// How long a parked agent op waits for the panel's approval before it
/// answers on its own (an MCP client's own timeouts would otherwise be the
/// only guard, and the answer there is far less direct).
const APPROVAL_CAP: Duration = Duration::from_secs(300);
/// Unanswered asks allowed at once, so a runaway agent on a hold-every-op
/// page cannot pile up dialogs without end (downloads cap the same way).
const MAX_AGENT_ASKS: usize = 8;

/// Hosts the agent tools never touch without a fresh, per-op approval. The
/// list is deliberately small and exact: mailbox, account sign-in, payments
/// and the big social profiles — sites where a stray click or a snapshot of
/// a logged-in session costs real damage. It matches a host and its
/// subdomains only (suffix on a dot boundary); no wildcard or keyword
/// guessing, because a wrong guess either annoys the user forever or worse,
/// quietly misses the one site it should have caught. Extend it by name when
/// a site earns it; ordinary hosts rely on the per-site approval memory
/// (first op asks, remembered hosts pass, the user can always say no).
const SENSITIVE_HOSTS: &[&str] = &[
	// Mailbox (webmail the user stays signed into).
	"mail.google.com",
	"gmail.com",
	"outlook.com",
	"outlook.live.com",
	"outlook.office.com",
	// Account sign-in surfaces, credentials and sessions.
	"accounts.google.com",
	"login.microsoftonline.com",
	"login.live.com",
	// Payments.
	"paypal.com",
	"chase.com",
	"wellsfargo.com",
	// Social profiles with a large blast radius (posting, DMs, contacts).
	"facebook.com",
	"instagram.com",
	"x.com",
];

/// True when `host` is the sensitive host itself or one of its subdomains:
/// the comparison is on a dot boundary, so `evil-mail.google.com` and
/// `mail.google.com.evil.tld` never trip it.
fn is_sensitive_host(host: &str) -> bool {
	SENSITIVE_HOSTS.iter().any(|known| {
		host == *known
			|| host
				.strip_suffix(known)
				.is_some_and(|prefix| prefix.ends_with('.'))
	})
}

/// The http(s) host behind a page URL, lowercased without its trailing dot;
/// None when the page is not a named web page (about:blank or the panel's
/// reserved pre-navigation address), which is nothing for a gate to hold.
fn host_of(url: &str) -> Option<String> {
	let parsed = Url::parse(url).ok()?;
	if parsed.scheme() != "http" && parsed.scheme() != "https" {
		return None;
	}
	parsed
		.host_str()
		.map(|host| host.trim_end_matches('.').to_lowercase())
		.filter(|host| !host.is_empty())
}

/// What the gate says about one agent op on one host.
enum GateCheck {
	/// Pass: not sensitive, and this host's earlier approval is remembered.
	Allowed,
	/// Hold for the panel; sensitive hosts ask on every op by rule, every
	/// other host asks until the user allows with the memory enabled.
	Ask { sensitive: bool },
}

/// The panel's permission mode for agent tool ops. `Ask` holds every
/// un-remembered host; `Auto` runs ordinary hosts without asking but keeps
/// the sensitive list (mailbox, sign-in, payments) asking — no automation
/// tier ever touches those without the user.
#[derive(Clone, Copy, PartialEq, Eq)]
enum GateMode {
	Ask,
	Auto,
}

fn gate_mode() -> GateMode {
	match super::browser_pref("agentPermissionMode")
		.and_then(|value| value.as_str().map(str::to_string))
		.as_deref()
	{
		Some("auto") => GateMode::Auto,
		_ => GateMode::Ask,
	}
}

/// The pure gate: the sensitive list outranks both the memory and the mode.
fn gate_check(host: &str, approved: &[String], mode: GateMode) -> GateCheck {
	if is_sensitive_host(host) {
		GateCheck::Ask { sensitive: true }
	} else if mode == GateMode::Auto || approved.iter().any(|known| known == host) {
		GateCheck::Allowed
	} else {
		GateCheck::Ask { sensitive: false }
	}
}

/// The user-approved hosts the gate remembered, from the CLI's global
/// settings file (`browser.agentApprovedHosts`); unreadable or absent means
/// an empty list — every new host asks.
fn approved_hosts() -> Vec<String> {
	super::browser_pref("agentApprovedHosts")
		.and_then(|value| value.as_array().cloned())
		.unwrap_or_default()
		.into_iter()
		.filter_map(|value| value.as_str().map(str::to_string))
		.collect()
}

/// The permission gate's parked calls: one entry per agent op on hold while
/// the panel's dialog waits for the user. `browser_agent_decide` removes an
/// entry by ask id and answers it through the oneshot sender.
#[derive(Default)]
pub struct AgentGateState {
	inner: Mutex<HashMap<String, PendingAsk>>,
}

struct PendingAsk {
	host: String,
	answer: tokio::sync::oneshot::Sender<bool>,
}

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
		ensure_settings_entry(None);
		return None;
	}
	if !enabled_at_startup() {
		log::info!("agent browser MCP server disabled in settings");
		ensure_settings_entry(None);
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
	ensure_settings_entry(Some(&format!("http://127.0.0.1:{port}/mcp")));
	Some(port)
}

/// Ensure the engine's global settings file carries the `desktop-browser`
/// mcpServers entry so the coding agent gets the panel's browser tools with no
/// manual setup. `Some(url)` upserts (only entries that are ours by name and
/// shape are rewritten; hand-made custom entries are left alone; an absent
/// entry is added); `None` — the server is off or the platform can't do it —
/// removes a previously provisioned entry. Runs once per app start.
fn ensure_settings_entry(url: Option<&str>) {
	if SETTINGS_PROVISIONED.set(()).is_err() {
		return;
	}
	let Ok(path) = crate::settings::global_settings_path() else {
		return;
	};
	let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
	let mut root: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
	let changed = upsert_mcp_servers(&mut root, url);
	if !changed {
		return;
	}
	match serde_json::to_string_pretty(&root) {
		Ok(body) => {
			let result = std::fs::write(&path, format!("{body}\n"));
			if result.is_err() {
				log::warn!("could not write desktop-browser mcpServers entry: {:?}", result.err());
			}
		}
		Err(_) => return,
	}
}

/// Pure part of the provisioning: returns true when the servers list was
/// modified. `url = None` drops an entry that looks provisioned; otherwise the
/// named entry must exist with this exact URL (missing → added, ours
/// mis-pointed → fixed, user-customized → left alone).
fn upsert_mcp_servers(root: &mut serde_json::Value, url: Option<&str>) -> bool {
	// Foreign config shapes (e.g. map-style mcpServers used by other tools)
	// are never rewritten — provisioning may not silently reformat a file the
	// engine or another app owns.
	if root.get("mcpServers").is_some_and(|v| !v.is_array()) {
		return false;
	}
	let servers = match root.get_mut("mcpServers").and_then(|v| v.as_array_mut()) {
		Some(existing) => existing,
		None => {
			if url.is_none() {
				return false; // nothing to remove
			}
			root["mcpServers"] = serde_json::json!([]);
			root["mcpServers"].as_array_mut().expect("just set")
		}
	};

	let ours_index = servers.iter().position(|entry| {
		entry.get("name").and_then(|v| v.as_str()) == Some("desktop-browser")
			&& entry.get("transport").and_then(|v| v.as_str()) == Some("http")
	});

	match url {
		None => match ours_index {
			None => false,
			Some(index) => {
				// Only drop entries that match the shape we would have made; a
				// hand-customized desktop-browser stays for its owner to remove.
				let entry = &servers[index];
				let managed = entry.get("headers").is_none()
					&& entry.get("args").is_none()
					&& entry
						.get("commandOrUrl")
						.and_then(|v| v.as_str())
						.is_some_and(|u| u.starts_with("http://127.0.0.1:"));
				if managed {
					servers.remove(index);
				}
				managed
			}
		},
		Some(target) => match ours_index {
			None => {
				servers.push(serde_json::json!({
					"name": "desktop-browser",
					"transport": "http",
					"commandOrUrl": target
				}));
				true
			}
			Some(index) => {
				let current = servers[index]
					.get("commandOrUrl")
					.and_then(|v| v.as_str())
					.unwrap_or_default();
				if current == target {
					return false;
				}
				if servers[index].get("headers").is_none() && servers[index].get("args").is_none() {
					servers[index]["commandOrUrl"] = serde_json::Value::String(target.to_string());
					return true;
				}
				false
			}
		},
	}
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
	let (method, path, _headers, body) = read_request(&mut client).await.ok_or("no request")?;
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

/// The target the gate holds for one tool call: the page the tool is about
/// to read or drive. `browser_navigate` is judged by where it is heading;
/// everything else by the active tab's current page. `browser_tabs` lists
/// addresses and `browser_scroll` moves the view: neither reads page content
/// nor drives input, so they pass. A page with no named host (about:blank,
/// the panel's reserved pre-navigation address) has nothing to gate.
fn gate_target_url<R: Runtime>(
	app: &AppHandle<R>,
	name: &str,
	args: &Value,
	tab_id: Option<&str>,
) -> Option<String> {
	if name == "browser_tabs" || name == "browser_scroll" {
		return None;
	}
	if name == "browser_navigate" {
		return args.get("url").and_then(Value::as_str).map(str::to_string);
	}
	let tab_id = tab_id?;
	app.state::<super::tabs::TabsState>()
		.inner
		.lock()
		.unwrap()
		.urls
		.get(tab_id)
		.cloned()
}

/// Holds the call until the panel answers, the way a download prompt holds
/// its staging step: the ask is registered, `AgentAsk` goes to the panel,
/// and the oneshot receiver waits for `browser_agent_decide`. `None` means
/// nothing allowed the op (denied, the unanswered cap ran out, or the call
/// piled up past the pending-ask limit).
async fn ask_user<R: Runtime>(
	app: &AppHandle<R>,
	tab_id: &str,
	host: &str,
	url: &str,
	op: &str,
	sensitive: bool,
) -> Option<bool> {
	let id = Uuid::new_v4().to_string();
	let (answer, wait) = tokio::sync::oneshot::channel();
	{
		let state = app.state::<AgentGateState>();
		let mut inner = state.inner.lock().unwrap();
		if inner.len() >= MAX_AGENT_ASKS {
			return None;
		}
		inner.insert(
			id.clone(),
			PendingAsk {
				host: host.to_string(),
				answer,
			},
		);
	}
	super::emit(
		app,
		super::BrowserEvent::AgentAsk {
			id,
			tab_id: tab_id.to_string(),
			host: host.to_string(),
			url: url.to_string(),
			op: op.to_string(),
			sensitive,
		},
	);
	match tokio::time::timeout(APPROVAL_CAP, wait).await {
		Ok(Ok(allow)) => Some(allow),
		// Timed out, the channel dropped (the pending record vanished), or
		// the sender went away: all read as "the op did not happen".
		_ => None,
	}
}

/// Runs the gate for one agent tool call. `Ok(None)` means the op is clear
/// to run; `Ok(Some(text))` is the answer the tool gives instead of it
/// (denied, expired, or the pending-ask limit), always written as plain
/// guidance so a gate refusal cannot look like a server error.
async fn permission_gate<R: Runtime>(
	app: &AppHandle<R>,
	name: &str,
	args: &Value,
	tab_id: Option<&str>,
) -> Result<Option<Value>, String> {
	let Some(url) = gate_target_url(app, name, args, tab_id) else {
		return Ok(None);
	};
	let Some(host) = host_of(&url) else {
		return Ok(None);
	};
	let sensitive = match gate_check(&host, &approved_hosts(), gate_mode()) {
		GateCheck::Allowed => return Ok(None),
		GateCheck::Ask { sensitive } => sensitive,
	};
	// Before the page exists the panel parks the ask on "" (that tab id is
	// what the download prompts use too); the dialog still shows the site.
	let answer = ask_user(app, tab_id.unwrap_or(""), &host, &url, name, sensitive).await;
	match answer {
		Some(true) => Ok(None),
		Some(false) => Ok(Some(denied_text(name, &host, "declined"))),
		None => Ok(Some(denied_text(name, &host, "not answered within 5 minutes"))),
	}
}

fn denied_text(name: &str, host: &str, why: &str) -> Value {
	let text = format!(
		"Permission gate: the user was asked about {name} on {host} and {why}. Do not drive this site further without their explicit go-ahead; they can open it themselves."
	);
	json!({ "type": "text", "text": text })
}

/// The panel's answer to a parked agent op: allow runs it, deny answers the
/// gate refusal. An allow also remembers the host for later ops unless the
/// host is sensitive (those ask every time by rule) or the user kept the
/// memory off; the memory persists in the global settings file via settings
/// set, exactly where the gate reads it back.
#[tauri::command]
pub async fn browser_agent_decide<R: Runtime>(
	webview: tauri::Webview<R>,
	id: String,
	allow: bool,
	remember: bool,
) -> Result<(), String> {
	super::require_main(&webview)?;
	let app = webview.app_handle().clone();
	let pending = app.state::<AgentGateState>().inner.lock().unwrap().remove(&id);
	let Some(pending) = pending else {
		return Err("That approval request is no longer pending".into());
	};
	if allow && remember && !is_sensitive_host(&pending.host) {
		let approved = approved_hosts();
		let merged = super::merge_string_lists(&approved, &pending.host);
		if merged != approved {
			super::write_browser_pref("agentApprovedHosts", json!(merged))?;
		}
	}
	let _ = pending.answer.send(allow);
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
			def("browser_navigate", "Navigate the active tab to an http(s) URL (public hosts only). The answer waits for the page to settle. Opens the panel if it is closed.",
				json!({ "url": { "type": "string", "description": "The address to open, including https://" } }), json!(["url"])),
			def("browser_snapshot", "Read the page as text with stable [rN] element refs (buttons, links, fields with names, values and states). Use a ref from the answer for browser_click/type. Hidden text never appears.",
				json!({
					"fullPage": { "type": "boolean", "description": "Read the whole document instead of the visible viewport (bigger budget)." },
					"ref": { "type": "string", "description": "Read only inside a previously returned element ref (e.g. r12)." }
				}), json!([])),
			def("browser_click", "Click a page element by ref. Real links navigate the tab (reported in the answer). An error names the covering overlay when a dialog hides the element.",
				json!({ "ref": { "type": "string", "description": "A ref from browser_snapshot, e.g. r12" } }), json!(["ref"])),
			def("browser_click_at", "Click at CSS pixel coordinates in the active tab's viewport — for what a snapshot gives no ref, like canvas, map or custom-widget areas. Real links navigate the tab (reported in the answer) and the answer names the element hit.",
				json!({
					"x": { "type": "number", "description": "CSS pixels from the viewport's left edge (a browser_screenshot pixel divided by dpr)" },
					"y": { "type": "number", "description": "CSS pixels from the viewport's top edge" }
				}), json!(["x", "y"])),
			def("browser_move", "Hover the synthesized pointer at CSS pixel coordinates (no press): hover menus and tooltips attached to what is under the point react. The answer names the element it moved onto.",
				json!({
					"x": { "type": "number", "description": "CSS pixels from the viewport's left edge" },
					"y": { "type": "number", "description": "CSS pixels from the viewport's top edge" }
				}), json!(["x", "y"])),
			def("browser_drag", "Press at one point, move in small steps, release at another (CSS pixel coordinates in the viewport). Drags built on mousedown+mousemove work; canvas-style HTML5 drag-and-drop is not synthesized.",
				json!({
					"fromX": { "type": "number", "description": "CSS pixels of the press point, from the viewport's left edge" },
					"fromY": { "type": "number", "description": "CSS pixels of the press point, from the top edge" },
					"toX": { "type": "number", "description": "CSS pixels of the release point, from the left edge" },
					"toY": { "type": "number", "description": "CSS pixels of the release point, from the top edge" },
					"steps": { "type": "integer", "description": "MouseMove hops between the points (default 8, capped)"
					}
				}), json!(["fromX", "fromY", "toX", "toY"])),
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
			def("browser_run_script", "Run a short script inside the active tab's page (a Function body: may 'return' a result; it also receives docToken and document as parameters). The server stamps the CURRENT page's identity token, so a script raced across a navigation refuses to run. The script can reach anything the page can, including secret field values — never send page data anywhere.",
				json!({ "script": { "type": "string", "description": "JavaScript to run; what it returns is stringified in the answer" } }), json!(["script"])),
			def("browser_screenshot", "Capture the active tab as a PNG image. Secret fields are masked by the page first, and frames are hidden.",
				json!({}), json!([])),
		]
	})
}

/// The quiet rule for request-aware settling, kept pure so the loop and the
/// tests cannot drift apart: the main document finished loading, no request
/// is in flight, and the last request change is at least SETTLE_WINDOW_MS
/// old. Without usable watcher data (the page removed or neutered it in its
/// own world) the fall-back signal is DOM-mutation quiet, same window.
fn page_quiet(readiness: &Value) -> bool {
	if readiness.get("readyState").and_then(Value::as_str) != Some("complete") {
		return false;
	}
	match (
		readiness.get("requests").and_then(Value::as_u64),
		readiness.get("requestChangeMs").and_then(Value::as_u64),
	) {
		(Some(0), Some(ms)) => ms >= SETTLE_WINDOW_MS,
		// No usable watcher data (gone or neutered in the page's own world):
		// fall back to DOM-mutation quiet, same window. Watcher data present
		// but busy or unreadable must hold, never fall back.
		(None, None) => readiness
			.get("quietMs")
			.and_then(Value::as_u64)
			.unwrap_or(0)
			>= SETTLE_WINDOW_MS,
		_ => false,
	}
}

/// Waits for the page behind a just-started navigation to go quiet: waits for
/// that navigation's commit (stamped in tabs.rs, so an already-loaded page
/// cannot read as quiet first), then for `page_quiet`, capped at SETTLE_CAP.
/// Polls the runtime's readiness op; answers whether it ever settled.
async fn wait_page_quiet<R: Runtime>(app: &AppHandle<R>, tab_id: &str, after_ms: u64) -> bool {
	let deadline = tokio::time::Instant::now() + SETTLE_CAP;
	loop {
		let committed = super::tabs::last_commit_ms(app, tab_id)
			.map(|at| at >= after_ms)
			.unwrap_or(false);
		if committed {
			let attempt =
				super::agent::run_op(app, tab_id, &json!({ "op": "readiness" }), true).await;
			let result = match attempt {
				Ok(answer) => answer.get("result").cloned().unwrap_or(Value::Null),
				// The tab closed during the wait: nothing to settle.
				Err(message) if message.contains("closed") => return false,
				Err(_) => Value::Null,
			};
			if page_quiet(&result) {
				return true;
			}
		}
		if tokio::time::Instant::now() >= deadline {
			return false;
		}
		tokio::time::sleep(SETTLE_POLL).await;
	}
}

/// The agent op one MCP tool maps to, named tool by tool. Pure so the
/// mapping is testable without the AppHandle call_tool needs; None means the
/// tool has no runtime op (a name that slipped past the match arm).
fn agent_op(name: &str, args: &Value) -> Option<Value> {
	Some(match name {
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
		// Point tools speak CSS viewport pixels straight through: the runtime
		// resolves them with elementFromPoint, so no ref is needed up front.
		// Missing or non-numeric coordinates map to None — a bad argument, not
		// a click at 0,0.
		"browser_click_at" => {
			json!({ "op": "click_at", "x": args.get("x").and_then(Value::as_f64)?,
			"y": args.get("y").and_then(Value::as_f64)?, "navigateLinks": true })
		}
		"browser_move" => {
			json!({ "op": "move", "x": args.get("x").and_then(Value::as_f64)?,
			"y": args.get("y").and_then(Value::as_f64)? })
		}
		"browser_drag" => {
			json!({ "op": "drag",
			"from": { "x": args.get("fromX").and_then(Value::as_f64)?, "y": args.get("fromY").and_then(Value::as_f64)? },
			"to": { "x": args.get("toX").and_then(Value::as_f64)?, "y": args.get("toY").and_then(Value::as_f64)? },
			"steps": args.get("steps").and_then(Value::as_u64).unwrap_or(8) })
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
		"browser_run_script" => {
			// The model supplies only the script text; the doc token is the
			// server's handoff, added at call time (see call_tool). A token
			// argument on the tool would let a raced script name whatever
			// document it was composed against — the gate's point is that
			// only a value sampled from the page right now counts.
			json!({ "op": "run_script", "code": args.get("script").and_then(Value::as_str)? })
		}
		_ => return None,
	})
}

/// Pure: stamps the token the server sampled onto the mapped run_script op.
/// The tool never takes a token from the model; this is the only place one
/// gets in, immediately before dispatch.
fn stamped(op: Value, token: &str) -> Value {
	let mut op = op;
	if let Some(obj) = op.as_object_mut() {
		obj.insert("token".to_string(), json!(token));
	}
	op
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
	// The permission gate runs before anything the tool does: for a
	// sensitive or not-yet-approved host the answer waits for the panel's
	// dialog and only proceeds (or refuses) with its decision.
	if let Some(answer) = permission_gate(app, name, args, tab_id.as_deref()).await? {
		return Ok(answer);
	}
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
			// The settle starts before the navigation could commit: an earlier
			// page left complete and idle must not read as quiet.
			let start_ms = super::tabs::now_ms();
			super::tabs::navigate_tab(app, &tab_id, url, false).await?;
			if wait_page_quiet(app, &tab_id, start_ms).await {
				Ok(text(format!(
					"Navigated the active tab to {url}; the page has settled. Take browser_snapshot now."
				)))
			} else {
				Ok(text(format!(
					"Navigating the active tab to {url}; it has not settled within 10s (still loading, busy, or the navigation did not commit). Snapshot it anyway to see what is showing."
				)))
			}
		}
		"browser_snapshot" | "browser_find" | "browser_click" | "browser_click_at"
		| "browser_move" | "browser_drag" | "browser_type" | "browser_select"
		| "browser_scroll" | "browser_press" => {
			let op = agent_op(name, args).ok_or("unknown op")?;
			let tab_id = tab_id.ok_or_else(no_tab)?;
			let answer = super::agent::run_op(app, &tab_id, &op, true).await?;
			// A navigation handed back from a click must go through the panel,
			// exactly like a user's click: the address stays true. That link's
			// own target runs through the gate before the panel loads it — a
			// click on an approved page is not one to an unapproved site.
			let mut inner = answer.get("result").cloned().unwrap_or(json!({}));
			if let Some(navigate_url) = inner
				.get("navigate")
				.and_then(Value::as_str)
				.map(str::to_string)
			{
				let navigated = navigate_url.len() <= super::security::MAX_REPORTABLE_URL;
				if let Some(obj) = inner.as_object_mut() {
					obj.remove("navigate");
				}
				let mut followable = navigated;
				if let Some(host) = navigated.then(|| host_of(&navigate_url)).flatten() {
					// The gate holds here, before any navigation happens: the
					// ask is about a page the panel has not yet loaded.
					let allowed = match gate_check(&host, &approved_hosts(), gate_mode()) {
						GateCheck::Allowed => true,
						GateCheck::Ask { sensitive } => {
							ask_user(app, &tab_id, &host, &navigate_url, name, sensitive)
								.await
								== Some(true)
						}
					};
					if !allowed {
						followable = false;
					}
				}
				let answer_note = if !followable {
					if navigated {
						format!(
							"The click would have followed a link to {navigate_url}; the user did not allow the agent to open that site. The link stays unclicked; find the address another way or ask them."
						)
					} else {
						"The link's address is too long to follow. Snapshot the page and use its navigation another way."
							.to_string()
						}
				} else {
					// Same settle as browser_navigate, so the next snapshot reads
					// the link's page once it is quiet, not mid-load markup.
					let start_ms = super::tabs::now_ms();
					super::tabs::navigate_tab(app, &tab_id, &navigate_url, false).await?;
					if wait_page_quiet(app, &tab_id, start_ms).await {
						format!(
							"The click followed a link to {navigate_url}; the page has settled. Take a new browser_snapshot."
						)
					} else {
						format!(
							"The click followed a link to {navigate_url}; it has not settled within 10s (still loading, busy, or the navigation did not commit). Take a new browser_snapshot anyway."
						)
					}
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
		"browser_run_script" => {
			let tab_id = tab_id.ok_or_else(no_tab)?;
			let op = agent_op(name, args).ok_or("run_script needs a script")?;
			// Sample THIS document's token, then run the script with it stamped
			// on: two ops, back to back. If the tab navigates in between, the
			// runtime the new document mints cannot match the sampled token and
			// the page itself refuses — a script never fires on a document
			// other than the one the server held when it sampled, right behind
			// the same permission gate every tool ran. The tool call runs the
			// script against the page as it is NOW: composed-earlier scripts
			// re-sample here rather than name their old document.
			let sample = super::agent::run_op(app, &tab_id, &json!({ "op": "doc_token" }), true).await?;
			let token = sample
				.get("result")
				.and_then(|result| result.get("token"))
				.and_then(Value::as_str)
				.ok_or_else(|| "The page did not report its document token; snapshot it instead.".to_string())?;
			let answer = super::agent::run_op(app, &tab_id, &stamped(op, token), true).await?;
			// Same answer convention as the other act arms: the pretty JSON as
			// text, with the page's refusal (stale token) or script error
			// riding inside it as guidance, not a server error.
			Ok(text(format!(
				"{}\n\n(quietMs = how long the page has been idle; re-snapshot after actions.)",
				serde_json::to_string_pretty(&answer).unwrap_or_default()
			)))
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
	client: &mut tokio::net::TcpStream,
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn settings_entry_provision_upserts_and_respects_custom() {
		// Absent entry is added.
		let mut root = json!({ "theme": "dark" });
		assert!(upsert_mcp_servers(&mut root, Some("http://127.0.0.1:47615/mcp")));
		assert_eq!(root["mcpServers"][0]["name"], json!("desktop-browser"));

		// Same URL is a no-op (no disk write churn).
		let mut root = json!({ "mcpServers": [json!({
			"name": "desktop-browser", "transport": "http",
			"commandOrUrl": "http://127.0.0.1:47615/mcp"
		})] });
		assert!(!upsert_mcp_servers(&mut root, Some("http://127.0.0.1:47615/mcp")));

		// An ours-shaped entry mis-pointed (ephemeral-port hop) is re-fixed.
		let mut root = json!({ "mcpServers": [json!({
			"name": "desktop-browser", "transport": "http",
			"commandOrUrl": "http://127.0.0.1:39999/mcp"
		})] });
		assert!(upsert_mcp_servers(&mut root, Some("http://127.0.0.1:47615/mcp")));
		assert_eq!(root["mcpServers"][0]["commandOrUrl"], json!("http://127.0.0.1:47615/mcp"));

		// A hand-customized entry (headers/args) is left alone.
		let mut root = json!({ "mcpServers": [json!({
			"name": "desktop-browser", "transport": "http",
			"commandOrUrl": "http://127.0.0.1:9999/mcp", "headers": { "x": "y" }
		})] });
		assert!(!upsert_mcp_servers(&mut root, Some("http://127.0.0.1:47615/mcp")));

		// Foreign map-shaped mcpServers are left untouched.
		let mut root = json!({ "mcpServers": {} });
		assert!(!upsert_mcp_servers(&mut root, Some("http://127.0.0.1:47615/mcp")));
		assert!(root["mcpServers"].is_object());

		// Provisioned entries are removed when the server is off; custom ones stay.
		let mut root = json!({ "mcpServers": [json!({
			"name": "desktop-browser", "transport": "http",
			"commandOrUrl": "http://127.0.0.1:47615/mcp"
		})] });
		assert!(upsert_mcp_servers(&mut root, None));
		assert_eq!(root["mcpServers"].as_array().map(Vec::len), Some(0));
		let mut root = json!({ "mcpServers": [json!({
			"name": "desktop-browser", "transport": "http",
			"commandOrUrl": "http://192.168.0.5/mcp"
		})] });
		assert!(!upsert_mcp_servers(&mut root, None));
		assert_eq!(root["mcpServers"].as_array().map(Vec::len), Some(1));
	}

	#[test]
	fn pointer_tools_map_to_their_runtime_ops() {
		// Coordinates flow through untouched; non-numeric ones are a bad
		// argument, not a click at the viewport's top-left corner.
		let click = agent_op("browser_click_at", &json!({ "x": 12.5, "y": 34 })).expect("mapped");
		assert_eq!(click.get("op"), Some(&json!("click_at")));
		assert_eq!(click.get("x").and_then(Value::as_f64), Some(12.5));
		assert_eq!(click.get("y").and_then(Value::as_f64), Some(34.0));
		assert_eq!(click.get("navigateLinks"), Some(&json!(true)));

		let move_op = agent_op("browser_move", &json!({ "x": 5, "y": 6 })).expect("mapped");
		assert_eq!(move_op.get("op"), Some(&json!("move")));
		assert_eq!(move_op.get("y").and_then(Value::as_f64), Some(6.0));

		let drag = agent_op(
			"browser_drag",
			&json!({ "fromX": 1, "fromY": 2, "toX": 30, "toY": 40 }),
		)
		.expect("mapped");
		assert_eq!(drag.get("steps").and_then(Value::as_u64), Some(8), "the default step count");
		assert_eq!(drag["from"]["y"].as_f64(), Some(2.0));
		let drag = agent_op(
			"browser_drag",
			&json!({ "fromX": 1, "fromY": 2, "toX": 30, "toY": 40, "steps": 3 }),
		)
		.expect("mapped");
		assert_eq!(drag.get("steps").and_then(Value::as_u64), Some(3));

		assert!(agent_op("browser_click_at", &json!({ "x": 1 })).is_none(), "y is required");
		assert!(agent_op("browser_click_at", &json!({ "x": "12", "y": 1 })).is_none());
		assert!(agent_op("browser_drag", &json!({ "toX": 1, "toY": 2 })).is_none(), "from is required");
		assert!(agent_op("browser_nonsense", &json!({})).is_none());
	}

	#[test]
	fn the_script_tool_maps_but_never_carries_a_model_token() {
		let op = agent_op("browser_run_script", &json!({ "script": "return document.title;" }))
			.expect("mapped");
		assert_eq!(op.get("op"), Some(&json!("run_script")));
		assert_eq!(op.get("code").and_then(Value::as_str), Some("return document.title;"));
		// The token is the server's handoff, not the model's argument.
		assert!(op.get("token").is_none());
		assert_eq!(stamped(op, "tok123").get("token"), Some(&json!("tok123")));
		// A missing or non-string script is a bad argument, not a run.
		assert!(agent_op("browser_run_script", &json!({})).is_none(), "script is required");
		assert!(agent_op("browser_run_script", &json!({ "script": 5 })).is_none());
	}

	fn readiness(requests: Option<u64>, change_ms: Option<u64>, mutation_ms: u64) -> Value {
		json!({
			"readyState": "complete",
			"requests": requests,
			"requestChangeMs": change_ms,
			"quietMs": mutation_ms,
		})
	}

	#[test]
	fn page_settles_once_the_document_drains() {
		assert!(page_quiet(&readiness(Some(0), Some(150), 150)));
		// The window edge itself settles: the last change is not younger than
		// the quiet window.
		assert!(page_quiet(&readiness(Some(0), Some(SETTLE_WINDOW_MS), 0)));
	}

	#[test]
	fn fresh_mutations_or_requests_hold_the_settle() {
		assert!(!page_quiet(&readiness(Some(2), Some(150), 150)));
		assert!(!page_quiet(&readiness(Some(0), Some(SETTLE_WINDOW_MS - 1), 0)));
		// Watcher absent and the DOM still moving: not quiet either way.
		assert!(!page_quiet(&readiness(None, None, SETTLE_WINDOW_MS - 1)));
	}

	#[test]
	fn a_missing_watcher_falls_back_to_mutation_quiet() {
		assert!(page_quiet(&readiness(None, None, 500)));
	}

	#[test]
	fn unready_or_unreadable_answers_never_settle() {
		assert!(!page_quiet(&json!({ "readyState": "interactive" })));
		assert!(!page_quiet(&json!({})));
		assert!(!page_quiet(&Value::Null));
	}

	/// The gate's built-in list is honest by construction: exact domains only
	/// (a scheme, space or wildcard would defeat the suffix check).
	#[test]
	fn the_sensitive_list_holds_only_host_names() {
		for known in SENSITIVE_HOSTS {
			assert!(!known.is_empty(), "an empty list entry matches nothing useful");
			assert_eq!(known, &known.to_lowercase());
			assert!(!known.contains('/'), "{known} is not a bare host");
			assert!(!known.contains('*'), "{known} is not a bare host");
			assert!(known.contains('.'), "{known} is not a bare host");
		}
	}

	#[test]
	fn sensitive_matching_stays_on_the_dot_boundary() {
		assert!(is_sensitive_host("mail.google.com"));
		assert!(is_sensitive_host("inbox.mail.google.com"));
		assert!(is_sensitive_host("accounts.google.com"));
		assert!(is_sensitive_host("paypal.com"));
		// Same look, different site: neither direction can slip through.
		assert!(!is_sensitive_host("evil-mail.google.com"));
		assert!(!is_sensitive_host("mail.google.com.evil.tld"));
		assert!(!is_sensitive_host("mailgoogle.com"));
		assert!(!is_sensitive_host("docs.google.com"));
		assert!(!is_sensitive_host("example.com"));
	}

	#[test]
	fn gate_hosts_come_from_web_pages_only() {
		assert_eq!(
			host_of("https://mail.google.com/mail/u/0"),
			Some("mail.google.com".into())
		);
		assert_eq!(host_of("HTTP://Example.COM./"), Some("example.com".into()));
		assert_eq!(host_of("https://"), None);
	}

	#[test]
	fn the_gate_asks_memory_passes_memory_never_outweighs_sensitive() {
		let approved = vec!["docs.example.dev".to_string()];
		if let GateCheck::Allowed = gate_check("docs.example.dev", &approved, GateMode::Ask) {
			// remembered, ordinary-host op: the gate passes it
		} else {
			panic!("a remembered host must pass");
		}
		if let GateCheck::Ask { sensitive } = gate_check("gmail.com", &approved, GateMode::Ask) {
			assert!(sensitive, "a sensitive host asks even in memory");
		} else {
			panic!("a sensitive host never passes on memory");
		}
		if let GateCheck::Ask { sensitive } = gate_check("other.example.net", &approved, GateMode::Ask) {
			assert!(!sensitive, "an unremembered ordinary host asks softly");
		} else {
			panic!("an unknown host must ask");
		}
	}

	#[test]
	fn auto_mode_passes_ordinary_hosts_but_sensitive_still_asks() {
		let approved: Vec<String> = Vec::new();
		if let GateCheck::Allowed = gate_check("docs.example.dev", &approved, GateMode::Auto) {
			// auto: unremembered ordinary host runs without asking
		} else {
			panic!("auto mode must not ask for ordinary hosts");
		}
		if let GateCheck::Ask { sensitive } = gate_check("mail.google.com", &approved, GateMode::Auto) {
			assert!(sensitive, "auto mode must still ask on sensitive hosts");
		} else {
			panic!("auto mode never passes a sensitive host");
		}
	}
}

/// The panel's read command for the permission mode (the dropdown in the
/// browser chrome reflects whatever the settings file holds).
#[tauri::command]
pub fn browser_get_permission_mode() -> String {
	match gate_mode() {
		GateMode::Auto => "auto".into(),
		GateMode::Ask => "ask".into(),
	}
}

/// The panel's write path for the permission mode. Validated server-side;
/// persisted as the `browser.agentPermissionMode` pref the gate reads per op.
#[tauri::command]
pub fn browser_set_permission_mode(webview: tauri::Webview<tauri::Wry>, mode: String) -> Result<(), String> {
	super::require_main(&webview)?;
	let mode = match mode.as_str() {
		"auto" => "auto",
		"ask" => "ask",
		_ => return Err(format!("unknown permission mode: {mode}")),
	};
	super::write_browser_pref("agentPermissionMode", serde_json::json!(mode))
}

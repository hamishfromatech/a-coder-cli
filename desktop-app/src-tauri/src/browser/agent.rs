//! The page agent: a small runtime injected into a tab's page on first use,
//! then driven one command at a time by the panel (`browser_agent`), with the
//! answer arriving through the eval callback. Ops are capped in size, and the
//! page shares the agent's JS world, so the panel treats results as untrusted
//! (a page can rewrite the runtime or lie about what it did) — snapshots and
//! click targets are cross-checked against captures before anything acts on
//! them.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime};

use super::require_main;
use super::tabs;

const MAX_AGENT_OP: usize = 64 * 1024;
/// The runtime, sent once per page with the first `install` op.
pub(crate) const AGENT_RUNTIME: &str = include_str!("agent-runtime.js");

/// The bridge: installs the runtime under a well-known symbol (so a page
/// reload drops it, and the panel re-sends), runs one op, and answers a JSON
/// string the engine encodes once more for the callback.
const AGENT_BRIDGE: &str = r#"(() => {
  const command = __COMMAND__;
  const key = Symbol.for("a-coder.agent");
  if (!window[key]) {
    if (!command.install) {
      return JSON.stringify({ installed: false, result: null });
    }
    try {
      // The factory expression splices into the value position below and is
      // invoked there; the install arm is skipped, though still parsed, when
      // not installing. Never write the marker text in comments: it splices
      // at the FIRST occurrence.
      Object.defineProperty(window, key, {
        value: __RUNTIME__,
        configurable: true,
      });
    } catch (error) {}
  }
  const agent = window[key];
  if (!agent) return JSON.stringify({ installed: false, result: null });
  return JSON.stringify({ installed: true, result: agent.run(command.op) });
})()"#;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommand {
	/// The op itself; shaped by the panel and capped here.
	pub op: serde_json::Map<String, serde_json::Value>,
	/// The runtime source, when the panel has never installed it here.
	#[serde(default)]
	pub install: bool,
}

/// Runs one agent command in a tab's page and returns `{ installed, result }`.
#[tauri::command]
pub async fn browser_agent<R: Runtime>(
	webview: tauri::Webview<R>,
	tab_id: String,
	command: AgentCommand,
) -> Result<serde_json::Value, String> {
	require_main(&webview)?;
	let AgentCommand { op, install } = command;
	run_op(
		webview.app_handle(),
		&tab_id,
		&serde_json::Value::Object(op),
		install,
	)
	.await
}

/// The op runner, shared with the agent's MCP server (which has no panel
/// caller to check). One retry with the runtime when the first answer says it
/// was never installed (a navigation dropped it).
pub(crate) async fn run_op<R: Runtime>(
	app: &tauri::AppHandle<R>,
	tab_id: &str,
	op: &serde_json::Value,
	install: bool,
) -> Result<serde_json::Value, String> {
	let command = AgentCommand {
		op: op.as_object().cloned().unwrap_or_default(),
		install,
	};
	let script = agent_script(&command)?;
	let page = app
		.get_webview(&format!("{}{tab_id}", tabs::LABEL_PREFIX))
		.ok_or_else(|| "That tab is closed".to_string())?;
	for _ in 0..2 {
		let (sender, receiver) = tokio::sync::oneshot::channel();
		let sender = Mutex::new(Some(sender));
		let script = script.clone();
		page.eval_with_callback(script, move |raw| {
			if let Some(sender) = sender.lock().unwrap().take() {
				let _ = sender.send(raw);
			}
		})
		.map_err(|error| error.to_string())?;
		let raw = tokio::time::timeout(Duration::from_secs(5), receiver)
			.await
			.map_err(|_| "the page did not answer")?
			.map_err(|error| error.to_string())?;
		// The runtime returns a JSON string, which the engine JSON-encodes again.
		let inner = serde_json::from_str::<String>(raw.trim()).unwrap_or(raw.clone());
		log::info!(
			"agent eval answered install={install}: {}",
			&inner[..inner.len().min(160)]
		);
		let answer: serde_json::Value =
			serde_json::from_str(&inner).unwrap_or(serde_json::Value::Null);
		let installed = answer
			.get("installed")
			.and_then(serde_json::Value::as_bool)
			.unwrap_or(false);
		if installed || !install {
			return Ok(answer);
		}
	}
	Err("the page could not take the agent runtime".into())
}

fn agent_script(command: &AgentCommand) -> Result<String, String> {
	let code = if command.install { AGENT_RUNTIME } else { "" };
	if code.len() > MAX_AGENT_OP {
		return Err("agent runtime too large".into());
	}
	let args = serde_json::json!({
		"install": command.install,
		"runtime": code,
		"op": serde_json::Value::Object(command.op.clone()),
	});
	if args.to_string().len() > MAX_AGENT_OP {
		return Err("agent command too large".into());
	}
	// Spliced in, not compiled in the page, so a CSP without 'unsafe-eval'
	// cannot block it. Single pass, so neither part can forge the other's
	// placeholder. The runtime is a factory expression; the call installs its
	// result. An empty splice (dispatch only) still has to parse inside the
	// install arm, so an inert factory takes the value position there.
	let runtime = if code.is_empty() {
		"function () { return null; }()".to_string()
	} else {
		format!("({code})()")
	};
	let (head, rest) = AGENT_BRIDGE
		.split_once("__COMMAND__")
		.ok_or("bad agent bridge")?;
	let (middle, tail) = rest.split_once("__RUNTIME__").ok_or("bad agent bridge")?;
	Ok(format!("{head}{args}{middle}{runtime}{tail}"))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn command(op: serde_json::Value, install: bool) -> AgentCommand {
		AgentCommand {
			op: op.as_object().cloned().unwrap_or_default(),
			install,
		}
	}

	#[test]
	fn oversized_ops_are_refused_before_the_page() {
		let big = "x".repeat(MAX_AGENT_OP + 1);
		assert!(agent_script(&command(serde_json::json!({ "a": big }), false)).is_err());
	}

	#[test]
	fn the_runtime_splices_cleanly_into_the_bridge() {
		let script = agent_script(&command(serde_json::json!({ "op": "snapshot" }), true)).unwrap();
		assert!(!script.contains("__COMMAND__"), "the op must be spliced in");
		assert!(
			!script.contains("__RUNTIME__"),
			"the runtime body must be spliced, not left"
		);
		// Splicing must not cross-contaminate: the runtime's own placeholders
		// (there are none) could forge the command's position.
		assert!(script.contains("a-coder.agent"), "{script}");
		assert!(script.contains("snapshot"), "{script}");
	}

	#[test]
	fn without_install_the_install_arm_is_unreachable_but_the_text_parses() {
		let script =
			agent_script(&command(serde_json::json!({ "op": "snapshot" }), false)).unwrap();
		// The factory is spliced for parsing only; the no-install arm returns
		// before it can run, so the page's dispatch cannot execute new code.
		assert!(
			script.contains("if (!command.install) {"),
			"{script}"
		);
		assert!(
			script.find("if (!command.install)").unwrap()
				< script.find("defineProperty").unwrap(),
			"the install arm must follow the no-install return"
		);
		assert!(
			!script.contains("agent.run") || script.contains("command.install"),
			"{script}"
		);
	}

	#[test]
	fn the_readiness_op_ships_inside_the_installed_runtime() {
		let script = agent_script(&command(serde_json::json!({ "op": "readiness" }), true)).unwrap();
		assert!(script.contains("case \"readiness\""), "{script}");
		assert!(script.contains("window.__ACODER_READY"), "{script}");
	}

	#[test]
	fn the_pointer_ops_ship_inside_the_installed_runtime() {
		// The point ops resolve coordinates in the page itself, so their
		// dispatch arms and the elementFromPoint hit test must be part of
		// what gets installed, and their arguments must splice like any op.
		for (op, marker) in [
			(serde_json::json!({ "op": "click_at", "x": 10, "y": 20 }), "elementFromPoint"),
			(serde_json::json!({ "op": "move", "x": 1.5, "y": 2.5 }), "mousemove"),
			(
				serde_json::json!({ "op": "drag", "from": { "x": 1, "y": 2 }, "to": { "x": 3, "y": 4 } }),
				"mousedown",
			),
		] {
			let script = agent_script(&command(op, true)).unwrap();
			assert!(script.contains(marker), "{script}");
		}
		let script = agent_script(&command(
			serde_json::json!({ "op": "drag", "from": { "x": 0, "y": 0 }, "to": { "x": 5, "y": 5 }, "steps": 3 }),
			true,
		))
		.unwrap();
		assert!(script.contains("case \"drag\""), "{script}");
		assert!(script.contains("case \"move\""), "{script}");
		assert!(script.contains("case \"click_at\""), "{script}");
		assert!(!script.contains("__COMMAND__"), "the point op must be spliced in");
	}
}

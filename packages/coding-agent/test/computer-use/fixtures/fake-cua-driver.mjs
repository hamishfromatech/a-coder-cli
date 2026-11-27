/**
 * Fake cua-driver: an MCP server built on the same SDK the client uses, so the
 * fixture exercises the real wire protocol end to end. Serves the tool surface
 * the `computer` tool consumes; every tools/call is recorded to a sidecar file
 * for assertions.
 *
 * argv[2] = path of the call log (JSON lines).
 */

import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const LOG = process.argv[2] ?? "";

// Test knobs: FAKE_HIDE_TOOLS filters the advertised list (exercises the
// client's stale-mapping guard); FAKE_REFUSE_TOOLS answers calls with the
// driver's standard-mode permission refusal (exercises verdict translation).
// FAKE_BACKGROUND_UNAVAILABLE / FAKE_STALE_TOKEN answer with those structured
// refusals; FAKE_DEGRADED adds a degraded_reason; FAKE_EXIT_ONCE makes the
// driver die on the first call of a tool (sentinel file guards the restart);
// FAKE_SESSION_ENDED_ONCE rejects the first call of a tool with the driver's
// idle-TTL `session has ended` payload, then accepts it after start_session.
const HIDE = new Set((process.env.FAKE_HIDE_TOOLS ?? "").split(",").filter(Boolean));
const REFUSE = new Set((process.env.FAKE_REFUSE_TOOLS ?? "").split(",").filter(Boolean));
const BACKGROUND_UNAVAILABLE = new Set(
	(process.env.FAKE_BACKGROUND_UNAVAILABLE ?? "").split(",").filter(Boolean),
);
const STALE_TOKEN = new Set((process.env.FAKE_STALE_TOKEN ?? "").split(",").filter(Boolean));
const DEGRADED = process.env.FAKE_DEGRADED ?? "";
// FAKE_PARTIAL claims a truncated walk; FAKE_NO_TOKEN drops element_token from
// the structured rows; FAKE_OWNED rejects calls as held by another transport.
const PARTIAL = process.env.FAKE_PARTIAL === "1";
const NO_TOKEN = process.env.FAKE_NO_TOKEN === "1";
const OWNED = process.env.FAKE_OWNED === "1";
const EXIT_ONCE = new Set((process.env.FAKE_EXIT_ONCE ?? "").split(",").filter(Boolean));
const EXIT_SENTINEL = process.env.FAKE_EXIT_SENTINEL ?? "";
const SESSION_ENDED_ONCE = new Set(
	(process.env.FAKE_SESSION_ENDED_ONCE ?? "").split(",").filter(Boolean),
);
let sessionEnded = false;
let sessionRevivals = 0;

const tools = [
	{ name: "start_session", inputSchema: { type: "object", properties: { session: { type: "string" } } } },
	{ name: "end_session", inputSchema: { type: "object", properties: { session: { type: "string" } } } },
	{ name: "list_windows", inputSchema: { type: "object", properties: { session: { type: "string" } } } },
	{
		name: "get_window_state",
		inputSchema: {
			type: "object",
			properties: {
				pid: {},
				window_id: {},
				max_elements: {},
				tree_format: {},
				include_screenshot: {},
				include_accessibility_tree: {},
				since: {},
				timeout_ms: {},
				session: {},
			},
		},
	},
	{
		// Live schema advertises element_token + delivery_mode (driver 0.21+ contract).
		name: "click",
		inputSchema: { type: "object", properties: { target: {}, pid: {}, window_id: {}, button: {}, count: {}, element_index: {}, element_token: {}, snapshot_id: {}, capture_id: {}, x: {}, y: {}, modifier: {}, delivery_mode: {}, from_zoom: {}, ui_tree_revision: {}, session: {} } },
	},
	{
		// press_key deliberately omits delivery_mode: the tool must refuse
		// foreground delivery instead of silently downgrading to background.
		name: "press_key",
		inputSchema: { type: "object", properties: { target: {}, pid: {}, window_id: {}, key: {}, session: {} } },
	},
	{
		name: "hotkey",
		inputSchema: { type: "object", properties: { target: {}, pid: {}, window_id: {}, keys: {}, delivery_mode: {}, session: {} } },
	},
	{
		name: "type_text",
		inputSchema: { type: "object", properties: { target: {}, pid: {}, window_id: {}, text: {}, x: {}, y: {}, delay_ms: {}, element_index: {}, element_token: {}, snapshot_id: {}, delivery_mode: {}, from_zoom: {}, ui_tree_revision: {}, session: {} } },
	},
	{
		name: "check_permissions",
		inputSchema: { type: "object", properties: { prompt: {} } },
	},
	{
		name: "health_report",
		inputSchema: { type: "object", properties: { include: {}, skip: {} } },
	},
	{ name: "screenshot", inputSchema: { type: "object", properties: { window_id: {}, format: {}, quality: {} } } },
	{ name: "zoom", inputSchema: { type: "object", properties: { window_id: {}, pid: {}, x1: {}, y1: {}, x2: {}, y2: {} } } },
];

const WINDOWS = [
	{ app_name: "Safari", pid: 101, window_id: 11, title: "Front", z_index: 100, is_on_screen: true },
	{ app_name: "Notes", pid: 202, window_id: 22, title: "Back", z_index: 50, is_on_screen: true },
];

const ELEMENTS = [
	{
		element_index: 1,
		role: "button",
		label: "Submit",
		frame: { x: 410, y: 320, w: 80, h: 24 },
		screenshot_frame: { x: 10, y: 20, w: 40, h: 12 },
		element_token: "sabc:1",
	},
	{ element_index: 2, role: "textfield", label: "Search", frame: { x: 410, y: 360, w: 200, h: 24 }, element_token: "sabc:2" },
];

// A real 1x1 PNG, so the desktop preview and provider image validation see
// a decodable image instead of a stub string.
const IMAGE = {
	type: "image",
	data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	mimeType: "image/png",
};

function handleCall(name, args) {
	appendFileSync(LOG, `${JSON.stringify({ name, args })}\n`);
	if (OWNED) {
		return {
			content: [{ type: "text", text: `session '${args.session}' is owned by another transport` }],
			structuredContent: {
				ok: false,
				code: "session_owned_by_other_transport",
				owner_transport: "pid-4242",
			},
			isError: true,
		};
	}
	if (SESSION_ENDED_ONCE.has(name) && !sessionEnded) {
		sessionEnded = true;
		return {
			content: [],
			structuredContent: {
				ok: false,
				action: name,
				message: `session '${args.session}' has ended; tool call '${name}' was rejected. Call start_session with this id to revive it before issuing further actions, or use a new session id.`,
				code: "tool_invocation_failed",
				exit_code: 1,
			},
		};
	}
	if (EXIT_ONCE.has(name) && EXIT_SENTINEL) {
		let crashed = false;
		try {
			appendFileSync(EXIT_SENTINEL, "x", { flag: "wx" });
			crashed = true;
		} catch {
			// already crashed once: serve normally on the restarted child
		}
		if (crashed) process.exit(1);
	}
	if (REFUSE.has(name)) {
		return {
			content: [{ type: "text", text: `Permission denied: tool '${name}' has no reviewed risk classification` }],
			isError: true,
		};
	}
	if (BACKGROUND_UNAVAILABLE.has(name)) {
		return {
			content: [{ type: "text", text: `background_unavailable: ${name} could not land without fronting` }],
			structuredContent: { ok: false, code: "background_unavailable", effect: "refused" },
			isError: true,
		};
	}
	if (STALE_TOKEN.has(name)) {
		return {
			content: [{ type: "text", text: "element_token is stale; call get_window_state again to refresh" }],
			structuredContent: { ok: false, code: "stale_element_token", effect: "refused" },
			isError: true,
		};
	}
	switch (name) {
		case "start_session": {
			sessionRevivals++;
			sessionEnded = false;
			return {
				content: [],
				structuredContent: { ok: true, session: args.session, revived: sessionRevivals > 1 },
			};
		}
		case "end_session":
			sessionEnded = true;
			return { content: [], structuredContent: { ok: true, session: args.session } };
		case "list_apps":
			return {
				content: [],
				structuredContent: { apps: [{ name: "Safari", pid: 101 }, { name: "Notes", pid: 202 }] },
			};
		case "list_windows":
			return { content: [], structuredContent: { windows: WINDOWS } };
		case "get_window_state": {
			// Current driver contract: the structured element list exists only when
			// tree_format is "elements" or "both"; the default is markdown-only.
			const wantsElements = args.tree_format === "elements" || args.tree_format === "both";
			const diff = typeof args.since === "string";
			const structuredContent = {
				snapshot_id: diff ? "s0000002b" : "s0000002a",
				capture_id: "cap-0001",
				ui_tree_revision: diff ? 8 : 7,
				truncated: false,
				elements_complete: PARTIAL ? false : true,
				...(PARTIAL ? { truncation_reason: "walk_timeout" } : {}),
				...(diff ? { since_status: "ok" } : {}),
				...(DEGRADED ? { degraded_reason: DEGRADED } : {}),
				...(wantsElements
					? {
							elements: NO_TOKEN
								? ELEMENTS.map((element) => {
										const copy = { ...element };
										delete copy.element_token;
										return copy;
									})
								: diff
									? [ELEMENTS[0]]
									: ELEMENTS,
						}
					: { tree_markdown: "tree", window_title: "Front" }),
			};
			const content = args.include_screenshot === false ? [] : [IMAGE];
			return { content, structuredContent };
		}
		case "zoom":
			return { content: [IMAGE], structuredContent: { ok: true, width: 400, height: 200 } };
		case "screenshot":
			return { content: [IMAGE], structuredContent: { ok: true } };
		case "click":
		case "press_key":
		case "hotkey":
		case "type_text":
			return { content: [], structuredContent: { ok: true, effect: "confirmed" } };
		case "check_permissions":
			return { content: [], structuredContent: { accessibility: true, screen_recording: true, source: "CuaDriver daemon" } };
		case "health_report":
			return {
				content: [],
				structuredContent: {
					schema_version: "1",
					platform: "darwin",
					driver_version: "0.0.0",
					overall: "ok",
					checks: [
						{ name: "binary_version", status: "pass", message: "0.0.0" },
						{ name: "tcc_accessibility", status: "pass", message: "granted" },
						{ name: "tcc_screen_recording", status: "pass", message: "granted" },
					],
				},
			};
		default:
			return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
	}
}

const server = new Server({ name: "fake-cua-driver", version: "0.0.0" }, { capabilities: { tools: {} } });
const PAGE_SIZE = Number(process.env.FAKE_TOOL_PAGE_SIZE ?? "0");
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
	const visible = tools.filter((t) => !HIDE.has(t.name));
	if (!PAGE_SIZE) return { tools: visible };
	// Cursor pagination, as the real driver can page a long tool list.
	const start = Number(request.params?.cursor ?? "0");
	const page = visible.slice(start, start + PAGE_SIZE);
	const next = start + PAGE_SIZE < visible.length ? String(start + PAGE_SIZE) : undefined;
	return { tools: page, ...(next ? { nextCursor: next } : {}) };
});
server.setRequestHandler(CallToolRequestSchema, async (request) =>
	handleCall(request.params.name, request.params.arguments ?? {}));
await server.connect(new StdioServerTransport());
setInterval(() => {}, 1000);
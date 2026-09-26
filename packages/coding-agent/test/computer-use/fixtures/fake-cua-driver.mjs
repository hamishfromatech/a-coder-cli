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

const tools = [
	{ name: "start_session", inputSchema: { type: "object", properties: { session: { type: "string" } } } },
	{ name: "end_session", inputSchema: { type: "object", properties: { session: { type: "string" } } } },
	{ name: "list_windows", inputSchema: { type: "object", properties: { session: { type: "string" } } } },
	{
		name: "get_window_state",
		inputSchema: { type: "object", properties: { pid: {}, window_id: {}, max_elements: {}, session: {} } },
	},
	{
		// Live schema advertises element_token + delivery_mode (driver 0.21+ contract).
		name: "click",
		inputSchema: { type: "object", properties: { pid: {}, window_id: {}, button: {}, element_index: {}, element_token: {}, x: {}, y: {}, modifier: {}, delivery_mode: {}, session: {} } },
	},
	{
		// press_key deliberately omits delivery_mode: the tool must refuse
		// foreground delivery instead of silently downgrading to background.
		name: "press_key",
		inputSchema: { type: "object", properties: { pid: {}, window_id: {}, key: {}, session: {} } },
	},
	{
		name: "hotkey",
		inputSchema: { type: "object", properties: { pid: {}, window_id: {}, keys: {}, delivery_mode: {}, session: {} } },
	},
	{
		name: "type_text",
		inputSchema: { type: "object", properties: { pid: {}, window_id: {}, text: {}, delivery_mode: {}, session: {} } },
	},
];

const WINDOWS = [
	{ app_name: "Safari", pid: 101, window_id: 11, title: "Front", z_index: 100, is_on_screen: true },
	{ app_name: "Notes", pid: 202, window_id: 22, title: "Back", z_index: 50, is_on_screen: true },
];

const ELEMENTS = [
	{ element_index: 1, role: "button", label: "Submit", frame: { x: 10, y: 20, w: 80, h: 24 }, element_token: "sabc:1" },
	{ element_index: 2, role: "textfield", label: "Search", frame: { x: 10, y: 60, w: 200, h: 24 }, element_token: "sabc:2" },
];

const IMAGE = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };

function handleCall(name, args) {
	appendFileSync(LOG, `${JSON.stringify({ name, args })}\n`);
	switch (name) {
		case "list_windows":
			return { content: [], structuredContent: { windows: WINDOWS } };
		case "get_window_state":
			return { content: [IMAGE], structuredContent: { elements: ELEMENTS, tree_markdown: "tree", window_title: "Front" } };
		case "click":
		case "press_key":
		case "hotkey":
		case "type_text":
			return { content: [], structuredContent: { ok: true, effect: "confirmed" } };
		default:
			return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
	}
}

const server = new Server({ name: "fake-cua-driver", version: "0.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) =>
	handleCall(request.params.name, request.params.arguments ?? {}));
await server.connect(new StdioServerTransport());
setInterval(() => {}, 1000);
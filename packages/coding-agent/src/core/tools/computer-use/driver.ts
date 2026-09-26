/**
 * cua-driver MCP client — the desktop-control backend for the `computer` tool.
 *
 * cua-driver (from the cua repo, e.g. github.com/trycua/cua or a fork) is an
 * external Rust binary that owns all platform input/capture plumbing
 * (background-first event posting, window discovery, accessibility trees,
 * macOS TCC). We drive it as an MCP server over stdio, mirroring the
 * transport contract Hermes uses against the same binary:
 *
 * - Spawn `cua-driver mcp` (older builds: the only invocation there is).
 * - `tools/list` populates a per-tool capability + input-schema map; input
 *   actions must never send a property the live schema does not accept
 *   (e.g. `delivery_mode`, `element_token`).
 * - `start_session {session}` declares a run identity (cursor color, config
 *   owner); `end_session` on teardown. Every call carries `session`.
 * - `get_window_state` captures pixels + AX elements; element actions take
 *   `element_index` (+ the snapshot's `element_token` so the driver reports
 *   "stale" instead of silently re-resolving to a different element).
 *
 * Recovery is fail-closed: a timed-out call's effect on the screen is
 * unknown, so it is never replayed — the result carries an explicit
 * "outcome unknown" verdict and the transport is rebuilt before the next
 * call. Read-only calls may replay after a transport drop; mutations may
 * not.
 */

import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Env override for the driver binary (mirrors Hermes' HERMES_CUA_DRIVER_CMD). */
const DRIVER_CMD_ENV = "A_CODER_CUA_DRIVER_CMD";
const TELEMETRY_ENV = "CUA_DRIVER_RS_TELEMETRY_ENABLED";

/** Provider secrets must never reach a third-party binary via inherited env. */
const STRIPPED_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"OPENROUTER_API_KEY",
	"GEMINI_API_KEY",
	"GOOGLE_API_KEY",
	"XAI_API_KEY",
	"MISTRAL_API_KEY",
	"DEEPSEEK_API_KEY",
	"GROQ_API_KEY",
	"CEREBRAS_API_KEY",
	"FIREWORKS_API_KEY",
	"TOGETHER_API_KEY",
	"INCEPTION_API_KEY",
	"AZURE_OPENAI_API_KEY",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
];

export interface DriverAvailability {
	installed: boolean;
	/** Resolved binary path, when found. */
	command?: string;
}

/** Locate the cua-driver binary: explicit env override, then PATH. */
export function resolveDriverCommand(): DriverAvailability {
	const override = process.env[DRIVER_CMD_ENV]?.trim();
	if (override) {
		return { installed: true, command: override };
	}
	try {
		const probe = spawnSync("which", ["cua-driver"], { encoding: "utf8", timeout: 5_000 });
		const path = probe.status === 0 ? String(probe.stdout).trim() : "";
		if (path) {
			return { installed: true, command: path };
		}
	} catch {
		// fall through
	}
	return { installed: false };
}

/** Env for the driver child: telemetry off by default, secrets stripped. */
export function driverChildEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !STRIPPED_ENV_KEYS.includes(key)) {
			env[key] = value;
		}
	}
	env[TELEMETRY_ENV] ??= "0";
	return env;
}

/** One driver tool as advertised by tools/list. */
export interface DriverTool {
	name: string;
	capabilities: Set<string>;
	/** Live input-schema property names (source of truth for optional args). */
	inputProperties: Set<string>;
}

/** Normalized driver tool result. */
export interface DriverToolResult {
	isError: boolean;
	/** Canonical structured payload (cua-driver verdict fields live here). */
	structured: Record<string, unknown> | null;
	/** Free-text message from data/structuredContent. */
	message: string;
	/** Inline base64 PNG/JPEG screenshots, in content order. */
	images: Array<{ data: string; mimeType: string }>;
}

function normalizeResult(result: CallToolResult): DriverToolResult {
	const structured = (result.structuredContent ?? null) as Record<string, unknown> | null;
	let message = "";
	if (typeof result.content !== "undefined") {
		for (const block of result.content) {
			if (block.type === "text" && !message) {
				message = block.text;
			}
		}
	}
	const images: Array<{ data: string; mimeType: string }> = [];
	for (const block of result.content ?? []) {
		if (block.type === "image") {
			images.push({ data: block.data, mimeType: block.mimeType });
		}
	}
	return { isError: result.isError === true, structured, message, images };
}

const READ_SAFE_TOOLS = new Set([
	"get_window_state",
	"list_apps",
	"list_windows",
	"get_displays",
	"get_screen_size",
	"get_cursor_position",
]);
const LIFECYCLE_TOOLS = new Set(["start_session", "end_session"]);
const CALL_TIMEOUT_MS = 30_000;

export class CuaDriverClient {
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;
	private readonly tools = new Map<string, DriverTool>();
	private starting: Promise<void> | null = null;
	private transportSuspect = false;
	private disposed = false;

	/** True once tools/list has populated the tool map. */
	get discovered(): boolean {
		return this.tools.size > 0;
	}

	hasTool(name: string): boolean {
		return this.tools.has(name);
	}

	/** Live schema accepts this property for this tool (fails closed). */
	supportsInputProperty(tool: string, property: string): boolean {
		return this.tools.get(tool)?.inputProperties.has(property) ?? false;
	}

	/**
	 * Connect (or reconnect after a drop): spawn, initialize, discover tools.
	 * Safe to call repeatedly — concurrent and repeat calls share one start.
	 */
	start(): Promise<void> {
		if (this.disposed) {
			throw new Error("cua-driver client has been disposed");
		}
		this.starting ??= this.startInternal();
		return this.starting;
	}

	private async startInternal(): Promise<void> {
		const availability = resolveDriverCommand();
		if (!availability.installed || !availability.command) {
			throw new Error(
				"cua-driver is not installed. Install it from the cua repository releases (cua-driver-rs tag) for your platform, or point A_CODER_CUA_DRIVER_CMD at the binary.",
			);
		}
		const transport = new StdioClientTransport({
			command: availability.command,
			args: ["mcp"],
			env: driverChildEnv(),
			stderr: "pipe",
		});
		this.transport = transport;
		const client = new Client({ name: "a-coder-cli", version: "1.0" });
		this.client = client;
		try {
			await client.connect(transport);
			await this.discoverTools(client);
			await this.declareSession(client);
		} catch (error) {
			this.teardownTransport();
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	private async discoverTools(client: Client): Promise<void> {
		this.tools.clear();
		const listing = await client.listTools();
		for (const tool of listing.tools) {
			const schema = tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
			const capabilities = (tool as { capabilities?: unknown }).capabilities;
			this.tools.set(tool.name, {
				name: tool.name,
				capabilities: new Set(
					Array.isArray(capabilities) ? capabilities.filter((c): c is string => typeof c === "string") : [],
				),
				inputProperties: new Set(schema?.properties ? Object.keys(schema.properties) : []),
			});
		}
	}

	private async declareSession(client: Client): Promise<void> {
		// Anonymous calls are accepted by the driver (cursor just won't render);
		// a failed declaration degrades instead of failing the session.
		try {
			await client.callTool({ name: "start_session", arguments: { session: this.sessionId } });
		} catch {
			// non-fatal
		}
	}

	/** Stable per-process run label sent as `session` on every call. */
	readonly sessionId = `acoder-${Math.random().toString(36).slice(2, 14)}`;

	async callTool(name: string, args: Record<string, unknown>): Promise<DriverToolResult> {
		if (this.disposed) {
			throw new Error("cua-driver client has been disposed");
		}
		const payload = { session: this.sessionId, ...args };
		if (!LIFECYCLE_TOOLS.has(name) && (this.transportSuspect || !this.client)) {
			// A prior timeout left the transport suspect (the call may have
			// landed): rebuild before sending anything else.
			this.teardownTransport();
		}
		await this.start();
		const client = this.client;
		if (!client) {
			throw new Error("cua-driver client is not connected");
		}
		try {
			const result = await client.callTool({ name, arguments: payload }, undefined, { timeout: CALL_TIMEOUT_MS });
			this.transportSuspect = false;
			return normalizeResult(result as CallToolResult);
		} catch (error) {
			if (isTimeout(error)) {
				// Fail closed: the action may have taken effect. Never replay it.
				this.transportSuspect = true;
				return {
					isError: true,
					structured: { ok: false, code: "timeout_outcome_unknown", operation: name, next_step: "fresh_state" },
					message:
						`cua-driver call "${name}" timed out; the action outcome is unknown and may still have taken effect. ` +
						"Take fresh state (capture) before deciding whether to act again.",
					images: [],
				};
			}
			if (isTransportClosed(error)) {
				this.teardownTransport();
				if (READ_SAFE_TOOLS.has(name)) {
					// Idempotent reads may replay once after a reconnect.
					await this.start();
					const result = await client.callTool({ name, arguments: payload }, undefined, {
						timeout: CALL_TIMEOUT_MS,
					});
					return normalizeResult(result as CallToolResult);
				}
				return {
					isError: true,
					structured: { ok: false, code: "transport_outcome_unknown", operation: name, next_step: "fresh_state" },
					message:
						`cua-driver transport failed during "${name}"; the action outcome is unknown, so it was not replayed. ` +
						"Take fresh state before deciding whether to act again.",
					images: [],
				};
			}
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	stop(): void {
		if (this.client && !this.disposed) {
			// Best-effort end_session BEFORE disposing: callTool refuses when
			// disposed, so this must run while the client is still usable.
			this.callTool("end_session", {}).catch(() => {});
		}
		this.disposed = true;
		this.teardownTransport();
		this.tools.clear();
	}

	private teardownTransport(): void {
		this.transportSuspect = false;
		this.client = null;
		if (this.transport) {
			try {
				this.transport.close();
			} catch {
				// teardown is best-effort
			}
			this.transport = null;
		}
	}
}

function isTimeout(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return /timed?\s?out|timeout|deadline/i.test(`${error.name}: ${error.message}`);
}

function isTransportClosed(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return (
		/Close(d)?ResourceError|BrokenResourceError|EndOfStream|BrokenPipeError|EPIPE|stream ended|not connected/i.test(
			`${error.name}: ${error.message}`,
		) || /Connection closed/i.test(error.message)
	);
}

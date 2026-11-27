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
 * - Sessions expire after five minutes idle. The next session-requiring call
 *   restarts the session automatically (`start_session` is optional); only an
 *   explicit `end_session` makes the label refuse, and that refusal is revived
 *   with `start_session` and retried once. The rejected call never executed, so
 *   the replay is safe. Snapshots and element tokens from before the end stay
 *   retired.
 * - Another live connection holding the label is refused with
 *   `session_owned_by_other_transport` (+ `owner_transport`): that is not an
 *   ended session, so it is reported instead of revived.
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
import { existsSync } from "node:fs";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getAgentDir } from "../../../config.ts";

/** Env override for the driver binary (mirrors Hermes' HERMES_CUA_DRIVER_CMD). */
const DRIVER_CMD_ENV = "A_CODER_CUA_DRIVER_CMD";
const TELEMETRY_ENV = "CUA_DRIVER_RS_TELEMETRY_ENABLED";

/**
 * cua-driver release artifacts: tags of the form `cua-driver-rs-v<semver>` on
 * github.com/trycua/cua carry per-platform tarballs. Pin the latest known tag
 * so install commands are stable; bump this when re-verifying releases.
 */
export const DRIVER_RELEASE_TAG = "cua-driver-rs-v0.33.3";
export const DRIVER_RELEASES_PAGE = "https://github.com/trycua/cua/releases?q=cua-driver-rs";

/** Well-known install dir for the driver binary: <agent-dir>/bin. */
export function getCuaBinDir(): string {
	return path.join(getAgentDir(), "bin");
}

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

/** Locate the cua-driver binary: env override, PATH, then <agent-dir>/bin. */
export function resolveDriverCommand(): DriverAvailability {
	const override = process.env[DRIVER_CMD_ENV]?.trim();
	if (override) {
		return { installed: true, command: override };
	}
	try {
		const finder = process.platform === "win32" ? "where" : "which";
		const probe = spawnSync(finder, ["cua-driver"], { encoding: "utf8", timeout: 5_000 });
		const found = (probe.status === 0 ? String(probe.stdout) : "").split(/\r?\n/)[0]?.trim() ?? "";
		if (found) {
			return { installed: true, command: found };
		}
	} catch {
		// fall through
	}
	const binDirCandidate = path.join(getCuaBinDir(), process.platform === "win32" ? "cua-driver.exe" : "cua-driver");
	if (existsSync(binDirCandidate)) {
		return { installed: true, command: binDirCandidate };
	}
	return { installed: false };
}

/**
 * Platform-matched install guidance for a machine where the driver is not
 * installed. Asset naming follows the live `cua-driver-rs-v*` release layout.
 */
export interface DriverInstallGuidance {
	platform: string;
	arch: string;
	/** Release tag carrying the asset. */
	tag: string;
	/** Release asset file that matches this platform/arch. */
	asset: string;
	/** Direct download URL for the asset. */
	url: string;
	/** Where the auto-resolution looks first; also the recommended install dir. */
	binDir: string;
	/** Executable name expected in binDir. */
	binaryName: string;
	/** Copy-paste install commands for the detected platform. */
	commands: string[];
	/** Always-live listing page (in case the pinned tag has moved). */
	page: string;
}

const DRIVER_RELEASE_VERSION = DRIVER_RELEASE_TAG.replace(/^cua-driver-rs-v/, "");
const DRIVER_BASE_URL = "https://github.com/trycua/cua/releases/download";

function platformAssetTag(platform: NodeJS.Platform, arch: string): string | null {
	if (platform === "darwin") {
		return arch === "arm64" ? "darwin-arm64" : arch === "x64" ? "darwin-x86_64" : null;
	}
	if (platform === "linux") {
		return arch === "arm64" ? "linux-arm64" : arch === "x64" ? "linux-x86_64" : null;
	}
	if (platform === "win32") {
		return arch === "arm64" ? "windows-arm64" : arch === "x64" ? "windows-x86_64" : null;
	}
	return null;
}

/** Build install guidance when the driver is missing; null when installed. */
export function getDriverInstallGuidance(): DriverInstallGuidance | null {
	if (resolveDriverCommand().installed) {
		return null;
	}
	const platform = process.platform;
	const arch = process.arch;
	const assetTag = platformAssetTag(platform, arch);
	if (!assetTag) {
		return null;
	}
	const suffix = platform === "win32" ? "zip" : "tar.gz";
	const asset = `cua-driver-rs-${DRIVER_RELEASE_VERSION}-${assetTag}.${suffix}`;
	const url = `${DRIVER_BASE_URL}/${DRIVER_RELEASE_TAG}/${asset}`;
	const binDir = getCuaBinDir();
	const binaryName = platform === "win32" ? "cua-driver.exe" : "cua-driver";
	const commands =
		platform === "win32"
			? [
					`New-Item -ItemType Directory -Force "${binDir}" | Out-Null`,
					`curl.exe -fsSL "${url}" -o "$env:TEMP\\cua-driver.zip"`,
					`Expand-Archive -Path "$env:TEMP\\cua-driver.zip" -DestinationPath "$env:TEMP\\cua-driver-driver" -Force`,
					`Move-Item (Get-ChildItem "$env:TEMP\\cua-driver-driver" -Recurse -Filter ${binaryName} | Select-Object -First 1).FullName "${path.join(binDir, binaryName)}"`,
				]
			: [
					`mkdir -p "${binDir}"`,
					`tmp=$(mktemp -d) && cd "$tmp"`,
					`curl -fsSL "${url}" -o driver.tar.gz`,
					`tar -xzf driver.tar.gz`,
					`find "$tmp" -name '${binaryName}*' -type f -perm -u+x -exec mv {} "${path.join(binDir, binaryName)}" \\;`,
				];
	return {
		platform,
		arch,
		tag: DRIVER_RELEASE_TAG,
		asset,
		url,
		binDir,
		binaryName,
		commands,
		page: DRIVER_RELEASES_PAGE,
	};
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
	// Reads with no effect on the target: a transport drop may replay them so a
	// blip does not surface as "outcome unknown" for a call that changed nothing.
	"zoom",
	"screenshot",
	"health_report",
	"check_permissions",
	"get_session",
]);
const LIFECYCLE_TOOLS = new Set(["start_session", "end_session"]);
const CALL_TIMEOUT_MS = 30_000;
/**
 * Bound on spawn + `initialize` + tools/list + session declaration. Every tool
 * call is bounded, but a wedged child (or a macOS `mcp` proxy waiting on a
 * daemon that is not answering) would otherwise hang the first call forever.
 */
const START_TIMEOUT_MS = 20_000;
/** Grace for the closing `end_session`, which cannot outlive the transport. */
const END_SESSION_GRACE_MS = 250;

export class CuaDriverClient {
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;
	private readonly tools = new Map<string, DriverTool>();
	private starting: Promise<void> | null = null;
	private stopping: Promise<void> | null = null;
	private transportSuspect = false;
	private disposed = false;
	/** Bumped on every teardown; a start that spans one must not resurrect it. */
	private transportEpoch = 0;
	/** Last stderr lines from the child, for diagnostics when it dies. */
	private stderrTail: string[] = [];
	private stderrPartial = "";
	/** Overridable for tests so a stalled start can be proved without a 20 s wait. */
	private readonly startTimeoutMs: number;

	constructor(startTimeoutMs: number = START_TIMEOUT_MS) {
		this.startTimeoutMs = startTimeoutMs;
	}

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
	 * Concurrent calls share one start. A failed start clears the memoized
	 * promise so the next call retries instead of replaying the rejection, and a
	 * stalled child fails the start instead of blocking the caller indefinitely.
	 */
	start(): Promise<void> {
		if (this.disposed) {
			throw new Error("cua-driver client has been disposed");
		}
		this.starting ??= this.beginStart();
		return this.starting;
	}

	private async beginStart(): Promise<void> {
		const epoch = this.transportEpoch;
		const attempt = this.startInternal(epoch);
		// A timeout wins the race but the attempt keeps running: consume its late
		// rejection so it never surfaces as an unhandled rejection.
		attempt.catch(() => {});
		try {
			await withTimeout(attempt, this.startTimeoutMs, "cua-driver start");
		} catch (error) {
			// Bump the epoch before tearing down so a late success from the abandoned
			// attempt cannot install a client on a transport we already closed.
			this.teardownTransport();
			this.starting = null;
			throw this.startFailure(error);
		}
	}

	/** Startup diagnostics: a child that dies on spawn reports its stderr tail. */
	private startFailure(error: unknown): Error {
		const message = error instanceof Error ? error.message : String(error);
		const diagnostics = this.stderrDiagnostics();
		if (!diagnostics) {
			return error instanceof Error ? error : new Error(message);
		}
		const suffix = ` Driver stderr: ${diagnostics.split("\n").slice(-3).join(" | ")}`;
		return new Error(`${message}${suffix}`);
	}

	private async startInternal(epoch: number): Promise<void> {
		// Clear the previous child's tail: this failure (if any) is about this child.
		this.stderrTail = [];
		this.stderrPartial = "";
		const availability = resolveDriverCommand();
		if (!availability.installed || !availability.command) {
			throw new Error(
				"cua-driver is not installed. Install the release asset matching your platform from the cua repository " +
					`(tag ${DRIVER_RELEASE_TAG}; exact commands are attached to this failure's \`install\` object), ` +
					"or point A_CODER_CUA_DRIVER_CMD at the binary.",
			);
		}
		const transport = new StdioClientTransport({
			command: availability.command,
			args: ["mcp"],
			env: driverChildEnv(),
			stderr: "pipe",
		});
		this.transport = transport;
		this.drainStderr(transport);
		const client = new Client({ name: "a-coder-cli", version: "1.0" });
		this.client = client;
		try {
			await client.connect(transport);
			if (epoch !== this.transportEpoch) {
				throw new Error("cua-driver start was abandoned");
			}
			await this.discoverTools(client);
			await this.declareSession(client);
		} catch (error) {
			this.teardownTransport();
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	private async discoverTools(client: Client): Promise<void> {
		this.tools.clear();
		// listTools pages: a driver advertising more tools than one page must not
		// end up with a half-populated map (that reads as "tool unavailable").
		const seenCursors = new Set<string>();
		let cursor: string | undefined;
		do {
			const listing = await client.listTools(cursor ? { cursor } : undefined);
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
			cursor = listing.nextCursor;
			if (cursor && seenCursors.has(cursor)) break;
			if (cursor) seenCursors.add(cursor);
		} while (cursor);
	}

	/**
	 * Drain the child's stderr. `stderr: "pipe"` without a consumer back-pressures
	 * the driver once its stderr buffer fills, so a chatty build can hang every
	 * call. Keep only a bounded tail for diagnostics.
	 */
	private drainStderr(transport: StdioClientTransport): void {
		this.stderrTail = [];
		this.stderrPartial = "";
		const stream = transport.stderr;
		if (!stream) return;
		stream.on("data", (chunk: Buffer | string) => {
			this.stderrPartial += chunk.toString();
			const lines = this.stderrPartial.split(/\r?\n/);
			this.stderrPartial = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				this.stderrTail.push(line);
			}
			if (this.stderrTail.length > 20) this.stderrTail.splice(0, this.stderrTail.length - 20);
		});
		stream.on("error", () => {
			// A broken stderr pipe must never surface as an unhandled error.
		});
	}

	/** Bounded stderr tail from the driver child (diagnostics only). */
	stderrDiagnostics(): string {
		return this.stderrTail.join("\n");
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

	private async invokeTool(client: Client, name: string, payload: Record<string, unknown>): Promise<DriverToolResult> {
		const result = await client.callTool({ name, arguments: payload }, undefined, {
			timeout: CALL_TIMEOUT_MS,
		});
		return normalizeResult(result as CallToolResult);
	}

	/**
	 * cua-driver sessions have a five-minute idle TTL. Only `start_session`
	 * revives an ended public label, and the rejected call did not execute, so
	 * replaying it after revival is safe for both reads and mutations.
	 */
	private async reviveSession(client: Client): Promise<void> {
		const result = await client.callTool(
			{ name: "start_session", arguments: { session: this.sessionId } },
			undefined,
			{ timeout: CALL_TIMEOUT_MS },
		);
		const normalized = normalizeResult(result as CallToolResult);
		// Ownership is not an ended session: start_session cannot take the label
		// back while another live connection holds it, so name the holder instead
		// of reporting a failed revival.
		if (isOwnedByOtherTransport(normalized)) {
			const owner =
				typeof normalized.structured?.owner_transport === "string"
					? normalized.structured.owner_transport
					: "another transport";
			throw new Error(
				`cua-driver session '${this.sessionId}' is held by ${owner}; this connection cannot act on it. ` +
					"Close that connection, or start a different session label.",
			);
		}
		if (normalized.isError || normalized.structured?.ok === false) {
			const detail = normalized.message || "start_session failed";
			throw new Error(`cua-driver session '${this.sessionId}' ended and could not be revived: ${detail}`);
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
		let result: DriverToolResult;
		try {
			result = await this.performCall(client, name, payload);
		} catch (error) {
			if (!LIFECYCLE_TOOLS.has(name) && isSessionEndedError(error)) {
				await this.reviveSession(client);
				return await this.performCall(client, name, payload);
			}
			throw error;
		}
		if (!LIFECYCLE_TOOLS.has(name) && isSessionEndedResult(result)) {
			await this.reviveSession(client);
			return await this.performCall(client, name, payload);
		}
		return result;
	}

	/** One tool call, with transport recovery but no session revival. */
	private async performCall(
		client: Client,
		name: string,
		payload: Record<string, unknown>,
	): Promise<DriverToolResult> {
		try {
			const result = await this.invokeTool(client, name, payload);
			this.transportSuspect = false;
			return result;
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
				const diagnostics = this.stderrDiagnostics();
				const suffix = diagnostics ? ` Driver stderr: ${diagnostics.split("\n").slice(-3).join(" | ")}` : "";
				this.teardownTransport();
				if (READ_SAFE_TOOLS.has(name)) {
					// Idempotent reads may replay once after a reconnect. Re-read the
					// client: teardown nulled it and start() spawned a replacement.
					await this.start();
					const reconnected = this.client;
					if (!reconnected) throw new Error("cua-driver client is not connected");
					return await this.invokeTool(reconnected, name, payload);
				}
				return {
					isError: true,
					structured: { ok: false, code: "transport_outcome_unknown", operation: name, next_step: "fresh_state" },
					message:
						`cua-driver transport failed during "${name}"; the action outcome is unknown, so it was not replayed. ` +
						`Take fresh state before deciding whether to act again.${suffix}`,
					images: [],
				};
			}
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	/**
	 * Best-effort teardown. `end_session` is bounded and awaited before the
	 * transport closes — queueing it and closing in the same tick would drop it.
	 * Closing the connection performs the same driver-side cleanup, so a failed or
	 * late send is harmless; callers may ignore the returned promise.
	 */
	stop(): Promise<void> {
		if (this.disposed) {
			return this.stopping ?? Promise.resolve();
		}
		this.disposed = true;
		this.stopping = this.finish();
		return this.stopping;
	}

	private async finish(): Promise<void> {
		const client = this.client;
		if (client) {
			await withTimeout(
				this.invokeTool(client, "end_session", { session: this.sessionId }),
				END_SESSION_GRACE_MS,
				"cua-driver end_session",
			).catch(() => {});
		}
		this.teardownTransport();
		this.tools.clear();
	}

	private teardownTransport(): void {
		this.transportEpoch++;
		this.transportSuspect = false;
		this.client = null;
		// Clear the memoized start with the transport: a dead transport means the
		// next start() must spawn a new child, not resolve the old promise and
		// leave `client` null.
		this.starting = null;
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const expiry = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms);
		timer.unref?.();
	});
	return Promise.race([promise, expiry]).finally(() => {
		if (timer) clearTimeout(timer);
	});
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

function sessionEndedMessage(value: unknown): boolean {
	return typeof value === "string" && /session\b[^\n]*\bhas ended\b/i.test(value);
}

function isSessionEndedResult(result: DriverToolResult): boolean {
	const structured = result.structured;
	if (structured?.code === "session_ended") return true;
	return (
		sessionEndedMessage(result.message) ||
		sessionEndedMessage(structured?.message) ||
		sessionEndedMessage(structured?.error)
	);
}

/** Another live connection holds this session label (`owner_transport`). */
function isOwnedByOtherTransport(result: DriverToolResult): boolean {
	return (
		result.structured?.code === "session_owned_by_other_transport" ||
		/session_owned_by_other_transport/.test(result.message)
	);
}

function isSessionEndedError(error: unknown): boolean {
	return error instanceof Error && /session\b[^\n]*\bhas ended\b|session_ended/i.test(error.message);
}

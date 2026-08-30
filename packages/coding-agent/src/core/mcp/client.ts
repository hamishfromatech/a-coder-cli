import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, ListToolsResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../../config.ts";
import type { McpServerConfig } from "./types.ts";

/**
 * Defensive cap on listTools() pagination so a misbehaving server cannot keep
 * us looping on cursors forever. Mirrors the SDK v2 default (listMaxPages).
 */
const MAX_LIST_PAGES = 64;

/** Connect timeout for the handshake (initialize request). SDK default timeout only covers requests. */
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

function getMcpConnectTimeoutMs(): number {
	const raw = process.env.A_CODER_CLI_MCP_CONNECT_TIMEOUT ?? process.env.MCP_CONNECT_TIMEOUT;
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONNECT_TIMEOUT_MS;
}

/** Cap on the raw server stderr tail appended to connect-failure errors. */
const STDERR_TAIL_BYTES = 64 * 1024;

interface TransportBundle {
	transport: Transport;
	/** Returns the last chunk of raw server stderr (stdio only) for error reporting. */
	getStderrTail?: () => string;
}

export interface McpDiscoveredTool {
	serverName: string;
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface McpResourceInfo {
	serverName: string;
	uri: string;
	name?: string;
	description?: string;
	mimeType?: string;
}

export interface McpCallToolOptions {
	/**
	 * Abort signal from the calling tool execution. Aborting cancels the
	 * in-flight MCP request instead of letting it run to the timeout.
	 */
	signal?: AbortSignal;
	/** Request timeout in ms. Defaults to the SDK's 60s request timeout. */
	timeoutMs?: number;
}

export interface McpClientOptions {
	/** Test seam: inject a pre-configured Client instead of creating one. */
	client?: Client;
	/** Test seam: use this transport instead of building one from the config. */
	transport?: Transport;
}

export class McpClient {
	private client: Client;
	private transport?: Transport;
	private readonly transportOverride?: Transport;
	readonly serverName: string;
	private _connected = false;
	readonly config: McpServerConfig;
	/**
	 * In-flight connect() promise, shared by all concurrent callers so the eager
	 * background connect and a first tool call never race two handshakes on the
	 * same Client. Reset on failure so the next call retries.
	 */
	private connectPromise?: Promise<void>;
	/** Set while a deliberate close() is in flight so onclose is not reported as an unexpected disconnect. */
	private closing = false;
	/** Last transport-level error seen (e.g. stdio process crash detail), surfaced via onDisconnected. */
	private lastTransportError?: Error;

	/**
	 * Invoked when the connection drops unexpectedly (server process exit,
	 * transport failure). Never called for a deliberate close().
	 */
	onDisconnected?: (error?: Error) => void;
	/** Invoked when the server sends `notifications/tools/list_changed`. */
	onToolsChanged?: () => void;

	constructor(config: McpServerConfig, options: McpClientOptions = {}) {
		this.serverName = config.name;
		this.config = config;
		this.transportOverride = options.transport;
		this.client =
			options.client ??
			new Client({ name: `a-coder-cli-mcp-${config.name}`, version: VERSION }, { capabilities: {} });
		this.client.onerror = (error) => {
			this.lastTransportError = error;
		};
		this.client.onclose = () => {
			this._connected = false;
			this.connectPromise = undefined;
			if (!this.closing) this.onDisconnected?.(this.lastTransportError);
		};
		this.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
			this.onToolsChanged?.();
		});
	}

	/** True while the transport is up. Flips to false via onclose when the server or transport dies. */
	get connected(): boolean {
		return this._connected;
	}

	/**
	 * Connect, or resolve immediately when already connected. Concurrent callers
	 * share the same in-flight handshake. Each attempt uses a fresh transport
	 * (a started transport cannot be restarted); on failure the transport is
	 * closed so a stdio spawn is not leaked.
	 */
	async connect(config: McpServerConfig = this.config): Promise<void> {
		if (this._connected) return;
		if (!this.connectPromise) {
			this.closing = false;
			this.lastTransportError = undefined;
			const bundle = this.transportOverride ? { transport: this.transportOverride } : createTransport(config);
			const transport = bundle.transport;
			this.transport = transport;
			this.connectPromise = (async () => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					// Bound the handshake with a hard timeout: the SDK's request
					// timeout only covers post-handshake requests, so a hung server
					// process would otherwise block connect() indefinitely (first
					// tool call, background discovery).
					await new Promise<void>((resolve, reject) => {
						const timeoutMs = getMcpConnectTimeoutMs();
						timer = setTimeout(() => {
							reject(new Error(`connection timed out after ${timeoutMs}ms`));
						}, timeoutMs);
						timer.unref?.();
						this.client.connect(transport).then(resolve, reject);
					});
				} catch (err) {
					this.connectPromise = undefined;
					void transport.close().catch(() => {});
					const tail = bundle.getStderrTail?.().trim() ?? "";
					const message = err instanceof Error ? err.message : String(err);
					throw tail ? new Error(`${message} (stderr: ${tail})`) : err;
				} finally {
					clearTimeout(timer);
				}
				this._connected = true;
			})();
		}
		return this.connectPromise;
	}

	/**
	 * List all tools, following pagination cursors. The v1 SDK returns a single
	 * page per request; servers with many tools (e.g. 1000+ tool aggregators)
	 * would otherwise be silently truncated.
	 */
	async listTools(): Promise<McpDiscoveredTool[]> {
		if (!this._connected) throw new Error(`MCP server ${this.serverName} is not connected`);
		const tools: McpDiscoveredTool[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < MAX_LIST_PAGES; page++) {
			const result: ListToolsResult = await this.client.listTools(cursor ? { cursor } : undefined);
			for (const tool of result.tools) {
				tools.push({
					serverName: this.serverName,
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema as Record<string, unknown>,
				});
			}
			cursor = result.nextCursor;
			if (!cursor) return tools;
		}
		return tools;
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		options: McpCallToolOptions = {},
	): Promise<CallToolResult> {
		if (!this._connected) throw new Error(`MCP server ${this.serverName} is not connected`);
		// The SDK's declared return type unions the legacy CompatibilityCallToolResult
		// (protocol 2024-10-07 servers, shape { toolResult }), but modern servers
		// always return CallToolResult. Cast so callers can rely on content/isError.
		return (await this.client.callTool({ name, arguments: args }, undefined, {
			signal: options.signal,
			timeout: options.timeoutMs,
		})) as CallToolResult;
	}

	/**
	 * List the server's resources. Servers that do not declare the resources
	 * capability reject the call (surfaced by the caller per-server).
	 */
	async listResources(options: McpCallToolOptions = {}): Promise<McpResourceInfo[]> {
		if (!this._connected) throw new Error(`MCP server ${this.serverName} is not connected`);
		const resources: McpResourceInfo[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < MAX_LIST_PAGES; page++) {
			const result = await this.client.listResources(cursor ? { cursor } : undefined, {
				signal: options.signal,
				timeout: options.timeoutMs,
			});
			for (const resource of result.resources) {
				resources.push({
					serverName: this.serverName,
					uri: resource.uri,
					name: resource.name,
					description: resource.description,
					mimeType: resource.mimeType,
				});
			}
			cursor = result.nextCursor;
			if (!cursor) return resources;
		}
		return resources;
	}

	/**
	 * Read one resource by URI. Text contents are returned inline; binary blobs
	 * keep their base64 payload — the caller decides how to present them.
	 */
	async readResource(uri: string, options: McpCallToolOptions = {}): Promise<ReadResourceResult> {
		if (!this._connected) throw new Error(`MCP server ${this.serverName} is not connected`);
		return (await this.client.readResource(
			{ uri },
			{
				signal: options.signal,
				timeout: options.timeoutMs,
			},
		)) as ReadResourceResult;
	}

	/**
	 * Close the connection. For Streamable HTTP the server-side session is
	 * terminated first so the server does not leak session state.
	 */
	async close(): Promise<void> {
		this.closing = true;
		try {
			if (this.transport instanceof StreamableHTTPClientTransport) {
				await this.transport.terminateSession().catch(() => {});
			}
			await this.client.close();
		} finally {
			this._connected = false;
			this.connectPromise = undefined;
		}
	}
}

function createTransport(config: McpServerConfig): TransportBundle {
	switch (config.transport) {
		case "stdio": {
			const suppress = config.suppressStderrPatterns?.filter((p) => p.length > 0);
			// Pipe (instead of inherit) so we also keep a raw stderr tail for
			// connect-failure error messages; matching lines and live forwarding
			// behavior are preserved via pipeStderr below.
			const transport = new StdioClientTransport({
				command: config.commandOrUrl,
				args: config.args,
				// Merge the parent environment (PATH and friends) under per-server
				// overrides: the SDK default env allowlist breaks npx-based servers
				// when any per-server env is set, since values passed here REPLACE
				// the default environment entirely.
				env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
				stderr: "pipe",
			});
			const getStderrTail = pipeStderr(transport, suppress ?? []);
			return { transport, getStderrTail };
		}
		case "sse": {
			const url = new URL(config.commandOrUrl);
			return {
				transport: new SSEClientTransport(url, {
					requestInit: { headers: config.headers },
					// The SSE event stream is a separate long-lived GET; without a
					// fetch override only the POSTs carry custom headers (e.g. auth),
					// so authenticated servers fail on the GET stream.
					eventSourceInit: {
						fetch: (url, init) =>
							fetch(url, {
								...init,
								headers: { ...(init?.headers ?? {}), ...(config.headers ?? {}) },
							}),
					},
				}),
			};
		}
		case "http": {
			const url = new URL(config.commandOrUrl);
			return {
				transport: new StreamableHTTPClientTransport(url, {
					requestInit: { headers: config.headers },
				}),
			};
		}
		default:
			throw new Error(`Unsupported MCP transport: ${(config as McpServerConfig).transport}`);
	}
}

/**
 * Pipe a stdio MCP server's stderr to the parent process, dropping any line
 * that matches one of `suppressPatterns` (each a regex source, tested per
 * line) — used to silence known-benign server noise without hiding real
 * errors. Also keeps a bounded raw tail (including suppressed lines) that
 * connect() appends to failure messages so a crashed server's last words are
 * not lost. Returns the tail getter.
 */
function pipeStderr(transport: StdioClientTransport, suppressPatterns: string[]): () => string {
	const stderr = transport.stderr;
	if (!stderr) return () => "";
	const regexes = suppressPatterns.map((p) => new RegExp(p));
	let pending = "";
	let rawTail = "";
	const forEachLine = (line: string): void => {
		if (regexes.some((r) => r.test(line))) return;
		process.stderr.write(`${line}\n`);
	};
	stderr.on("data", (chunk: Buffer) => {
		rawTail = (rawTail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
		const text = pending + chunk.toString();
		const lines = text.split(/\r?\n/);
		pending = lines.pop() ?? "";
		for (const line of lines) {
			forEachLine(line);
		}
	});
	stderr.on("end", () => {
		if (pending) forEachLine(pending);
	});
	return () => rawTail;
}

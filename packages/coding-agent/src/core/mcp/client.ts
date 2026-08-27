import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../../config.ts";
import type { McpServerConfig } from "./types.ts";

/**
 * Defensive cap on listTools() pagination so a misbehaving server cannot keep
 * us looping on cursors forever. Mirrors the SDK v2 default (listMaxPages).
 */
const MAX_LIST_PAGES = 64;

export interface McpDiscoveredTool {
	serverName: string;
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
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
			const transport = this.transportOverride ?? createTransport(config);
			this.transport = transport;
			this.connectPromise = this.client
				.connect(transport)
				.then(() => {
					this._connected = true;
				})
				.catch((err) => {
					this.connectPromise = undefined;
					void transport.close().catch(() => {});
					throw err;
				});
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

function createTransport(config: McpServerConfig): Transport {
	switch (config.transport) {
		case "stdio": {
			const suppress = config.suppressStderrPatterns?.filter((p) => p.length > 0);
			if (!suppress || suppress.length === 0) {
				return new StdioClientTransport({
					command: config.commandOrUrl,
					args: config.args,
					env: config.env,
					stderr: "inherit",
				});
			}
			const transport = new StdioClientTransport({
				command: config.commandOrUrl,
				args: config.args,
				env: config.env,
				stderr: "pipe",
			});
			filterStderr(transport, suppress);
			return transport;
		}
		case "sse": {
			const url = new URL(config.commandOrUrl);
			return new SSEClientTransport(url, {
				requestInit: { headers: config.headers },
			});
		}
		case "http": {
			const url = new URL(config.commandOrUrl);
			return new StreamableHTTPClientTransport(url, {
				requestInit: { headers: config.headers },
			});
		}
		default:
			throw new Error(`Unsupported MCP transport: ${(config as McpServerConfig).transport}`);
	}
}

/**
 * Forward a stdio MCP server's stderr to the parent process, dropping any line
 * that matches one of `patterns` (each a regex source, tested per line). Used
 * to silence known-benign server noise without hiding real errors.
 */
function filterStderr(transport: StdioClientTransport, patterns: string[]): void {
	const stderr = transport.stderr;
	if (!stderr) return;
	const regexes = patterns.map((p) => new RegExp(p));
	let tail = "";
	stderr.on("data", (chunk: Buffer) => {
		const text = tail + chunk.toString();
		const lines = text.split(/\r?\n/);
		tail = lines.pop() ?? "";
		for (const line of lines) {
			if (regexes.some((r) => r.test(line))) continue;
			process.stderr.write(`${line}\n`);
		}
	});
	stderr.on("end", () => {
		if (tail && !regexes.some((r) => r.test(tail))) process.stderr.write(tail);
	});
}

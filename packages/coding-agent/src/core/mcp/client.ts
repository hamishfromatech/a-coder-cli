import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "./types.ts";

export interface McpDiscoveredTool {
	serverName: string;
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export class McpClient {
	private client: Client;
	readonly serverName: string;
	private _connected = false;
	readonly config: McpServerConfig;

	constructor(config: McpServerConfig) {
		this.serverName = config.name;
		this.config = config;
		this.client = new Client({ name: `a-coder-cli-mcp-${config.name}`, version: "0.80.3" }, { capabilities: {} });
	}

	/** True once connect() has succeeded and close() has not been called. */
	get connected(): boolean {
		return this._connected;
	}

	async connect(config: McpServerConfig): Promise<void> {
		const transport = createTransport(config);
		await this.client.connect(transport);
		this._connected = true;
	}

	async listTools(): Promise<McpDiscoveredTool[]> {
		if (!this._connected) throw new Error(`MCP server ${this.serverName} is not connected`);
		const result = await this.client.listTools();
		return result.tools.map((tool) => ({
			serverName: this.serverName,
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as Record<string, unknown>,
		}));
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		if (!this._connected) throw new Error(`MCP server ${this.serverName} is not connected`);
		const result = await this.client.callTool({ name, arguments: args });
		return result;
	}

	async close(): Promise<void> {
		await this.client.close();
		this._connected = false;
	}
}

function createTransport(config: McpServerConfig) {
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
			process.stderr.write(line + "\n");
		}
	});
	stderr.on("end", () => {
		if (tail && !regexes.some((r) => r.test(tail))) process.stderr.write(tail);
	});
}

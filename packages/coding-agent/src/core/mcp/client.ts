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
	private connected = false;

	constructor(config: McpServerConfig) {
		this.serverName = config.name;
		this.client = new Client({ name: `a-coder-cli-mcp-${config.name}`, version: "0.80.3" }, { capabilities: {} });
	}

	async connect(config: McpServerConfig): Promise<void> {
		const transport = createTransport(config);
		await this.client.connect(transport);
		this.connected = true;
	}

	async listTools(): Promise<McpDiscoveredTool[]> {
		if (!this.connected) throw new Error(`MCP server ${this.serverName} is not connected`);
		const result = await this.client.listTools();
		return result.tools.map((tool) => ({
			serverName: this.serverName,
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as Record<string, unknown>,
		}));
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		if (!this.connected) throw new Error(`MCP server ${this.serverName} is not connected`);
		const result = await this.client.callTool({ name, arguments: args });
		return result;
	}

	async close(): Promise<void> {
		await this.client.close();
		this.connected = false;
	}
}

function createTransport(config: McpServerConfig) {
	switch (config.transport) {
		case "stdio": {
			return new StdioClientTransport({
				command: config.commandOrUrl,
				args: config.args,
				env: config.env,
				stderr: "inherit",
			});
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

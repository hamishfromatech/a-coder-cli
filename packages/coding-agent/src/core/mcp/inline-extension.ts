import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionFactory } from "../extensions/types.ts";
import { McpClient } from "./client.ts";
import { jsonSchemaToTypeBox } from "./schema.ts";
import type { McpServerConfig } from "./types.ts";

export interface McpExtensionFactoryOptions {
	servers: McpServerConfig[];
}

export function createMcpExtensionFactory(options: McpExtensionFactoryOptions): ExtensionFactory {
	return async (pi) => {
		const clients: McpClient[] = [];
		const allTools: Array<{
			client: McpClient;
			name: string;
			description?: string;
			inputSchema: Record<string, unknown>;
		}> = [];

		for (const server of options.servers) {
			if (server.disabled) continue;
			const client = new McpClient(server);
			try {
				await client.connect(server);
				const tools = await client.listTools();
				for (const tool of tools) {
					allTools.push({
						client,
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
					});
				}
				clients.push(client);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.warn(`Failed to load MCP server "${server.name}": ${message}`);
			}
		}

		for (const tool of allTools) {
			pi.registerTool({
				name: `mcp_${tool.name}`,
				label: `MCP: ${tool.name}`,
				description: tool.description ?? `MCP tool "${tool.name}" from ${tool.client.serverName}`,
				parameters: jsonSchemaToTypeBox(tool.inputSchema),
				async execute(_toolCallId, params, _signal): Promise<AgentToolResult<unknown>> {
					const result = await tool.client.callTool(tool.name, params as Record<string, unknown>);
					const text = formatMcpResult(result);
					return {
						content: [{ type: "text", text }],
						details: result,
					};
				},
			});
		}

		pi.on("session_shutdown", () => {
			for (const client of clients) {
				void client.close();
			}
		});
	};
}

function formatMcpResult(result: unknown): string {
	if (result === null || result === undefined) return "";
	if (typeof result === "string") return result;
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
}

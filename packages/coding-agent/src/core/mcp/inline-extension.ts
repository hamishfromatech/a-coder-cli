import type { AgentToolResult } from "@theatechcorporation/pi-agent-core";
import type { ExtensionFactory } from "../extensions/types.ts";
import type { McpDiscoveredTool } from "./client.ts";
import { McpClient } from "./client.ts";
import { jsonSchemaToTypeBox } from "./schema.ts";
import type { McpServerConfig } from "./types.ts";

export interface McpExtensionFactoryOptions {
	servers: McpServerConfig[];
}

export function createMcpExtensionFactory(options: McpExtensionFactoryOptions): ExtensionFactory {
	return async (pi) => {
		const clients: McpClient[] = [];
		// Connect to servers lazily. Each tool's execute() ensures its server is
		// connected and discovered before calling, so a slow or failing MCP
		// server never blocks session startup/switch.
		for (const server of options.servers) {
			if (server.disabled) continue;
			const client = new McpClient(server);
			// Eagerly attempt a lightweight connect in the background so the first
			// actual tool call is fast, but do not block extension registration on it.
			void (async () => {
				try {
					await client.connect(server);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.warn(`Failed to load MCP server "${server.name}": ${message}`);
				}
			})();
			clients.push(client);
		}

		// Register a single lazy-discovery stub per server. We don't know the
		// tool names until the server is connected, so the stub advertises itself
		// as a placeholder and resolves to real tools on first use.
		for (const client of clients) {
			let discoveredTools: McpDiscoveredTool[] | undefined;
			let discoveryError: string | undefined;
			const discover = async (): Promise<{ tools: McpDiscoveredTool[]; error?: string }> => {
				if (discoveredTools) return { tools: discoveredTools };
				if (discoveryError) return { tools: [], error: discoveryError };
				try {
					if (!client.connected) {
						await client.connect(client.config);
					}
					discoveredTools = await client.listTools();
					return { tools: discoveredTools };
				} catch (err) {
					discoveryError = err instanceof Error ? err.message : String(err);
					console.warn(`MCP server "${client.serverName}" discovery failed: ${discoveryError}`);
					return { tools: [], error: discoveryError };
				}
			};

			pi.registerTool({
				name: `mcp_${client.serverName}`,
				label: `MCP: ${client.serverName}`,
				description: `Discover and call tools from MCP server "${client.serverName}". Runs lazily when invoked.`,
				parameters: jsonSchemaToTypeBox({
					type: "object",
					properties: {
						tool: {
							type: "string",
							description: `Tool name on server "${client.serverName}"`,
						},
						arguments: {
							type: "object",
							description: "Arguments for the selected tool",
						},
					},
					required: ["tool", "arguments"],
				}),
				async execute(_toolCallId, rawParams, _signal): Promise<AgentToolResult<unknown>> {
					const params = rawParams as { tool?: unknown; arguments?: unknown };
					const { tools, error } = await discover();
					if (error) {
						return {
							content: [{ type: "text", text: `MCP server "${client.serverName}" is unavailable: ${error}` }],
							details: { error },
						};
					}
					const toolName = typeof params.tool === "string" ? params.tool : "";
					const toolArgs =
						typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {};
					const tool = tools.find((t) => t.name === toolName);
					if (!tool) {
						const available = tools.map((t) => t.name).join(", ") || "(none discovered)";
						return {
							content: [
								{
									type: "text",
									text: `Tool "${toolName}" not found on MCP server "${client.serverName}". Available: ${available}`,
								},
							],
							details: { available: tools.map((t) => t.name) },
						};
					}
					const result = await client.callTool(toolName, toolArgs as Record<string, unknown>);
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

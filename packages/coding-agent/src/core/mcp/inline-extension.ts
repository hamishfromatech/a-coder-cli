import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionFactory, ExtensionUIContext } from "../extensions/types.ts";
import type { McpDiscoveredTool } from "./client.ts";
import { McpClient } from "./client.ts";
import { jsonSchemaToTypeBox } from "./schema.ts";
import { clearMcpServerStates, countMcpServerErrors, getMcpServerStates, setMcpServerState } from "./status-store.ts";
import type { McpServerConfig } from "./types.ts";

export interface McpExtensionFactoryOptions {
	servers: McpServerConfig[];
}

export function createMcpExtensionFactory(options: McpExtensionFactoryOptions): ExtensionFactory {
	return async (pi) => {
		clearMcpServerStates();
		// The UI context (footer setStatus) is only available from event handlers
		// that receive an ExtensionContext; capture it on session_start and use it
		// to push the subtle footer chip. setStatus is a no-op until then, and
		// session_start re-renders the chip once it's available.
		let uiCtx: ExtensionUIContext | undefined;
		const recomputeMcpChip = (): void => {
			const down = countMcpServerErrors();
			uiCtx?.setStatus("mcp", down > 0 ? `⚠ ${down} MCP server${down === 1 ? "" : "s"} down` : undefined);
		};

		const clients: McpClient[] = [];
		// Connect to servers lazily. Each tool's execute() ensures its server is
		// connected and discovered before calling, so a slow or failing MCP
		// server never blocks session startup/switch. Load failures are recorded
		// in the MCP status store and surfaced as a subtle footer chip (see
		// recomputeMcpChip) instead of console.warn, which would dump the full
		// (often verbose) error into the TUI.
		for (const server of options.servers) {
			if (server.disabled) {
				setMcpServerState(server.name, { status: "disabled" });
				continue;
			}
			setMcpServerState(server.name, { status: "connecting" });
			const client = new McpClient(server);
			// Eagerly attempt a lightweight connect in the background so the first
			// actual tool call is fast, but do not block extension registration on it.
			void (async () => {
				try {
					await client.connect();
					setMcpServerState(server.name, { status: "ok" });
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					setMcpServerState(server.name, { status: "error", error: message });
				} finally {
					recomputeMcpChip();
				}
			})();
			clients.push(client);
		}
		recomputeMcpChip();

		// Register a single lazy-discovery stub per server. We don't know the
		// tool names until the server is connected, so the stub advertises itself
		// as a placeholder and resolves to real tools on first use.
		for (const client of clients) {
			let discoveredTools: McpDiscoveredTool[] | undefined;
			let discoveryError: string | undefined;
			const invalidateDiscovery = (): void => {
				discoveredTools = undefined;
				discoveryError = undefined;
			};
			// If the server process dies or the transport drops mid-session, the
			// client's connected flag flips to false via onclose. Drop the cached
			// tool list so the next tool call reconnects and re-discovers, and
			// surface the outage in the status store (unless an error is already
			// recorded, e.g. from the initial connect attempt, which has a more
			// specific message).
			client.onDisconnected = (error) => {
				invalidateDiscovery();
				const state = getMcpServerStates().find((s) => s.name === client.serverName);
				if (state?.status !== "error") {
					setMcpServerState(client.serverName, {
						status: "error",
						error: error?.message ?? "Connection lost",
					});
					recomputeMcpChip();
				}
			};
			// The server told us its tool list changed: drop the cache so the next
			// tool call re-lists instead of failing on a stale entry.
			client.onToolsChanged = invalidateDiscovery;

			const discover = async (): Promise<{ tools: McpDiscoveredTool[]; error?: string }> => {
				if (discoveredTools) return { tools: discoveredTools };
				if (discoveryError) return { tools: [], error: discoveryError };
				try {
					await client.connect();
					discoveredTools = await client.listTools();
					setMcpServerState(client.serverName, { status: "ok" });
					recomputeMcpChip();
					return { tools: discoveredTools };
				} catch (err) {
					discoveryError = err instanceof Error ? err.message : String(err);
					setMcpServerState(client.serverName, { status: "error", error: discoveryError });
					recomputeMcpChip();
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
				async execute(_toolCallId, rawParams, signal): Promise<AgentToolResult<unknown>> {
					const params = rawParams as { tool?: unknown; arguments?: unknown };
					let { tools, error } = await discover();
					if (error) {
						return {
							content: [{ type: "text", text: `MCP server "${client.serverName}" is unavailable: ${error}` }],
							details: { error },
						};
					}
					const toolName = typeof params.tool === "string" ? params.tool : "";
					const toolArgs =
						typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {};
					let tool = tools.find((t) => t.name === toolName);
					if (!tool) {
						// The cached list may be stale (e.g. the server changed its tools
						// before we registered the list_changed handler). Refresh once
						// before reporting failure.
						invalidateDiscovery();
						const refreshed = await discover();
						if (refreshed.error) {
							return {
								content: [
									{
										type: "text",
										text: `MCP server "${client.serverName}" is unavailable: ${refreshed.error}`,
									},
								],
								details: { error: refreshed.error },
							};
						}
						tools = refreshed.tools;
						tool = tools.find((t) => t.name === toolName);
					}
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
					// Propagate the agent's abort signal so cancelling the tool call in
					// the UI also cancels the in-flight MCP request, and apply the
					// server's configured timeout (SDK default: 60s).
					const result = await client.callTool(toolName, toolArgs as Record<string, unknown>, {
						signal,
						timeoutMs: client.config.timeoutMs,
					});
					// MCP tool failures resolve as normal results with isError: true,
					// they do not throw. Surface them as errors so the model sees a
					// failure instead of a JSON envelope that looks like success.
					const text = formatMcpResult(result);
					if (result.isError) {
						throw new Error(
							text
								? `MCP tool "${toolName}" on "${client.serverName}" failed: ${text}`
								: `MCP tool "${toolName}" on "${client.serverName}" failed`,
						);
					}
					return {
						content: [{ type: "text", text }],
						details: result,
					};
				},
			});
		}

		// Capture the UI context (footer setStatus) once the session starts, then
		// push the current chip so it appears even if connects resolved earlier.
		pi.on("session_start", (_event, ctx) => {
			uiCtx = ctx.ui;
			recomputeMcpChip();
		});

		pi.on("session_shutdown", () => {
			for (const client of clients) {
				void client.close();
			}
		});
	};
}

/**
 * Render an MCP CallToolResult as text for the model: text blocks joined by
 * newlines, non-text blocks as compact placeholders, falling back to the
 * structured content when a server returns no content blocks.
 */
export function formatMcpResult(result: CallToolResult): string {
	const parts: string[] = [];
	for (const block of result.content ?? []) {
		const text = formatContentBlock(block);
		if (text !== undefined) parts.push(text);
	}
	if (parts.length === 0 && result.structuredContent !== undefined) {
		try {
			return JSON.stringify(result.structuredContent, null, 2);
		} catch {
			return String(result.structuredContent);
		}
	}
	return parts.join("\n");
}

function formatContentBlock(block: ContentBlock): string | undefined {
	switch (block.type) {
		case "text":
			return block.text;
		case "image":
			return `[image: ${block.mimeType}]`;
		case "audio":
			return `[audio: ${block.mimeType}]`;
		case "resource_link":
			return `[resource: ${block.name}] ${block.uri}`;
		case "resource":
			if ("text" in block.resource) return block.resource.text;
			return `[resource: ${block.resource.mimeType ?? "unknown type"}] ${block.resource.uri}`;
		default:
			return undefined;
	}
}

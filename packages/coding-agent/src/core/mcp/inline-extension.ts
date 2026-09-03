import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { CallToolResult, ContentBlock, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionFactory, ExtensionUIContext } from "../extensions/types.ts";
import type { McpDiscoveredTool } from "./client.ts";
import { McpClient } from "./client.ts";
import { jsonSchemaToTypeBox } from "./schema.ts";
import { clearMcpServerStates, countMcpServerErrors, getMcpServerStates, setMcpServerState } from "./status-store.ts";
import type { McpServerConfig } from "./types.ts";

export interface McpExtensionFactoryOptions {
	servers: McpServerConfig[];
	/**
	 * Workspace roots reported to servers via the MCP `roots` capability.
	 * Defaults to the process working directory when omitted.
	 */
	workspaceRoots?: string[];
	/**
	 * Test seam: construct the MCP client for a server config. Defaults to
	 * `new McpClient(server)`. Tests inject clients bound to in-memory
	 * transports so no real server process is needed.
	 */
	createClient?: (server: McpServerConfig) => McpClient;
}

/**
 * Servers exposing at most this many tools get one first-class agent tool per
 * MCP tool (mcp__<server>__<tool>) and no stub at all. Servers above the
 * threshold get only the gateway stub (mcp_<server>), so aggregator servers
 * (1000+ tools) cannot flood the model's tool list.
 */
export const MAX_FIRST_CLASS_TOOLS = 50;

/** Restrict a tool-name segment to characters accepted by provider tool-name validators. */
function sanitizeNamePart(part: string): string {
	const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
	return sanitized.length > 0 ? sanitized : "tool";
}

/** First-class agent-tool name for a discovered MCP tool, e.g. mcp__chrome-devtools__navigate_page. */
export function firstClassToolName(serverName: string, toolName: string): string {
	const name = `mcp__${sanitizeNamePart(serverName)}__${sanitizeNamePart(toolName)}`;
	// Anthropic caps tool names at 128 chars; trim the composite name if needed.
	return name.length > 128 ? name.slice(0, 128) : name;
}

/** Names of properties the tool's input schema marks as required. */
function requiredInputProperties(schema: unknown): string[] {
	if (schema === null || typeof schema !== "object") return [];
	const required = (schema as { required?: unknown }).required;
	if (!Array.isArray(required)) return [];
	return required.filter((key): key is string => typeof key === "string");
}

/** Render an input schema for a model-facing error, bounded so OpenAPI-derived giants stay digestible. */
function formatSchemaForError(schema: unknown): string {
	let text: string;
	try {
		text = JSON.stringify(schema, null, 2);
	} catch {
		return String(schema);
	}
	if (text.length > 4000) {
		text = `${text.slice(0, 4000)}… [truncated]`;
	}
	return text;
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

		/**
		 * Register each discovered MCP tool as a first-class agent tool
		 * (mcp__<server>__<tool>) with its real input schema and description, so
		 * the model sees exact tool names and argument shapes up front. Called
		 * after every successful discovery; re-registration overwrites in place.
		 * Guarded: registration after the session was replaced throws from
		 * assertActive — the background connect must not crash on it.
		 */
		const registerDiscoveredTools = (client: McpClient, tools: McpDiscoveredTool[]): void => {
			if (tools.length === 0 || tools.length > MAX_FIRST_CLASS_TOOLS) return;
			for (const tool of tools) {
				try {
					pi.registerTool({
						name: firstClassToolName(client.serverName, tool.name),
						label: `MCP ${client.serverName}: ${tool.name}`,
						description: tool.description ?? `Tool "${tool.name}" on MCP server "${client.serverName}".`,
						parameters: jsonSchemaToTypeBox(tool.inputSchema),
						async execute(_toolCallId, params, signal): Promise<AgentToolResult<unknown>> {
							return runMcpTool(client, tool.name, params as Record<string, unknown>, signal);
						},
					});
				} catch {
					// Session was replaced/reloaded mid-connect; the fresh extension
					// instance registers its own tools. Nothing to do here.
				}
			}
		};

		const clients: McpClient[] = [];
		// Connect to servers lazily. Discovery runs in the background below and
		// registers each server's first-class tools (or, for oversized servers,
		// the gateway stub instead), so a slow or failing MCP server never blocks
		// session startup/switch. Load failures are recorded in the MCP status
		// store and surfaced as a subtle footer chip (see recomputeMcpChip)
		// instead of console.warn, which would dump the full (often verbose)
		// error into the TUI.
		for (const server of options.servers) {
			if (server.disabled) {
				setMcpServerState(server.name, { status: "disabled" });
				continue;
			}
			setMcpServerState(server.name, { status: "connecting" });
			clients.push(
				options.createClient
					? options.createClient(server)
					: new McpClient(server, { workspaceRoots: options.workspaceRoots }),
			);
		}
		recomputeMcpChip();

		/**
		 * Cross-server resource tools: list resources across all configured MCP
		 * servers (optional per-server filter) and read one resource by server+URI.
		 * Registered up front (they do not depend on tool discovery) and
		 * transparently trigger each server's lazy connect on use.
		 */
		const mcpTimeoutOptions = (signal: AbortSignal | undefined, server: McpClient | undefined) => ({
			signal,
			timeoutMs: server?.config.timeoutMs,
		});
		try {
			pi.registerTool({
				name: "mcp_list_resources",
				label: "MCP: List resources",
				description:
					"List resources exposed by MCP servers. Optionally filter by server name. " +
					"Returns server, display name, URI, MIME type and description per resource.",
				parameters: jsonSchemaToTypeBox({
					type: "object",
					properties: {
						server: {
							type: "string",
							description: "Optional server name to list resources for (default: all servers)",
						},
					},
				}),
				async execute(_toolCallId, rawParams, signal): Promise<AgentToolResult<unknown>> {
					const params = rawParams as { server?: unknown };
					const filter = typeof params?.server === "string" ? params.server : undefined;
					const targets = clients.filter((c) => !filter || c.serverName === filter);
					if (targets.length === 0) {
						return {
							content: [{ type: "text", text: `No MCP server named "${filter ?? ""}" is configured.` }],
							details: { error: "unknown-server" },
						};
					}
					const lines: string[] = [];
					const all: unknown[] = [];
					for (const client of targets) {
						try {
							await client.connect();
							const resources = await client.listResources(mcpTimeoutOptions(signal, client));
							all.push(...resources);
							if (resources.length === 0) {
								lines.push(`[${client.serverName}] (no resources)`);
								continue;
							}
							for (const resource of resources) {
								const label = resource.name ? `${resource.name}: ` : "";
								const mime = resource.mimeType ? ` (${resource.mimeType})` : "";
								const desc = resource.description ? ` — ${resource.description}` : "";
								lines.push(`[${client.serverName}] ${label}${resource.uri}${mime}${desc}`);
							}
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							lines.push(`[${client.serverName}] unavailable: ${message}`);
						}
					}
					return {
						content: [{ type: "text", text: lines.join("\n") || "(no resources)" }],
						details: { resources: all },
					};
				},
			});
			pi.registerTool({
				name: "mcp_read_resource",
				label: "MCP: Read resource",
				description:
					"Read one resource from an MCP server. Pass the server name and the resource URI (from mcp_list_resources). " +
					"Text contents are returned inline; binary contents are reported but not rendered.",
				parameters: jsonSchemaToTypeBox({
					type: "object",
					properties: {
						server: { type: "string", description: "MCP server name" },
						uri: { type: "string", description: "Resource URI" },
					},
					required: ["server", "uri"],
				}),
				async execute(_toolCallId, rawParams, signal): Promise<AgentToolResult<unknown>> {
					const params = rawParams as { server?: unknown; uri?: unknown };
					const serverName = typeof params?.server === "string" ? params.server : "";
					const uri = typeof params?.uri === "string" ? params.uri : "";
					if (!serverName || !uri) {
						return {
							content: [{ type: "text", text: 'Both "server" and "uri" are required.' }],
							details: { error: "missing-arguments" },
						};
					}
					const client = clients.find((c) => c.serverName === serverName);
					if (!client) {
						return {
							content: [{ type: "text", text: `No MCP server named "${serverName}" is configured.` }],
							details: { error: "unknown-server" },
						};
					}
					try {
						await client.connect();
						const result = await client.readResource(uri, mcpTimeoutOptions(signal, client));
						const text = formatMcpResourceResult(result);
						return { content: [{ type: "text", text }], details: result };
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						throw new Error(`MCP resource "${uri}" on server "${serverName}" failed: ${message}`);
					}
				},
			});
		} catch {
			// Session was replaced/reloaded mid-connect; the fresh extension
			// instance registers its own tools. Nothing to do here.
		}

		for (const client of clients) {
			let discoveredTools: McpDiscoveredTool[] | undefined;
			let discoveryError: string | undefined;
			const invalidateDiscovery = (): void => {
				discoveredTools = undefined;
				discoveryError = undefined;
			};

			/**
			 * Register the per-server gateway stub (mcp_<server>) — the only entry
			 * point for servers exposing more than MAX_FIRST_CLASS_TOOLS tools. It
			 * exists ONLY for those oversized servers: every other server exercises
			 * the first-class path exclusively, so smaller models never see the
			 * nested {tool, arguments} indirection at all.
			 *
			 * The stub's `arguments` parameter is deliberately optional so an empty
			 * call reaches execute instead of failing schema validation, where the
			 * fail-fast below can echo the target tool's input schema.
			 */
			const registerGatewayStub = (toolCount: number): void => {
				try {
					pi.registerTool({
						name: `mcp_${client.serverName}`,
						label: `MCP: ${client.serverName}`,
						description:
							`Gateway to MCP server "${client.serverName}", which exposes ${toolCount} tools — too many to ` +
							`list individually. Call it with { "tool": <name>, "arguments": <JSON object matching that ` +
							`tool's input schema> }. Calling it with an unrecognized tool name returns the list of ` +
							`available tool names.`,
						parameters: jsonSchemaToTypeBox({
							type: "object",
							properties: {
								tool: {
									type: "string",
									description: `Tool name on server "${client.serverName}"`,
								},
								arguments: {
									type: "object",
									description: "JSON object matching the selected tool's input schema",
								},
							},
							required: ["tool"],
						}),
						async execute(_toolCallId, rawParams, signal): Promise<AgentToolResult<unknown>> {
							const params = rawParams as { tool?: unknown; arguments?: unknown };
							let { tools, error } = await discover();
							if (error) {
								return {
									content: [
										{ type: "text", text: `MCP server "${client.serverName}" is unavailable: ${error}` },
									],
									details: { error },
								};
							}
							const toolName = typeof params.tool === "string" ? params.tool : "";
							const toolArgs =
								typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {};
							let tool = tools.find((t) => t.name === toolName);
							if (!tool) {
								// The cached list may be stale (e.g. the server changed its
								// tools before we registered the list_changed handler).
								// Refresh once before reporting failure.
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
							// Fail fast when the model sent no arguments but the tool
							// requires them: echo the input schema instead of forwarding {}
							// to the server and looping on the server's validation error.
							// Only the fully-empty case is intercepted; partial arguments
							// still reach the server, whose error names the missing field.
							if (Object.keys(toolArgs).length === 0) {
								const required = requiredInputProperties(tool.inputSchema);
								if (required.length > 0) {
									throw new Error(
										`MCP tool "${toolName}" on server "${client.serverName}" requires arguments but ` +
											`none were provided. Required properties: ${required.join(", ")}. Retry with ` +
											`"arguments" matching this input schema:\n${formatSchemaForError(tool.inputSchema)}`,
									);
								}
							}
							return runMcpTool(client, tool.name, toolArgs as Record<string, unknown>, signal);
						},
					});
				} catch {
					// Session was replaced/reloaded mid-discovery; the fresh extension
					// instance registers its own stub. Nothing to do here.
				}
			};

			/**
			 * Connect (memoized) and list the server's tools. Caches the result per
			 * client (so the stub's execute path transparently reconnects after a
			 * drop), registers first-class tools for servers within the tool-count
			 * budget, and the gateway stub for oversized servers. Errors are cached
			 * until invalidation.
			 */
			const discover = async (): Promise<{ tools: McpDiscoveredTool[]; error?: string }> => {
				if (discoveredTools) return { tools: discoveredTools };
				if (discoveryError) return { tools: [], error: discoveryError };
				try {
					await client.connect();
					discoveredTools = await client.listTools();
					setMcpServerState(client.serverName, { status: "ok" });
					recomputeMcpChip();
					if (discoveredTools.length > MAX_FIRST_CLASS_TOOLS) {
						registerGatewayStub(discoveredTools.length);
					} else {
						registerDiscoveredTools(client, discoveredTools);
					}
					return { tools: discoveredTools };
				} catch (err) {
					discoveryError = err instanceof Error ? err.message : String(err);
					setMcpServerState(client.serverName, { status: "error", error: discoveryError });
					recomputeMcpChip();
					return { tools: [], error: discoveryError };
				}
			};

			// If the server process dies or the transport drops mid-session, the
			// client's connected flag flips to false via onclose. Drop the cached
			// tool list so the next tool call reconnects and re-discovers, and
			// surface the outage in the status store (unless an error is already
			// recorded, e.g. from the initial connect attempt, which has a more
			// specific message). First-class tools stay registered: their execute
			// path (runMcpTool) reconnects transparently.
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

			// The server told us its tool list changed: drop the cache and
			// re-discover in the background so first-class tools are re-registered
			// (added/removed tools appear or disappear on the next turn) without
			// waiting for a model tool call.
			client.onToolsChanged = () => {
				invalidateDiscovery();
				void discover();
			};

			// Connect + discover eagerly in the background so the server's tools
			// reach the model's tool list on the next turn. Never blocks startup;
			// failures land in the status store via discover()'s catch.
			void discover();
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
 * Shared dispatch for both the first-class mcp__<server>__<tool> tools and the
 * gateway stub: make sure the server is connected (reconnecting transparently
 * after a mid-session drop), apply the abort signal and the server's
 * configured timeout, surface MCP isError results as agent tool errors, and
 * render content blocks as model-facing text.
 */
async function runMcpTool(
	client: McpClient,
	toolName: string,
	toolArgs: Record<string, unknown>,
	signal: AbortSignal | undefined,
): Promise<AgentToolResult<unknown>> {
	try {
		// Memoized connect: a no-op when connected, a fresh handshake after a drop.
		await client.connect();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: "text", text: `MCP server "${client.serverName}" is unavailable: ${message}` }],
			details: { error: message },
		};
	}
	// Propagate the agent's abort signal so cancelling the tool call in
	// the UI also cancels the in-flight MCP request, and apply the
	// server's configured timeout (SDK default: 60s).
	const result = await client.callTool(toolName, toolArgs, {
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

/**
 * Render an MCP ReadResourceResult as model-facing text: text contents
 * inline, binary blobs as bounded placeholders, multiple content items
 * separated by headers.
 */
export function formatMcpResourceResult(result: ReadResourceResult): string {
	const contents = result.contents ?? [];
	if (contents.length === 0) return "(resource has no contents)";
	if (contents.length === 1) return renderOneResource(contents[0]);
	return contents.map((content, i) => `[${i + 1}/${contents.length}] ${renderOneResource(content)}`).join("\n\n");
}

function renderOneResource(content: ReadResourceResult["contents"][number]): string {
	const header = content.mimeType ? `[${content.mimeType}] ` : "";
	if ("text" in content) {
		return `${header}${content.uri}\n${content.text}`;
	}
	const approxBytes = Math.floor((content.blob.length * 3) / 4);
	return `${header}${content.uri}\n[binary content: ~${approxBytes} bytes of base64 — read via a file/download tool if needed]`;
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

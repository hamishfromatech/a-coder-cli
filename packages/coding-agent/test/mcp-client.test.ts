import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClient, type McpDiscoveredTool } from "../src/core/mcp/client.ts";
import { firstClassToolName, formatMcpResult, MAX_FIRST_CLASS_TOOLS } from "../src/core/mcp/inline-extension.ts";
import type { McpServerConfig } from "../src/core/mcp/types.ts";

const config: McpServerConfig = { name: "test", transport: "stdio", commandOrUrl: "unused" };

function makeTool(name: string): { name: string; inputSchema: Record<string, unknown> } {
	return { name, inputSchema: { type: "object", properties: {} } };
}

interface LinkedFixture {
	mc: McpClient;
	server: Server;
	serverTransport: InMemoryTransport;
	clientTransport: InMemoryTransport;
	injected: Client;
}

/** Client + in-memory server pair. connect() is NOT called; tests decide when. */
async function createLinked(): Promise<LinkedFixture> {
	const injected = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const server = new Server({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
	const mc = new McpClient(config, { client: injected, transport: clientTransport });
	await server.connect(serverTransport);
	return { mc, server, serverTransport, clientTransport, injected };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("McpClient", () => {
	it("aggregates paginated listTools results", async () => {
		const { mc, server } = await createLinked();
		server.setRequestHandler(ListToolsRequestSchema, async (request) => {
			if (!request.params?.cursor) {
				return { tools: [makeTool("a")], nextCursor: "page-2" };
			}
			return { tools: [makeTool("b"), makeTool("c")] };
		});
		await mc.connect();
		const tools = await mc.listTools();
		expect(tools.map((t) => t.name)).toEqual(["a", "b", "c"]);
		await mc.close();
	});

	it("stops paginating after the safety cap even if the server keeps returning cursors", async () => {
		const { mc, server } = await createLinked();
		let calls = 0;
		server.setRequestHandler(ListToolsRequestSchema, async () => {
			calls++;
			return { tools: [makeTool(`t${calls}`)], nextCursor: `page-${calls}` };
		});
		await mc.connect();
		const tools = await mc.listTools();
		expect(calls).toBeLessThanOrEqual(64);
		expect(tools).toHaveLength(calls);
		await mc.close();
	});

	it("returns raw callTool results including isError flags", async () => {
		const { mc, server } = await createLinked();
		server.setRequestHandler(CallToolRequestSchema, async (request) => {
			if (request.params.name === "fail") {
				return { content: [{ type: "text", text: "boom" }], isError: true };
			}
			return { content: [{ type: "text", text: "ok" }] };
		});
		await mc.connect();
		const result = await mc.callTool("fail", {});
		expect(result.isError).toBe(true);
		expect(result.content).toEqual([{ type: "text", text: "boom" }]);
		const ok = await mc.callTool("succeed", {});
		expect(ok.isError).toBeUndefined();
		await mc.close();
	});

	it("propagates abort signals to in-flight calls", async () => {
		const { mc, server } = await createLinked();
		let release: (() => void) | undefined;
		server.setRequestHandler(CallToolRequestSchema, async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return { content: [] };
		});
		await mc.connect();
		const controller = new AbortController();
		const pending = mc.callTool("slow", {}, { signal: controller.signal });
		await vi.waitFor(() => expect(release).toBeDefined());
		controller.abort();
		await expect(pending).rejects.toThrow();
		release?.();
		await mc.close();
	});

	it("flags disconnection when the server transport dies", async () => {
		const { mc, serverTransport } = await createLinked();
		const onDisconnected = vi.fn();
		mc.onDisconnected = onDisconnected;
		await mc.connect();
		expect(mc.connected).toBe(true);
		await serverTransport.close();
		await vi.waitFor(() => expect(onDisconnected).toHaveBeenCalled());
		expect(mc.connected).toBe(false);
		expect(onDisconnected.mock.calls[0]?.[0]).toBeUndefined();
	});

	it("reports the transport error through onDisconnected when available", async () => {
		const { mc, clientTransport, serverTransport } = await createLinked();
		const onDisconnected = vi.fn();
		mc.onDisconnected = onDisconnected;
		await mc.connect();
		// Simulate a transport-level error (e.g. stdio crash detail) followed by close.
		clientTransport.onerror?.(new Error("process exited with code 1"));
		await serverTransport.close();
		await vi.waitFor(() => expect(onDisconnected).toHaveBeenCalled());
		expect(onDisconnected.mock.calls[0]?.[0]?.message).toBe("process exited with code 1");
	});

	it("does not report disconnection for a deliberate close()", async () => {
		const { mc } = await createLinked();
		const onDisconnected = vi.fn();
		mc.onDisconnected = onDisconnected;
		await mc.connect();
		await mc.close();
		expect(mc.connected).toBe(false);
		expect(onDisconnected).not.toHaveBeenCalled();
	});

	it("shares a single handshake across concurrent connect() calls", async () => {
		const { mc, injected } = await createLinked();
		const connectSpy = vi.spyOn(injected, "connect");
		await Promise.all([mc.connect(), mc.connect(), mc.connect()]);
		expect(connectSpy).toHaveBeenCalledTimes(1);
		expect(mc.connected).toBe(true);
		await mc.close();
	});

	it("rejects connect() when the transport is dead and stays disconnected", async () => {
		const { mc, serverTransport } = await createLinked();
		await serverTransport.close();
		await expect(mc.connect()).rejects.toThrow();
		expect(mc.connected).toBe(false);
	});

	it("rejects listTools/callTool before connect", async () => {
		const { mc } = await createLinked();
		await expect(mc.listTools()).rejects.toThrow("not connected");
		await expect(mc.callTool("x", {})).rejects.toThrow("not connected");
	});

	it("notifies onToolsChanged when the server sends tools/list_changed", async () => {
		const { mc, server } = await createLinked();
		const onToolsChanged = vi.fn();
		mc.onToolsChanged = onToolsChanged;
		await mc.connect();
		await server.notification({ method: "notifications/tools/list_changed", params: {} });
		await vi.waitFor(() => expect(onToolsChanged).toHaveBeenCalled());
		await mc.close();
	});
});

describe("formatMcpResult", () => {
	it("joins text blocks and placeholders for non-text blocks", () => {
		expect(
			formatMcpResult({
				content: [
					{ type: "text", text: "line1" },
					{ type: "image", data: "…", mimeType: "image/png" },
					{ type: "text", text: "line2" },
				],
			}),
		).toBe("line1\n[image: image/png]\nline2");
	});

	it("falls back to structuredContent when there are no content blocks", () => {
		expect(formatMcpResult({ content: [], structuredContent: { total: 42 } })).toBe('{\n  "total": 42\n}');
	});

	it("extracts embedded text resources", () => {
		expect(
			formatMcpResult({
				content: [{ type: "resource", resource: { uri: "file:///a.txt", text: "contents" } }],
			}),
		).toBe("contents");
	});

	it("returns empty string for empty content", () => {
		expect(formatMcpResult({ content: [] })).toBe("");
	});
});

describe("tool mapping", () => {
	it("keeps schema and description from the server tool", async () => {
		const { mc, server } = await createLinked();
		server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
				{
					name: "grep",
					description: "Search files",
					inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
				},
			],
		}));
		await mc.connect();
		const tools: McpDiscoveredTool[] = await mc.listTools();
		expect(tools[0]).toEqual({
			serverName: "test",
			name: "grep",
			description: "Search files",
			inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
		});
		await mc.close();
	});
});

describe("firstClassToolName", () => {
	it("builds mcp__server__tool names", () => {
		expect(firstClassToolName("chrome-devtools", "navigate_page")).toBe("mcp__chrome-devtools__navigate_page");
	});

	it("sanitizes characters providers reject", () => {
		expect(firstClassToolName("my server", "tool.variant")).toBe("mcp__my_server__tool_variant");
		expect(firstClassToolName("srv", "")).toBe("mcp__srv__tool");
	});

	it("caps the composite name at 128 chars", () => {
		const name = firstClassToolName("s", "x".repeat(200));
		expect(name.length).toBe(128);
		expect(name.startsWith("mcp__s__")).toBe(true);
	});

	it("cap constant keeps aggregator servers on the stub path", () => {
		expect(MAX_FIRST_CLASS_TOOLS).toBeGreaterThan(0);
	});
});

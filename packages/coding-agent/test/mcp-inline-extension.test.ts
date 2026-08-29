import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext, ToolDefinition } from "../src/core/extensions/types.ts";
import { McpClient } from "../src/core/mcp/client.ts";
import { createMcpExtensionFactory, MAX_FIRST_CLASS_TOOLS } from "../src/core/mcp/inline-extension.ts";
import type { McpServerConfig } from "../src/core/mcp/types.ts";

const serverConfig: McpServerConfig = { name: "testsrv", transport: "stdio", commandOrUrl: "unused" };

/** Every fixture tool requires a `q` string so the empty-arguments fail-fast triggers. */
function makeMcpTool(name: string): { name: string; description: string; inputSchema: Record<string, unknown> } {
	return {
		name,
		description: `desc ${name}`,
		inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
	};
}

interface FactoryFixture {
	registered: Map<string, ToolDefinition>;
	toolCalls: string[];
	clientTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[0];
}

/**
 * Build an in-memory MCP server exposing `toolCount` tools plus a factory
 * bound to it via the createClient test seam. Discovery runs in the
 * background; wait on `registered` in each test.
 */
async function setupFactory(toolCount: number): Promise<FactoryFixture> {
	const injected = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const server = new Server({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });
	const toolCalls: string[] = [];
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: Array.from({ length: toolCount }, (_, i) => makeMcpTool(`t${i + 1}`)),
	}));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		toolCalls.push(request.params.name);
		return { content: [{ type: "text", text: `ran ${request.params.name}` }] };
	});
	await server.connect(serverTransport);

	const mc = new McpClient(serverConfig, { client: injected, transport: clientTransport });
	const registered = new Map<string, ToolDefinition>();
	const pi = {
		registerTool: (tool: ToolDefinition): void => {
			registered.set(tool.name, tool);
		},
		on: () => {},
	};
	const factory = createMcpExtensionFactory({
		servers: [serverConfig],
		createClient: () => mc,
	});
	await factory(pi as unknown as Parameters<typeof factory>[0]);
	return { registered, toolCalls, clientTransport };
}

const emptyCtx = {} as ExtensionContext;

function callStub(stub: ToolDefinition, params: unknown): Promise<unknown> {
	return stub.execute("id", params as never, undefined, undefined, emptyCtx);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("MCP extension registration", () => {
	it("registers only first-class tools (no stub) for a server within the tool budget", async () => {
		const { registered } = await setupFactory(2);
		await vi.waitFor(() => expect(registered.size).toBe(2));
		expect(registered.has("mcp__testsrv__t1")).toBe(true);
		expect(registered.has("mcp__testsrv__t2")).toBe(true);
		expect(registered.has("mcp_testsrv")).toBe(false);
	});

	it("registers only the gateway stub for a server above the tool budget", async () => {
		const { registered } = await setupFactory(MAX_FIRST_CLASS_TOOLS + 1);
		await vi.waitFor(() => expect(registered.has("mcp_testsrv")).toBe(true));
		expect(registered.size).toBe(1);
		expect([...registered.keys()][0]).toBe("mcp_testsrv");
	});
});

describe("gateway stub", () => {
	async function setupStub(): Promise<FactoryFixture & { stub: ToolDefinition }> {
		const fixture = await setupFactory(MAX_FIRST_CLASS_TOOLS + 1);
		await vi.waitFor(() => expect(fixture.registered.has("mcp_testsrv")).toBe(true));
		return { ...fixture, stub: fixture.registered.get("mcp_testsrv") as ToolDefinition };
	}

	it("executes the server tool when arguments match its schema", async () => {
		const { stub, toolCalls } = await setupStub();
		const result = (await callStub(stub, { tool: "t2", arguments: { q: "x" } })) as {
			content: { type: string; text: string }[];
		};
		expect(result.content).toEqual([{ type: "text", text: "ran t2" }]);
		expect(toolCalls).toEqual(["t2"]);
	});

	it("fails fast with the input schema when arguments are omitted", async () => {
		const { stub, toolCalls } = await setupStub();
		await expect(callStub(stub, { tool: "t1" })).rejects.toThrow(/Required properties: q[\s\S]*"required"[\s\S]*"q"/);
		expect(toolCalls).toHaveLength(0);
	});

	it("fails fast with the input schema when arguments are empty", async () => {
		const { stub, toolCalls } = await setupStub();
		await expect(callStub(stub, { tool: "t1", arguments: {} })).rejects.toThrow(
			/requires arguments but none were provided/,
		);
		expect(toolCalls).toHaveLength(0);
	});

	it("lists available tool names when called with an unknown tool", async () => {
		const { stub } = await setupStub();
		const result = (await callStub(stub, { tool: "nope" })) as { content: { type: string; text: string }[] };
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		expect(text).toContain('Tool "nope" not found');
		expect(text).toContain("Available: t1");
	});
});

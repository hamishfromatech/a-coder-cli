import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "../../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";

/**
 * Regression for the Composio wiring bug: `tools` is a hard allow-list over
 * every registered tool (built-ins, MCP, extensions). Passing custom helper
 * tools (e.g. the Composio session tools) with no explicit --tools list must
 * NOT set `tools` — doing so disabled every built-in and MCP tool. Without an
 * explicit list, custom tools register and auto-enable alongside the defaults.
 */
describe("custom tools + tools allow-list interaction", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-custom-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function helperTool(): ToolDefinition<any, unknown> {
		return {
			name: "helper_tool",
			label: "Helper Tool",
			description: "Custom helper tool (Composio-style)",
			promptSnippet: "Run helper behavior",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
		};
	}

	async function createSession(options?: { tools?: string[] }) {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.inMemory(tempDir);
		const resourceLoader = new DefaultResourceLoader({ cwd: tempDir, agentDir, settingsManager });
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			resourceLoader,
			customTools: [helperTool()],
			tools: options?.tools,
		});
		await session.bindExtensions({});
		return session;
	}

	it("keeps built-ins active when custom tools are added without an explicit tools list", async () => {
		const session = await createSession();

		const allNames = session.getAllTools().map((tool) => tool.name);
		expect(allNames).toContain("helper_tool");
		expect(allNames).toContain("read");
		expect(allNames).toContain("bash");

		const active = session.getActiveToolNames();
		expect(active).toContain("helper_tool");
		expect(active).toContain("read");
		expect(active).toContain("bash");
		expect(session.systemPrompt).toContain("- helper_tool: Run helper behavior");
		expect(session.systemPrompt).toContain("- bash:");
		session.dispose();
	});

	it("extends an explicit tools list with the custom tool names", async () => {
		const session = await createSession({ tools: ["read", "helper_tool"] });

		expect(
			session
				.getAllTools()
				.map((tool) => tool.name)
				.sort(),
		).toEqual(["helper_tool", "read"]);
		expect(session.getActiveToolNames().sort()).toEqual(["helper_tool", "read"]);
		session.dispose();
	});
});

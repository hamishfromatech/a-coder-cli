import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createMemoryTool, createMemoryToolDefinition } from "../src/core/tools/memory.ts";

describe("memory tool", () => {
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = mkdtempSync(join(tmpdir(), "memory-workspace-"));
	});

	afterEach(() => {
		try {
			rmSync(sessionDir, { recursive: true, force: true });
		} catch {}
	});

	it("writes and reads workspace memory", async () => {
		const tool = createMemoryTool({ sessionDir, sessionId: "session-1" });
		await tool.execute("1", { action: "write", scope: "workspace", content: "workspace note" });
		const result = await tool.execute("2", { action: "read", scope: "workspace" });
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("workspace note");
	});

	it("writes and reads session memory", async () => {
		const tool = createMemoryTool({ sessionDir, sessionId: "session-1" });
		await tool.execute("1", { action: "append", scope: "session", content: "session note" });
		const result = await tool.execute("2", { action: "read", scope: "session" });
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("session note");
	});

	it("separates session and workspace memory", async () => {
		const tool = createMemoryTool({ sessionDir, sessionId: "session-a" });
		await tool.execute("1", { action: "write", scope: "workspace", content: "workspace note" });
		await tool.execute("2", { action: "write", scope: "session", content: "session note" });

		const ws = await tool.execute("3", { action: "read", scope: "workspace" });
		const wsText = ws.content.find((c) => c.type === "text")?.text ?? "";
		expect(wsText).toContain("workspace note");
		expect(wsText).not.toContain("session note");

		const sess = await tool.execute("4", { action: "read", scope: "session" });
		const sessText = sess.content.find((c) => c.type === "text")?.text ?? "";
		expect(sessText).toContain("session note");
		expect(sessText).not.toContain("workspace note");
	});

	it("definition with context resolves workspace memory without a runtime context", async () => {
		// AgentSession builds memory as a bare ToolDefinition via createAllToolDefinitions,
		// and the agent loop invokes execute with no 5th context argument.
		const definition = createMemoryToolDefinition({ sessionDir, sessionId: "session-1" });
		await definition.execute(
			"1",
			{ action: "write", scope: "workspace", content: "definition note" },
			undefined,
			undefined,
			undefined as unknown as ExtensionContext,
		);
		const result = await definition.execute(
			"2",
			{ action: "read", scope: "workspace" },
			undefined,
			undefined,
			undefined as unknown as ExtensionContext,
		);
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("definition note");
	});

	it("bare definition still throws for workspace scope without any context", async () => {
		const definition = createMemoryToolDefinition();
		await expect(
			definition.execute(
				"1",
				{ action: "read", scope: "workspace" },
				undefined,
				undefined,
				undefined as unknown as ExtensionContext,
			),
		).rejects.toThrow("memory workspace scope requires a session directory");
	});

	it("persists different session memories under the same workspace", async () => {
		const toolA = createMemoryTool({ sessionDir, sessionId: "session-a" });
		const toolB = createMemoryTool({ sessionDir, sessionId: "session-b" });
		await toolA.execute("1", { action: "write", scope: "session", content: "note for session a" });
		await toolB.execute("2", { action: "write", scope: "session", content: "note for session b" });

		const a = await toolA.execute("3", { action: "read", scope: "session" });
		const aText = a.content.find((c) => c.type === "text")?.text ?? "";
		expect(aText).toContain("note for session a");
		expect(aText).not.toContain("note for session b");

		const b = await toolB.execute("4", { action: "read", scope: "session" });
		const bText = b.content.find((c) => c.type === "text")?.text ?? "";
		expect(bText).toContain("note for session b");
		expect(bText).not.toContain("note for session a");
	});
});

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentContext, BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("AgentSession permission mode", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-permission-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function createSessionWithMode(mode: "ask" | "allow" | "read-only" | "auto") {
		const settingsManager = SettingsManager.inMemory({ permissionMode: mode });
		const sessionManager = SessionManager.inMemory();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
		});
		return { session, settingsManager };
	}

	function makeToolCall(name: string, id = "tc-1"): BeforeToolCallContext {
		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		};
		const context: AgentContext = { systemPrompt: "", messages: [] };
		return { assistantMessage, toolCall: { type: "toolCall", name, id, arguments: {} }, args: {}, context };
	}

	it("allows all tools in allow mode", async () => {
		const { session } = await createSessionWithMode("allow");
		const result = await session.agent.beforeToolCall?.(makeToolCall("bash"));
		expect(result).toBeUndefined();
		session.dispose();
	});

	it("denies mutating tools in read-only mode", async () => {
		const { session } = await createSessionWithMode("read-only");
		for (const tool of ["bash", "edit", "write"]) {
			const result = await session.agent.beforeToolCall?.(makeToolCall(tool));
			expect(result).toEqual({
				block: true,
				reason: `Tool "${tool}" is blocked in read-only mode`,
			});
		}
		const readResult = await session.agent.beforeToolCall?.(makeToolCall("read"));
		expect(readResult).toBeUndefined();
		session.dispose();
	});

	it("allows in ask mode when no prompt handler is registered", async () => {
		const { session } = await createSessionWithMode("ask");
		const result = await session.agent.beforeToolCall?.(makeToolCall("read"));
		// Without a prompt handler the session cannot actually ask, so it falls
		// back to allowing the call rather than blocking every tool use.
		expect(result).toBeUndefined();
		session.dispose();
	});

	it("allows in ask mode when the handler returns true", async () => {
		const { session } = await createSessionWithMode("ask");
		const handler = vi.fn(async () => true);
		session.setPermissionPromptHandler(handler);
		const result = await session.agent.beforeToolCall?.(makeToolCall("read"));
		expect(result).toBeUndefined();
		expect(handler).toHaveBeenCalledWith("read", 'Permission mode is "ask"', {});
		session.dispose();
	});

	it("allows the plan_mode tool regardless of permission mode", async () => {
		const { session } = await createSessionWithMode("read-only");
		const result = await session.agent.beforeToolCall?.(makeToolCall("plan_mode"));
		expect(result).toBeUndefined();
		session.dispose();
	});

	it("prompts for mutating tools in allow mode when plan mode is active", async () => {
		const { session } = await createSessionWithMode("allow");
		const handler = vi.fn(async () => false);
		session.setPermissionPromptHandler(handler);

		// Enter plan mode (the plan_mode tool itself is exempt from prompts).
		session.setPlanMode(true);

		const bashResult = await session.agent.beforeToolCall?.(makeToolCall("bash"));
		expect(bashResult).toEqual({
			block: true,
			reason: "Plan mode is active: approval required before making changes",
		});
		expect(handler).toHaveBeenCalledWith("bash", "Plan mode is active: approval required before making changes", {});

		const editResult = await session.agent.beforeToolCall?.(makeToolCall("edit"));
		expect(editResult).toEqual({
			block: true,
			reason: "Plan mode is active: approval required before making changes",
		});

		// Read-only tools remain auto-approved in plan mode.
		const readResult = await session.agent.beforeToolCall?.(makeToolCall("read"));
		expect(readResult).toBeUndefined();

		// The plan_mode tool can still be used to exit plan mode.
		const planResult = await session.agent.beforeToolCall?.(makeToolCall("plan_mode"));
		expect(planResult).toBeUndefined();

		session.dispose();
	});

	it("approves mutating tools in plan mode when the prompt handler returns true", async () => {
		const { session } = await createSessionWithMode("allow");
		const handler = vi.fn(async () => true);
		session.setPermissionPromptHandler(handler);
		session.setPlanMode(true);

		const result = await session.agent.beforeToolCall?.(makeToolCall("write"));
		expect(result).toBeUndefined();
		expect(handler).toHaveBeenCalledWith("write", "Plan mode is active: approval required before making changes", {});
		session.dispose();
	});

	it("exits plan mode through setPlanMode", async () => {
		const { session } = await createSessionWithMode("allow");
		const handler = vi.fn(async () => false);
		session.setPermissionPromptHandler(handler);
		session.setPlanMode(true);
		session.setPlanMode(false);

		const result = await session.agent.beforeToolCall?.(makeToolCall("bash"));
		expect(result).toBeUndefined();
		expect(handler).not.toHaveBeenCalled();
		session.dispose();
	});

	it("emits plan_mode_changed events", async () => {
		const { session } = await createSessionWithMode("allow");
		const events: boolean[] = [];
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "plan_mode_changed") {
				events.push(event.enabled);
			}
		});
		session.setPlanMode(true);
		session.setPlanMode(true); // no-op, should not emit
		session.setPlanMode(false);
		unsubscribe();
		expect(events).toEqual([true, false]);
		session.dispose();
	});

	it("prompts and denies in ask mode when the handler returns false", async () => {
		const { session } = await createSessionWithMode("ask");
		const handler = vi.fn(async () => false);
		session.setPermissionPromptHandler(handler);
		const result = await session.agent.beforeToolCall?.(makeToolCall("read"));
		expect(result).toEqual({
			block: true,
			reason: 'Permission mode is "ask"',
		});
		session.dispose();
	});

	it("uses default auto policy to prompt for mutating tools", async () => {
		const { session } = await createSessionWithMode("auto");
		const handler = vi.fn(async () => true);
		session.setPermissionPromptHandler(handler);
		for (const tool of ["bash", "edit", "write"]) {
			const result = await session.agent.beforeToolCall?.(makeToolCall(tool));
			expect(result).toBeUndefined();
		}
		expect(handler).toHaveBeenCalledTimes(3);
		const readResult = await session.agent.beforeToolCall?.(makeToolCall("read"));
		expect(readResult).toBeUndefined();
		expect(handler).toHaveBeenCalledTimes(3);
		session.dispose();
	});

	it("applies hardDeny policies in auto mode", async () => {
		const settingsManager = SettingsManager.inMemory({
			permissionMode: "auto",
			permissionPolicies: { hardDeny: ["bash"] },
		});
		const sessionManager = SessionManager.inMemory();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
		});
		const result = await session.agent.beforeToolCall?.(makeToolCall("bash"));
		expect(result).toEqual({
			block: true,
			reason: 'Tool "bash" matches hard-deny policy',
		});
		session.dispose();
	});
});

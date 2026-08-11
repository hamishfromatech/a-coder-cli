import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

	function makeToolCall(name: string, id = "tc-1") {
		return { toolCall: { name, id, parameters: {} }, args: {} };
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

	it("prompts and approves in ask mode when the handler returns true", async () => {
		const { session } = await createSessionWithMode("ask");
		const handler = vi.fn(async () => true);
		session.setPermissionPromptHandler(handler);
		const result = await session.agent.beforeToolCall?.(makeToolCall("read"));
		expect(result).toBeUndefined();
		expect(handler).toHaveBeenCalledWith("read", 'Permission mode is "ask"');
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

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

vi.mock("../src/core/permission-classifier.ts", () => ({
	classifyToolCall: vi.fn(),
}));

import { classifyToolCall } from "../src/core/permission-classifier.ts";

const mockClassify = vi.mocked(classifyToolCall);

describe("auto-mode classifier integration", () => {
	let agentDir: string;
	let tempDir: string;

	beforeEach(() => {
		vi.mocked(classifyToolCall).mockReset();
		tempDir = mkdtempSync(join(tmpdir(), "pi-classifier-test-"));
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// Mirrors the BeforeToolCallContext shape the permission-mode tests build.
	function makeToolCall(name: string, args: Record<string, unknown>): BeforeToolCallContext {
		const assistantMessage = {
			role: "assistant" as const,
			content: [] as never[],
			api: "anthropic" as const,
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
			stopReason: "toolUse" as const,
			timestamp: Date.now(),
		};
		return {
			assistantMessage,
			toolCall: { type: "toolCall" as const, name, id: "tc-1", arguments: args },
			args,
			context: { systemPrompt: "", messages: [] },
		} as unknown as BeforeToolCallContext;
	}

	async function createSessionWith(autoModeSettings?: {
		enabled?: boolean;
		maxConsecutiveFailures?: number;
		maxConsecutiveBlocks?: number;
	}) {
		const settingsManager = SettingsManager.inMemory({
			permissionMode: "auto",
			permissionPolicies: { softDeny: [], allow: [], hardDeny: [] },
			autoMode: autoModeSettings ?? { enabled: true },
		});
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

	it("prompts (instead of silently denying) when the classifier blocks, with the classifier call", async () => {
		mockClassify.mockResolvedValue({
			ok: true,
			verdict: { thinking: "rm -rf", shouldBlock: true, reason: "destructive" },
		});
		const { session } = await createSessionWith({ enabled: true });
		const handler = vi.fn(async (_toolName: string, _reason?: string) => false);
		session.setPermissionPromptHandler(handler);
		const result = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "rm -rf /tmp/x" }));
		expect(mockClassify).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(String(handler.mock.calls[0]?.[1] ?? "")).toContain("Auto-mode classifier: destructive");
		expect(result).toEqual({
			block: true,
			reason: "Auto-mode classifier: destructive",
		});
		session.dispose();
	});

	it("does not classify safe tools", async () => {
		const { session } = await createSessionWith({ enabled: true });
		await session.agent.beforeToolCall?.(makeToolCall("read", { path: "a.ts" }));
		expect(mockClassify).not.toHaveBeenCalled();
		session.dispose();
	});

	it("falls back to static decision when the classifier fails, and circuit-breaks", async () => {
		mockClassify.mockResolvedValue({ ok: false, error: "boom" });
		const { session } = await createSessionWith({ enabled: true, maxConsecutiveFailures: 2 });
		// Non-interactive session: no prompt handler → degrades to static default-allow.
		const first = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "ls" }));
		expect(first).toBeUndefined();
		expect(mockClassify).toHaveBeenCalledTimes(1);
		// Second failure reaches maxConsecutiveFailures → classifier disabled.
		const second = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "ls" }));
		expect(second).toBeUndefined();
		expect(mockClassify).toHaveBeenCalledTimes(2);
		// Third call skips the classifier entirely.
		await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "ls" }));
		expect(mockClassify).toHaveBeenCalledTimes(2);
		session.dispose();
	});

	it("circuit-breaks after repeated blocks", async () => {
		mockClassify.mockResolvedValue({
			ok: true,
			verdict: { thinking: "", shouldBlock: true, reason: "nope" },
		});
		const { session } = await createSessionWith({ enabled: true, maxConsecutiveBlocks: 2 });
		const handler = vi.fn(async (_toolName: string, _reason?: string) => true);
		session.setPermissionPromptHandler(handler);
		await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "x1" }));
		await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "x2" }));
		// Third call: breaker open, classifier not consulted, call allowed.
		const third = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "x3" }));
		expect(mockClassify).toHaveBeenCalledTimes(2);
		expect(third).toBeUndefined();
		session.dispose();
	});
});

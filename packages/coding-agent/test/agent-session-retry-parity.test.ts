import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AgentSession,
	hasVisibleStreamedOutput,
	isOverloadedAssistantError,
	MAX_CONSECUTIVE_529_RETRIES,
} from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string, overrides?: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

/** Minimal AgentSession wired against a mock streamFn, retry enabled. */
function createSession(
	streamResponses: Array<{ errorMessage?: string; retryAfterMs?: number; text?: string; streamedContent?: boolean }>,
	options?: { maxRetries?: number; maxDelayMs?: number },
): { session: AgentSession; calls: () => number } {
	let calls = 0;
	const model = getModel("anthropic", "claude-sonnet-4-5")!;
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: { model, systemPrompt: "Test", tools: [] },
		streamFn: () => {
			calls++;
			const stream = new MockAssistantStream();
			const step = streamResponses[Math.min(calls, streamResponses.length) - 1] ?? {};
			queueMicrotask(() => {
				if (step.streamedContent) {
					// Mid-stream failure with visible output (the replay-guard case).
					const msg = createAssistantMessage("", {
						stopReason: "error",
						errorMessage: step.errorMessage ?? "Connection reset",
						content: [{ type: "text", text: "Partial answer the user already saw" }],
					});
					stream.push({ type: "start", partial: msg });
					stream.push({ type: "error", reason: "error", error: msg });
					return;
				}
				const msg = createAssistantMessage(step.text ?? "", {
					stopReason: step.errorMessage !== undefined ? "error" : "stop",
					errorMessage: step.errorMessage,
					retryAfterMs: step.retryAfterMs,
				});
				stream.push({ type: "start", partial: msg });
				if (msg.stopReason === "error") {
					stream.push({ type: "error", reason: "error", error: msg });
				} else {
					stream.push({ type: "done", reason: "stop", message: msg });
				}
			});
			return stream;
		},
	});

	const tempDir = join(tmpdir(), `pi-retry-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	const sessionManager = SessionManager.inMemory();
	const settingsManager = SettingsManager.create(tempDir, tempDir);
	settingsManager.applyOverrides({
		retry: {
			enabled: true,
			maxRetries: options?.maxRetries ?? 10,
			baseDelayMs: 1,
			maxDelayMs: options?.maxDelayMs,
		},
	});
	const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage, tempDir);
	authStorage.setRuntimeApiKey("anthropic", "test-key");

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: tempDir,
		modelRegistry,
		resourceLoader: createTestResourceLoader(),
	});
	return {
		session,
		calls: () => calls,
	};
}

describe("easy-agent stage-27 retry parity (529 split, replay guard, Retry-After)", () => {
	const created: AgentSession[] = [];
	let cleanupDirs: string[] = [];

	beforeEach(() => {
		cleanupDirs = [];
	});

	afterEach(() => {
		while (created.length > 0) {
			created.pop()?.dispose();
		}
		for (const dir of cleanupDirs) {
			if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
		}
	});

	it("hasVisibleStreamedOutput detects text/thinking/toolCall output", () => {
		expect(hasVisibleStreamedOutput(createAssistantMessage("hello"))).toBe(true);
		expect(
			hasVisibleStreamedOutput({
				...createAssistantMessage(""),
				content: [{ type: "thinking", thinking: "reasoning", thinkingSignature: "sig" }],
			} as AssistantMessage),
		).toBe(true);
		expect(
			hasVisibleStreamedOutput({
				...createAssistantMessage(""),
				content: [{ type: "toolCall", id: "t1", name: "read", arguments: {} }],
			} as AssistantMessage),
		).toBe(true);
		expect(hasVisibleStreamedOutput(createAssistantMessage(""))).toBe(false);
		expect(
			hasVisibleStreamedOutput(
				createAssistantMessage("", {
					content: [{ type: "text", text: "   " }],
				}),
			),
		).toBe(false);
	});

	it("isOverloadedAssistantError matches 529/overloaded errors only", () => {
		expect(
			isOverloadedAssistantError({
				...createAssistantMessage(""),
				stopReason: "error",
				errorMessage: "529 overloaded_error",
			}),
		).toBe(true);
		expect(
			isOverloadedAssistantError({
				...createAssistantMessage(""),
				stopReason: "error",
				errorMessage: "429 rate limit exceeded",
			}),
		).toBe(false);
		expect(
			isOverloadedAssistantError({
				...createAssistantMessage(""),
				stopReason: "error",
				errorMessage: "Connection reset",
			}),
		).toBe(false);
		expect(isOverloadedAssistantError(createAssistantMessage("fine"))).toBe(false);
	});

	it("refuses to auto-retry a turn that streamed visible output", async () => {
		const { session, calls } = createSession([{ errorMessage: "529 overloaded_error", streamedContent: true }]);
		created.push(session);
		const events: string[] = [];
		session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push("start");
		});

		await session.prompt("Test");

		expect(calls()).toBe(1); // no replay
		expect(events).toEqual([]);
	});

	it("caps consecutive 529 retries at MAX_CONSECUTIVE_529_RETRIES", async () => {
		const { session, calls } = createSession([1, 2, 3, 4].map(() => ({ errorMessage: "529 overloaded_error" })));
		created.push(session);
		const starts: number[] = [];
		session.subscribe((event) => {
			if (event.type === "auto_retry_start") starts.push(event.attempt);
		});

		await session.prompt("Test");

		expect(starts.length).toBe(MAX_CONSECUTIVE_529_RETRIES);
		// Initial call + MAX_CONSECUTIVE_529_RETRIES retries; the (cap+1)-th attempt bails out.
		expect(calls()).toBe(MAX_CONSECUTIVE_529_RETRIES + 1);
	});

	it("resets the consecutive 529 counter after a non-overload retry", async () => {
		const { session, calls } = createSession([
			{ errorMessage: "529 overloaded_error" },
			{ errorMessage: "529 overloaded_error" },
			{ errorMessage: "HTTP 503 service unavailable" }, // non-overload retryable: resets the counter
			{ errorMessage: "529 overloaded_error" },
			{ errorMessage: "529 overloaded_error" },
			{ errorMessage: "529 overloaded_error" },
			{ errorMessage: "529 overloaded_error" },
			{ text: "Success" },
		]);
		created.push(session);

		await session.prompt("Test");

		// 1st-2nd fail (overload x2) -> 3rd fails (reset) -> 4th-6th overload again
		// (counter 1,2 then third consecutive -> cap) -> surfaces the 7th error.
		expect(calls()).toBe(7);
	});

	it("honors provider Retry-After over the backoff schedule", async () => {
		const { session } = createSession([{ errorMessage: "429 rate limit", retryAfterMs: 4321 }, { text: "ok" }]);
		created.push(session);
		const delays: number[] = [];
		session.subscribe((event) => {
			if (event.type === "auto_retry_start") delays.push(event.delayMs);
		});

		await session.prompt("Test");

		expect(delays).toEqual([4321]);
	});

	it("caps an excessive provider Retry-After at the retry-delay ceiling", async () => {
		const { session } = createSession(
			[{ errorMessage: "429 rate limit", retryAfterMs: 10 * 60_000 }, { text: "ok" }],
			{ maxDelayMs: 50 },
		);
		created.push(session);
		const delays: number[] = [];
		session.subscribe((event) => {
			if (event.type === "auto_retry_start") delays.push(event.delayMs);
		});

		await session.prompt("Test");

		expect(delays.length).toBe(1);
		expect(delays[0]).toBeLessThanOrEqual(60_000);
		expect(delays[0]).toBeGreaterThanOrEqual(0);
	});
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import {
	aggregateModelUsage,
	captureCliSessionEnd,
	captureCliSessionStart,
	resolveAnalyticsSettings,
} from "../src/core/analytics.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const ORIGINAL_ENV = {
	A_CODER_CLI_ANALYTICS: process.env.A_CODER_CLI_ANALYTICS,
	A_CODER_CLI_OFFLINE: process.env.A_CODER_CLI_OFFLINE,
	A_CODER_CLI_POSTHOG_KEY: process.env.A_CODER_CLI_POSTHOG_KEY,
	[ENV_AGENT_DIR]: process.env[ENV_AGENT_DIR],
};

beforeEach(() => {
	// Force-disable the client so tests never send events to the baked-in
	// production ingest key.
	process.env.A_CODER_CLI_POSTHOG_KEY = "";
});

afterEach(() => {
	delete process.env.A_CODER_CLI_ANALYTICS;
	delete process.env.A_CODER_CLI_OFFLINE;
	delete process.env.A_CODER_CLI_POSTHOG_KEY;
	for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
		if (value !== undefined) {
			process.env[key] = value;
		} else {
			delete process.env[key];
		}
	}
});

describe("resolveAnalyticsSettings", () => {
	it("is disabled by default (opt-in)", () => {
		const manager = SettingsManager.inMemory();
		expect(resolveAnalyticsSettings(manager)).toEqual({ enabled: false, distinctId: undefined });
	});

	it("is enabled when the user opted in and a tracking id exists", () => {
		const manager = SettingsManager.inMemory();
		manager.setEnableAnalytics(true);
		const { enabled, distinctId } = resolveAnalyticsSettings(manager);
		expect(enabled).toBe(true);
		expect(distinctId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("is disabled when opted in without a tracking id", () => {
		const manager = SettingsManager.inMemory({ enableAnalytics: true });
		expect(resolveAnalyticsSettings(manager).enabled).toBe(false);
	});

	it("is disabled in offline mode even when opted in", () => {
		const manager = SettingsManager.inMemory();
		manager.setEnableAnalytics(true);
		process.env.A_CODER_CLI_OFFLINE = "1";
		expect(resolveAnalyticsSettings(manager).enabled).toBe(false);
	});

	it("A_CODER_CLI_ANALYTICS=0 force-disables even when opted in", () => {
		const manager = SettingsManager.inMemory();
		manager.setEnableAnalytics(true);
		process.env.A_CODER_CLI_ANALYTICS = "0";
		expect(resolveAnalyticsSettings(manager).enabled).toBe(false);
	});

	it("A_CODER_CLI_ANALYTICS=1 force-enables without opt-in but still needs a tracking id", () => {
		process.env.A_CODER_CLI_ANALYTICS = "1";
		const manager = SettingsManager.inMemory();
		expect(resolveAnalyticsSettings(manager).enabled).toBe(false);

		const optedIn = SettingsManager.inMemory();
		optedIn.setEnableAnalytics(true);
		optedIn.setEnableAnalytics(false);
		// Toggling keeps the generated tracking id, so force-enable works.
		expect(resolveAnalyticsSettings(optedIn).enabled).toBe(true);
	});
});

describe("captureCliSessionStart/End", () => {
	const baseStats = () => ({
		sessionFile: "/tmp/session.jsonl",
		sessionId: "test",
		userMessages: 1,
		assistantMessages: 3,
		toolCalls: 2,
		toolResults: 2,
		totalMessages: 6,
		tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
		cost: 0.5,
		contextUsage: 0 as const,
	});

	const sampleMessages = [
		{ role: "user", content: "ignored" },
		{
			role: "assistant",
			provider: "openrouter",
			model: "openrouter/auto",
			responseModel: "anthropic/claude-sonnet-4-5",
			usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: 0.01 } },
		},
		{
			role: "assistant",
			provider: "openrouter",
			model: "openrouter/auto",
			responseModel: "anthropic/claude-sonnet-4-5",
			usage: { input: 200, output: 25, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } },
		},
		{
			role: "assistant",
			provider: "ollama",
			model: "qwen3:8b",
			usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		},
		{ role: "toolResult", toolCallId: "t1" },
	];

	it("no-ops without throwing when analytics is disabled", async () => {
		const manager = SettingsManager.inMemory();
		const session = {
			messages: sampleMessages,
			getSessionStats: baseStats,
		};

		expect(() => captureCliSessionStart(session, "interactive", manager)).not.toThrow();
		await expect(captureCliSessionEnd(session, manager)).resolves.toBeUndefined();
		// A second end capture without a start is also a safe no-op.
		await expect(captureCliSessionEnd(session, manager)).resolves.toBeUndefined();
	});

	it("no-ops even when enabled while no PostHog key is configured", async () => {
		const manager = SettingsManager.inMemory();
		manager.setEnableAnalytics(true);
		const session = {
			messages: sampleMessages,
			getSessionStats: () => ({
				sessionFile: "/tmp/session.json",
				sessionId: "test",
				userMessages: 0,
				assistantMessages: 0,
				toolCalls: 0,
				toolResults: 0,
				totalMessages: 0,
				tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				cost: 0,
				contextUsage: 0 as const,
			}),
		};

		expect(() => captureCliSessionStart(session, "print", manager)).not.toThrow();
		await expect(captureCliSessionEnd(session, manager)).resolves.toBeUndefined();
	});

	it("aggregates model usage by provider and serving model", () => {
		const groups = aggregateModelUsage(sampleMessages);

		expect(groups).toHaveLength(2);
		const openrouter = groups.find((g) => g.provider === "openrouter");
		expect(openrouter).toEqual({
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4-5",
			requestedModel: "openrouter/auto",
			turns: 2,
			inputTokens: 300,
			outputTokens: 75,
			cacheReadTokens: 10,
			cacheWriteTokens: 5,
			costUsd: expect.closeTo(0.03, 10),
		});
		const ollama = groups.find((g) => g.provider === "ollama");
		expect(ollama).toEqual({
			provider: "ollama",
			model: "qwen3:8b",
			requestedModel: "qwen3:8b",
			turns: 1,
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costUsd: 0,
		});
	});

	it("ignores non-assistant messages and messages without usage", () => {
		const groups = aggregateModelUsage([
			{ role: "user" },
			{ role: "toolResult" },
			{ role: "assistant", provider: "openai", model: "gpt-5", usage: undefined },
			{ role: "assistant", model: "no-provider", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
		]);
		expect(groups).toEqual([]);
	});
});

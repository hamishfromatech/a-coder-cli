import { describe, expect, it } from "vitest";
import { anthropicContextTokens } from "../src/api/anthropic-usage.ts";
import { clampMaxTokensToContext } from "../src/api/simple-options.ts";
import type { AssistantMessage, Model } from "../src/types.ts";
import { estimateContextTokens } from "../src/utils/estimate.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const fallback = { input: 8, output: 500, cacheRead: 400_506, cacheWrite: 2_484 };

describe("anthropicContextTokens", () => {
	it("sums top-level fields when iterations are absent", () => {
		expect(
			anthropicContextTokens(
				{
					input_tokens: 8,
					output_tokens: 500,
					cache_read_input_tokens: 400_506,
					cache_creation_input_tokens: 2_484,
				},
				fallback,
			),
		).toBe(8 + 500 + 400_506 + 2_484);
	});

	// Regression for #12293: server-tool loops report billed sums at the top level.
	it("uses the last message iteration, not the billed top-level sums", () => {
		expect(
			anthropicContextTokens(
				{
					input_tokens: 8,
					output_tokens: 500,
					cache_read_input_tokens: 400_506,
					cache_creation_input_tokens: 2_484,
					iterations: [
						{
							type: "message",
							input_tokens: 4,
							output_tokens: 100,
							cache_read_input_tokens: 199_444,
							cache_creation_input_tokens: 0,
						},
						{
							type: "message",
							input_tokens: 4,
							output_tokens: 400,
							cache_read_input_tokens: 201_062,
							cache_creation_input_tokens: 2_484,
						},
					],
				},
				fallback,
			),
		).toBe(4 + 400 + 201_062 + 2_484);
	});

	it("skips a trailing compaction entry and advisor sub-inference", () => {
		expect(
			anthropicContextTokens(
				{
					input_tokens: fallback.input,
					output_tokens: fallback.output,
					cache_read_input_tokens: fallback.cacheRead,
					cache_creation_input_tokens: fallback.cacheWrite,
					iterations: [
						{
							type: "message",
							input_tokens: 4,
							output_tokens: 400,
							cache_read_input_tokens: 201_062,
							cache_creation_input_tokens: 2_484,
						},
						{
							type: "advisor_message",
							input_tokens: 10,
							output_tokens: 20,
							cache_read_input_tokens: 50,
							cache_creation_input_tokens: 0,
						},
						{
							type: "compaction",
							input_tokens: 80,
							output_tokens: 40,
							cache_read_input_tokens: 0,
							cache_creation_input_tokens: 0,
						},
					],
				},
				fallback,
			),
		).toBe(4 + 400 + 201_062 + 2_484);
	});

	it("treats a terminal fallback_message entry as the context-bearing iteration", () => {
		expect(
			anthropicContextTokens(
				{
					iterations: [
						{
							type: "message",
							input_tokens: 4,
							output_tokens: 10,
							cache_read_input_tokens: 100_000,
							cache_creation_input_tokens: 0,
						},
						{
							type: "fallback_message",
							input_tokens: 6,
							output_tokens: 20,
							cache_read_input_tokens: 90_000,
							cache_creation_input_tokens: 1_000,
						},
					],
				},
				fallback,
			),
		).toBe(6 + 20 + 90_000 + 1_000);
	});

	it("falls back to component sums when iterations have no message entry", () => {
		expect(
			anthropicContextTokens(
				{
					iterations: [
						{
							type: "compaction",
							input_tokens: 80,
							output_tokens: 40,
							cache_read_input_tokens: 0,
							cache_creation_input_tokens: 0,
						},
					],
				},
				fallback,
			),
		).toBe(fallback.input + fallback.output + fallback.cacheRead + fallback.cacheWrite);
	});
});

describe("estimate and clamp after an Anthropic server-tool usage reading (#12293)", () => {
	const model: Model<"anthropic-messages"> = {
		id: "claude-test",
		name: "Claude Test",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 400_000,
		maxTokens: 65_536,
	};

	function contextFromUsage(
		input: number,
		output: number,
		cacheRead: number,
		cacheWrite: number,
		totalTokens: number,
	) {
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-test",
			usage: {
				input,
				output,
				cacheRead,
				cacheWrite,
				totalTokens,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 2,
		};
		return normalizeContext({
			messages: [
				{ role: "user", content: "next", timestamp: 1 },
				assistant,
				{ role: "user", content: "next", timestamp: 3 },
			],
		});
	}

	it("no longer clamps to 1 once totalTokens comes from the last message iteration", () => {
		const summed = contextFromUsage(8, 500, 400_506, 2_484, 8 + 500 + 400_506 + 2_484);
		expect(estimateContextTokens(summed).usageTokens).toBe(8 + 500 + 400_506 + 2_484);
		expect(clampMaxTokensToContext(model, summed, 65_536)).toBe(1);

		const lastStepTokens = 4 + 400 + 201_062 + 2_484;
		const fixed = contextFromUsage(8, 500, 400_506, 2_484, lastStepTokens);
		expect(estimateContextTokens(fixed).usageTokens).toBe(lastStepTokens);
		expect(clampMaxTokensToContext(model, fixed, 65_536)).toBe(65_536);
	});
});

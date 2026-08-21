import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamSimple as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { Context, Model } from "../src/types.ts";

type FakeError = Error & { status: number; error: { message: string; type: string } };

const mockState = vi.hoisted(() => ({
	createCalls: [] as Array<{ params: Record<string, unknown>; options: unknown }>,
	// null = first request succeeds; otherwise the first `create` throws this.
	firstCreateError: null as FakeError | null,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create(params: Record<string, unknown>, options: unknown) {
					mockState.createCalls.push({ params, options });
					const buildPromise = () => {
						const stream = {
							async *[Symbol.asyncIterator]() {
								yield { id: "c", choices: [{ index: 0, delta: { content: "ok" } }] };
								yield { id: "c", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
							},
						};
						const promise = Promise.resolve(stream) as Promise<typeof stream> & {
							withResponse: () => Promise<{
								data: typeof stream;
								response: { status: number; headers: Headers };
							}>;
						};
						promise.withResponse = async () => ({
							data: stream,
							response: { status: 200, headers: new Headers() },
						});
						return promise;
					};
					if (mockState.firstCreateError) {
						const error = mockState.firstCreateError;
						mockState.firstCreateError = null;
						throw error;
					}
					return buildPromise();
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const model: Model<"openai-completions"> = {
	id: "deepseek-v4-flash",
	name: "Test",
	api: "openai-completions",
	provider: "ollama-cloud",
	baseUrl: "https://ollama.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000000,
	maxTokens: 131072,
};

const context: Context = {
	systemPrompt: "",
	messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
	tools: [],
};

const maxTokensError: FakeError = Object.assign(new Error("400 max_tokens exceeds model's maximum output tokens"), {
	status: 400,
	error: {
		message: "max_tokens (131072) exceeds model's maximum output tokens (65536)",
		type: "invalid_request_error",
	},
});

const unrelated400Error: FakeError = Object.assign(new Error("invalid_request_error"), {
	status: 400,
	error: { message: "invalid model id", type: "invalid_request_error" },
});

async function consume() {
	const stream = streamOpenAICompletions(model, context, { apiKey: "test" });
	for await (const _event of stream) {
		void _event;
	}
	return stream.result();
}

describe("openai-completions max_tokens cap retry", () => {
	beforeEach(() => {
		mockState.createCalls = [];
		mockState.firstCreateError = null;
	});

	it("retries without max_tokens when the provider rejects the cap with 400", async () => {
		mockState.firstCreateError = maxTokensError;
		const result = await consume();

		expect(mockState.createCalls).toHaveLength(2);
		const firstParams = mockState.createCalls[0]!.params;
		const retryParams = mockState.createCalls[1]!.params;
		expect("max_tokens" in firstParams || "max_completion_tokens" in firstParams).toBe(true);
		expect("max_tokens" in retryParams).toBe(false);
		expect("max_completion_tokens" in retryParams).toBe(false);
		expect(result.stopReason).toBe("stop");
		expect(result.errorMessage).toBeUndefined();
	});

	it("does not retry when the first request succeeds", async () => {
		mockState.firstCreateError = null;
		await consume();
		expect(mockState.createCalls).toHaveLength(1);
	});

	it("does not retry on a non-max_tokens 400 (surfaces the error)", async () => {
		mockState.firstCreateError = unrelated400Error;
		const result = await consume();

		expect(mockState.createCalls).toHaveLength(1);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("invalid model id");
	});
});

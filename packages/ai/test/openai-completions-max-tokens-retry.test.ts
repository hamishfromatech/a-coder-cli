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

// OpenRouter (Cloudflare backend) rejects prompt + max_tokens against its real
// context limit without naming the request field (2026-09-25, glm-5.3-flash:
// catalog maxTokens 943718 + 107115 input tokens > backend context 1048576).
const contextLengthCompletionBudgetError: FakeError = Object.assign(
	new Error(
		"Requested token count exceeds the model's maximum context length of 1048576 tokens. You requested a total of 1050833 tokens: 107115 tokens from the input messages and 943718 tokens for the completion. Please reduce the number of tokens in the input messages or the completion to fit within the limit.",
	),
	{
		status: 400,
		error: {
			message:
				"Requested token count exceeds the model's maximum context length of 1048576 tokens. You requested a total of 1050833 tokens: 107115 tokens from the input messages and 943718 tokens for the completion.",
			type: "BadRequestError",
		},
	},
);

// Classic OpenAI combined-limit shape ("N tokens in the completion").
const openAiContextLengthError: FakeError = Object.assign(
	new Error(
		"This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (1000 in the messages, 8000 in the completion). Please reduce the length of the messages or completion.",
	),
	{
		status: 400,
		error: {
			message:
				"This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (1000 in the messages, 8000 in the completion). Please reduce the length of the messages or completion.",
			type: "invalid_request_error",
		},
	},
);

// Prompt alone exceeds the limit with no completion budget involved: dropping
// max_tokens cannot help, so the error must surface.
const promptOnlyOverflowError: FakeError = Object.assign(
	new Error(
		"This model's maximum context length is 8192 tokens. However, you requested 9000 tokens in the messages. Please reduce the length of the messages.",
	),
	{
		status: 400,
		error: {
			message:
				"This model's maximum context length is 8192 tokens. However, you requested 9000 tokens in the messages. Please reduce the length of the messages.",
			type: "invalid_request_error",
		},
	},
);

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

	it("retries without max_tokens on a combined context-length rejection (OpenRouter/Cloudflare shape)", async () => {
		mockState.firstCreateError = contextLengthCompletionBudgetError;
		const result = await consume();

		expect(mockState.createCalls).toHaveLength(2);
		expect("max_tokens" in mockState.createCalls[1]!.params).toBe(false);
		expect("max_completion_tokens" in mockState.createCalls[1]!.params).toBe(false);
		expect(result.stopReason).toBe("stop");
		expect(result.errorMessage).toBeUndefined();
	});

	it("retries without max_tokens on the classic OpenAI 'in the completion' shape", async () => {
		mockState.firstCreateError = openAiContextLengthError;
		const result = await consume();

		expect(mockState.createCalls).toHaveLength(2);
		expect("max_tokens" in mockState.createCalls[1]!.params).toBe(false);
		expect(result.stopReason).toBe("stop");
	});

	it("does not retry when the prompt alone overflows the context (no completion budget)", async () => {
		mockState.firstCreateError = promptOnlyOverflowError;
		const result = await consume();

		expect(mockState.createCalls).toHaveLength(1);
		expect(result.stopReason).toBe("error");
	});
});

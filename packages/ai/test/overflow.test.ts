import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.ts";
import { isContextOverflow } from "../src/utils/overflow.ts";

function createErrorMessage(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "ollama",
		model: "qwen3.5:35b",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
}

describe("isContextOverflow", () => {
	it("detects explicit Ollama prompt-too-long errors", () => {
		const message = createErrorMessage("400 `prompt too long; exceeded max context length by 100918 tokens`");
		expect(isContextOverflow(message, 32768)).toBe(true);
	});

	it("detects Together AI context length errors", () => {
		const message = createErrorMessage(
			"400 The input (516368 tokens) is longer than the model's context length (262144 tokens).",
		);
		expect(isContextOverflow(message, 262144)).toBe(true);
	});

	it("detects LiteLLM-wrapped OpenAI maximum context length errors", () => {
		const message = createErrorMessage(
			"Error: 503 litellm.ServiceUnavailableError: litellm.MidStreamFallbackError: litellm.APIConnectionError: APIConnectionError: OpenAIException - Requested token count exceeds the model's maximum context length of 131072 tokens.",
		);
		expect(isContextOverflow(message, 131072)).toBe(true);
	});

	it("detects OpenAI-compatible parenthesized maximum context length errors", () => {
		const message = createErrorMessage(
			"Error: 400 Input length (265330) exceeds model's maximum context length (262144).",
		);
		expect(isContextOverflow(message, 262144)).toBe(true);
	});

	it("detects OpenRouter Poolside maximum allowed input length errors", () => {
		const message = createErrorMessage(
			"Provider returned error: Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
		);
		expect(isContextOverflow(message, 131072)).toBe(true);
	});

	it("detects DS4 configured context size errors", () => {
		const message = createErrorMessage(
			"400 Prompt has 256468 tokens, but the configured context size is 256000 tokens",
		);
		expect(isContextOverflow(message, 256000)).toBe(true);

		const commaMessage = createErrorMessage(
			"Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens",
		);
		expect(isContextOverflow(commaMessage, 256000)).toBe(true);
	});

	it("detects Anthropic request_too_large byte-size overflow (HTTP 413)", () => {
		const message = createErrorMessage(
			'413 {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
		);
		expect(isContextOverflow(message, 200000)).toBe(true);
	});

	it("detects OpenAI-compatible gateway 'Request Entity Too Large' 413 with body", () => {
		const message = createErrorMessage(
			'413: {"message":"Request Entity Too Large (ref: b687c7a6-3033-4b41-9c6c-fd7e2f21674b)","type":"api_error","param":null,"code":null}',
		);
		expect(isContextOverflow(message, 200000)).toBe(true);
	});

	it("detects prefixed gateway 413 errors (provider prefix before status)", () => {
		const message = createErrorMessage(
			'Provider returned error: 413: {"message":"Request Entity Too Large","type":"api_error"}',
		);
		expect(isContextOverflow(message, 200000)).toBe(true);
	});

	it("detects nginx-style 'Payload Too Large' 413 errors", () => {
		const message = createErrorMessage("413: <html><body>413 Payload Too Large</body></html>");
		expect(isContextOverflow(message, 200000)).toBe(true);
	});

	it("does not treat token counts containing 413 as status overflow", () => {
		// "4139" must not match the ^413[:\s] status-prefix pattern
		const message = createErrorMessage("Prompt has 4139 tokens, model limit is 4096");
		expect(isContextOverflow(message, 4096)).toBe(false);
	});

	it("does not treat generic non-overflow Ollama errors as overflow", () => {
		const message = createErrorMessage("500 `model runner crashed unexpectedly`");
		expect(isContextOverflow(message, 32768)).toBe(false);
	});

	it("does not treat Bedrock throttling 'Too many tokens' as overflow", () => {
		// Bedrock returns this for HTTP 429 rate limiting, NOT context overflow.
		// formatBedrockError uses a human-readable prefix for ThrottlingException.
		const message = createErrorMessage("Throttling error: Too many tokens, please wait before trying again.");
		expect(isContextOverflow(message, 200000)).toBe(false);
	});

	it("does not treat Bedrock service unavailable as overflow", () => {
		const message = createErrorMessage("Service unavailable: The service is temporarily unavailable.");
		expect(isContextOverflow(message, 200000)).toBe(false);
	});

	it("does not treat generic rate limit errors as overflow", () => {
		const message = createErrorMessage("Rate limit exceeded, please retry after 30 seconds.");
		expect(isContextOverflow(message, 200000)).toBe(false);
	});

	it("does not treat HTTP 429 style errors as overflow", () => {
		const message = createErrorMessage("Too many requests. Please slow down.");
		expect(isContextOverflow(message, 200000)).toBe(false);
	});

	function createLengthStopMessage(input: number, cacheRead: number, output: number): AssistantMessage {
		return {
			role: "assistant",
			content: [],
			api: "openai-completions",
			provider: "xiaomi",
			model: "mimo-v2.5-pro",
			usage: {
				input,
				output,
				cacheRead,
				cacheWrite: 0,
				totalTokens: input + cacheRead + output,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "length",
			timestamp: Date.now(),
		};
	}

	it("detects Xiaomi-style overflow (length stop with zero output and filled context)", () => {
		const message = createLengthStopMessage(58, 1048512, 0);
		expect(isContextOverflow(message, 1048576)).toBe(true);
	});

	it("does not treat normal length stops with output as overflow", () => {
		const message = createLengthStopMessage(1000, 0, 4096);
		expect(isContextOverflow(message, 200000)).toBe(false);
	});

	it("does not treat length stops far below context as overflow", () => {
		const message = createLengthStopMessage(100, 0, 0);
		expect(isContextOverflow(message, 200000)).toBe(false);
	});
});

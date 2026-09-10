import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamSimple as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { Context, Model } from "../src/types.ts";

const mockState = vi.hoisted(() => ({
	createCalls: [] as Array<{ params: Record<string, unknown>; options: unknown }>,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create(params: Record<string, unknown>, options: unknown) {
					mockState.createCalls.push({ params, options });
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								id: "c",
								choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
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
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

function makeModel(maxImageBytesPerRequest?: number): Model<"openai-completions"> {
	return {
		id: "test-model",
		name: "Test",
		api: "openai-completions",
		provider: "ollama-cloud",
		baseUrl: "https://ollama.com/v1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000000,
		maxTokens: 131072,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			supportsStrictMode: false,
			supportsLongCacheRetention: false,
			...(maxImageBytesPerRequest !== undefined ? { maxImageBytesPerRequest } : {}),
		},
	};
}

/** An image whose data URL is roughly `kb` kilobytes of base64. */
function imageContent(kb: number) {
	return { type: "image" as const, mimeType: "image/png", data: "A".repeat(kb * 1024) };
}

/** The request shape after several image reads: one image per tool result,
 *  each moved to its own follow-up user message by the conversion. */
function multiImageContext(imageCount: number, imageKb: number): Context {
	const messages: Context["messages"] = [{ role: "user", content: "read the frames", timestamp: 0 }];
	for (let i = 0; i < imageCount; i++) {
		messages.push({
			role: "assistant",
			content: [{ type: "toolCall", id: `tc_${i}`, name: "read", arguments: { path: `frame-${i}.png` } }],
			timestamp: i + 1,
			stopReason: "toolUse",
			usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1 },
		} as unknown as Context["messages"][number]);
		messages.push({
			role: "toolResult",
			timestamp: i + 2,
			toolCallId: `tc_${i}`,
			toolName: "read",
			content: [{ type: "text", text: "PNG" }, imageContent(imageKb)],
		} as unknown as Context["messages"][number]);
	}
	return { systemPrompt: "sys", messages, tools: [] };
}

function outgoingImagePayloads(params: Record<string, unknown>): string[] {
	const payloads: string[] = [];
	for (const message of params.messages as Array<{ role: string; content: unknown }>) {
		if (message.role !== "user" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			const part_ = part as { type: string; image_url?: { url: string }; text?: string };
			if (part_.type === "image_url" && part_.image_url?.url.startsWith("data:")) {
				payloads.push(part_.image_url.url);
			}
		}
	}
	return payloads;
}

function outgoingElisionNotes(params: Record<string, unknown>): number {
	let notes = 0;
	for (const message of params.messages as Array<{ role: string; content: unknown }>) {
		if (message.role !== "user" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			const part_ = part as { type: string; text?: string };
			if (part_.type === "text" && part_.text?.includes("image removed from older context")) notes++;
		}
	}
	return notes;
}

async function consume(model: Model<"openai-completions">, context: Context) {
	const stream = streamOpenAICompletions(model, context, { apiKey: "test" });
	for await (const _event of stream) {
		void _event;
	}
	await stream.result();
	expect(mockState.createCalls).toHaveLength(1);
	return mockState.createCalls[0]!.params;
}

describe("openai-completions image budget", () => {
	beforeEach(() => {
		mockState.createCalls = [];
	});

	it("elides oldest images until the total payload fits the budget, keeping the newest", async () => {
		// 4 images x 3000KB ≈ 12.3MB total; budget 7MB keeps ~2 newest.
		const model = makeModel(7 * 1024 * 1024);
		const params = await consume(model, multiImageContext(4, 3000));

		const payloads = outgoingImagePayloads(params);
		expect(payloads).toHaveLength(2);
		const total = payloads.reduce((n, url) => n + url.length, 0);
		expect(total).toBeLessThanOrEqual(7 * 1024 * 1024);
		// Newest image survives intact.
		expect(payloads.at(-1)).toContain("data:image/png;base64,");
		expect(outgoingElisionNotes(params)).toBe(2);
	});

	it("keeps every image when the request is within the budget", async () => {
		const model = makeModel(12 * 1024 * 1024);
		const params = await consume(model, multiImageContext(3, 500));

		expect(outgoingImagePayloads(params)).toHaveLength(3);
		expect(outgoingElisionNotes(params)).toBe(0);
	});

	it("never elides the last remaining image even if it alone exceeds the budget", async () => {
		const model = makeModel(1024); // absurdly small budget
		const params = await consume(model, multiImageContext(2, 3000));

		const payloads = outgoingImagePayloads(params);
		expect(payloads).toHaveLength(1);
		expect(outgoingElisionNotes(params)).toBe(1);
	});

	it("leaves requests untouched when no budget is set", async () => {
		const model = makeModel(undefined);
		const params = await consume(model, multiImageContext(4, 3000));

		expect(outgoingImagePayloads(params)).toHaveLength(4);
		expect(outgoingElisionNotes(params)).toBe(0);
	});
});

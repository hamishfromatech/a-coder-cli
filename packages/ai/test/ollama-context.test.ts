import { describe, expect, it } from "vitest";
import {
	fetchOllamaContextWindow,
	looksLikeOllama,
	type OllamaShowResponse,
	ollamaNativeOrigin,
	parseOllamaContextLength,
} from "../src/providers/ollama-context.ts";

describe("ollama-context / ollamaNativeOrigin", () => {
	it("strips the /v1 mount and keeps the origin", () => {
		expect(ollamaNativeOrigin("http://localhost:11434/v1")).toBe("http://localhost:11434");
		expect(ollamaNativeOrigin("https://ollama.com/v1/")).toBe("https://ollama.com");
		expect(ollamaNativeOrigin("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
	});

	it("returns undefined for bad input", () => {
		expect(ollamaNativeOrigin(undefined)).toBeUndefined();
		expect(ollamaNativeOrigin("not a url")).toBeUndefined();
	});
});

describe("ollama-context / looksLikeOllama", () => {
	it("matches the built-in ollama providers", () => {
		expect(looksLikeOllama({ provider: "ollama-cloud", baseUrl: "https://ollama.com/v1" })).toBe(true);
		expect(looksLikeOllama({ provider: "ollama", baseUrl: "http://localhost:11434/v1" })).toBe(true);
	});

	it("matches a custom local provider on port 11434", () => {
		expect(looksLikeOllama({ provider: "my-ollama", baseUrl: "http://localhost:11434/v1" })).toBe(true);
		expect(looksLikeOllama({ provider: "custom", baseUrl: "http://127.0.0.1:11434/v1" })).toBe(true);
	});

	it("matches a host containing ollama", () => {
		expect(looksLikeOllama({ provider: "x", baseUrl: "https://ollama.example.com/v1" })).toBe(true);
	});

	it("rejects unrelated OpenAI-compatible servers", () => {
		expect(looksLikeOllama({ provider: "vllm", baseUrl: "http://localhost:8000/v1" })).toBe(false);
		expect(looksLikeOllama({ provider: "lm-studio", baseUrl: "http://localhost:1234/v1" })).toBe(false);
		expect(looksLikeOllama({ provider: "openai", baseUrl: "https://api.openai.com/v1" })).toBe(false);
	});
});

describe("ollama-context / parseOllamaContextLength", () => {
	it("reads <arch>.context_length from model_info", () => {
		const res: OllamaShowResponse = {
			model_info: {
				"general.architecture": "llama",
				"llama.context_length": 131072,
				"llama.embedding_length": 4096,
			},
		};
		expect(parseOllamaContextLength(res)).toBe(131072);
	});

	it("picks the largest *.context_length (text head over vision sub-model)", () => {
		const res: OllamaShowResponse = {
			model_info: {
				"llama.context_length": 131072,
				"llama.vision.context_length": 8192,
			},
		};
		expect(parseOllamaContextLength(res)).toBe(131072);
	});

	it("prefers an explicit num_ctx override from parameters", () => {
		const res: OllamaShowResponse = {
			parameters: "temperature 0.7\nnum_ctx 32768\ntop_k 40",
			model_info: { "llama.context_length": 131072 },
		};
		expect(parseOllamaContextLength(res)).toBe(32768);
	});

	it("ignores num_ctx that is non-positive", () => {
		const res: OllamaShowResponse = {
			parameters: "num_ctx 0",
			model_info: { "llama.context_length": 8192 },
		};
		expect(parseOllamaContextLength(res)).toBe(8192);
	});

	it("returns undefined when neither signal is present", () => {
		expect(parseOllamaContextLength({ model_info: { "llama.block_count": 32 } })).toBeUndefined();
		expect(parseOllamaContextLength({})).toBeUndefined();
	});
});

describe("ollama-context / fetchOllamaContextWindow", () => {
	it("posts to <origin>/api/show and parses the response", async () => {
		const calls: string[] = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			calls.push(String(input));
			const body = init?.body ? JSON.parse(init.body as string) : {};
			expect(body).toEqual({ model: "llama3.1:8b", verbose: true });
			return new Response(
				JSON.stringify({
					model_info: { "llama.context_length": 131072 },
				} satisfies OllamaShowResponse),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		};
		const n = await fetchOllamaContextWindow("http://localhost:11434/v1", "llama3.1:8b", {
			fetch: fakeFetch,
		});
		expect(n).toBe(131072);
		expect(calls).toEqual(["http://localhost:11434/api/show"]);
	});

	it("returns undefined on a non-200 response", async () => {
		const fakeFetch: typeof fetch = async () => new Response("nope", { status: 404 });
		const n = await fetchOllamaContextWindow("http://localhost:11434/v1", "missing", {
			fetch: fakeFetch,
		});
		expect(n).toBeUndefined();
	});

	it("returns undefined when the fetch throws", async () => {
		const fakeFetch: typeof fetch = async () => {
			throw new Error("ECONNREFUSED");
		};
		const n = await fetchOllamaContextWindow("http://localhost:11434/v1", "llama3.1:8b", {
			fetch: fakeFetch,
			timeoutMs: 100,
		});
		expect(n).toBeUndefined();
	});
});

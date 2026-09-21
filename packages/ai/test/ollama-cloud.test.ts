import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinModels } from "../src/providers/all.ts";
import { createOllamaCloudModel, fetchOllamaCloudModels } from "../src/providers/ollama-cloud.ts";

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function getUrl(input: unknown): string {
	return typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
}

describe("Ollama Cloud", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("static models point to the ollama.com/v1 base URL", () => {
		const models = builtinModels().getModels("ollama-cloud");
		expect(models.length).toBeGreaterThan(0);
		for (const model of models) {
			expect(model.baseUrl).toBe("https://ollama.com/v1");
		}
	});

	it("fetchOllamaCloudModels refreshes from ollama.com/api/tags and /api/show", async () => {
		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const url = getUrl(input);
			if (url === "https://ollama.com/api/tags") {
				expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
				return jsonResponse({
					models: [
						{ name: "llama3.3", model: "llama3.3", modified_at: "", size: 0, digest: "", details: {} },
						{ name: "qwen2.5-coder", model: "qwen2.5-coder", modified_at: "", size: 0, digest: "", details: {} },
					],
				});
			}
			if (url === "https://ollama.com/api/show") {
				const body = init?.body ? JSON.parse(init.body as string) : {};
				const contextLength = body.model === "qwen2.5-coder" ? 32768 : 128000;
				return jsonResponse({
					model_info: { "llama.context_length": contextLength },
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});

		vi.stubGlobal("fetch", fetchMock);

		const refreshed = await fetchOllamaCloudModels("test-key");
		expect(fetchMock).toHaveBeenCalledTimes(3); // 1 tags + 2 show
		expect(refreshed.map((m) => m.id)).toEqual(["llama3.3", "qwen2.5-coder"]);
		expect(refreshed[0]?.contextWindow).toBe(128000);
		expect(refreshed[0]?.maxTokens).toBe(128000);
		expect(refreshed[1]?.contextWindow).toBe(32768);
		expect(refreshed[1]?.maxTokens).toBe(32768);
		for (const model of refreshed) {
			expect(model.baseUrl).toBe("https://ollama.com/v1");
			expect(model.provider).toBe("ollama-cloud");
		}
	});

	it("caps DeepSeek models' maxTokens at the Ollama Cloud output limit", () => {
		// Ollama Cloud rejects max_tokens above the model's output cap with 400
		// "max_tokens exceeds model's maximum output tokens". DeepSeek caps at 65536.
		const deepseek = createOllamaCloudModel("deepseek-v4-flash:0731");
		expect(deepseek.maxTokens).toBe(65536);
		const deepseekPro = createOllamaCloudModel("deepseek-v4-pro:cloud");
		expect(deepseekPro.maxTokens).toBe(65536);
	});

	it("defaults maxTokens to the probed context window for non-DeepSeek models", () => {
		// Probed 2026-09 against ollama.com: the server rejects max_tokens above the
		// model's context_length with 400 "max_tokens (1100000) exceeds model's
		// maximum output tokens (1048576) for model glm-5.3-flash", so the real
		// output cap equals the context window.
		const glm = createOllamaCloudModel("glm-5.3-flash", { contextWindow: 1048576, vision: true });
		expect(glm.maxTokens).toBe(1048576);
		// Without a probed context window, the per-family default applies.
		const fallback = createOllamaCloudModel("llama3.3");
		expect(fallback.maxTokens).toBe(128000);
	});
});

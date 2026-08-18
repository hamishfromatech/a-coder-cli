import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinModels } from "../src/providers/all.ts";
import { fetchOllamaCloudModels } from "../src/providers/ollama-cloud.ts";

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
		expect(refreshed[1]?.contextWindow).toBe(32768);
		for (const model of refreshed) {
			expect(model.baseUrl).toBe("https://ollama.com/v1");
			expect(model.provider).toBe("ollama-cloud");
		}
	});
});

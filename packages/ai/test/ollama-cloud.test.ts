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

	it("fetchOllamaCloudModels refreshes from ollama.com/v1/models", async () => {
		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const url = getUrl(input);
			expect(url).toBe("https://ollama.com/v1/models");
			expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
			return jsonResponse({
				object: "list",
				data: [
					{ id: "llama3.3", object: "model" },
					{ id: "qwen2.5-coder", object: "model" },
				],
			});
		});

		vi.stubGlobal("fetch", fetchMock);

		const refreshed = await fetchOllamaCloudModels("test-key");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(refreshed.map((m) => m.id)).toEqual(["llama3.3", "qwen2.5-coder"]);
		for (const model of refreshed) {
			expect(model.baseUrl).toBe("https://ollama.com/v1");
			expect(model.provider).toBe("ollama-cloud");
		}
	});
});

import { describe, expect, it, vi } from "vitest";
import {
	createLlamaCppModel,
	fetchLlamaCppModels,
	llamaCppContextWindow,
	llamaCppProvider,
	resolveLlamaCppBaseUrl,
} from "../src/providers/llama-cpp.ts";
import { createLMStudioModel, fetchLMStudioModels, lmStudioProvider } from "../src/providers/lm-studio.ts";
import { createOllamaModel, fetchOllamaModels, ollamaProvider, resolveOllamaBaseUrl } from "../src/providers/ollama.ts";

describe("LM Studio provider", () => {
	it("creates a placeholder model with default base URL", () => {
		const model = createLMStudioModel("my-model");
		expect(model.provider).toBe("lm-studio");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("http://localhost:1234/v1");
		expect(model.input).toContain("image");
	});

	it("fetches loaded models from /api/v0/models with real context windows", async () => {
		const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : (input as Request).url;
			if (url === "http://localhost:1234/api/v0/models") {
				return new Response(
					JSON.stringify({
						data: [
							{
								id: "lfm2.5-8b-a1b",
								type: "llm",
								state: "loaded",
								max_context_length: 128000,
								loaded_context_length: 131072,
								capabilities: ["tool_use"],
							},
							{ id: "big-model", type: "llm", state: "loaded", max_context_length: 262144 },
							{ id: "dozing", type: "llm", state: "not-loaded", max_context_length: 8192 },
							{ id: "nomic-embed", type: "embedding", state: "loaded", max_context_length: 2048 },
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchLMStudioModels();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(models.map((m) => m.id)).toEqual(["lfm2.5-8b-a1b", "big-model"]);
		expect(models[0]?.contextWindow).toBe(131072); // served instance context wins
		expect(models[1]?.contextWindow).toBe(262144); // catalog max as fallback

		vi.unstubAllGlobals();
	});

	it("falls back to the bare /v1/models list when /api/v0/models is unavailable", async () => {
		const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : (input as Request).url;
			if (url === "http://localhost:1234/api/v0/models") {
				return new Response("not found", { status: 404 });
			}
			if (url === "http://localhost:1234/v1/models") {
				return new Response(JSON.stringify({ object: "list", data: [{ id: "model-a" }, { id: "model-b" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchLMStudioModels();
		expect(models).toHaveLength(2);
		expect(models[0]?.id).toBe("model-a");
		expect(models[0]?.contextWindow).toBe(128000); // no metadata available
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:1234/v1/models",
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);

		vi.unstubAllGlobals();
	});

	it("provider exposes the placeholder model and dynamic refresh", () => {
		const provider = lmStudioProvider();
		expect(provider.id).toBe("lm-studio");
		expect(provider.getModels()).toHaveLength(1);
		expect(provider.refreshModels).toBeDefined();
	});
});

describe("llama.cpp provider", () => {
	it("uses the default base URL when no env override is set", () => {
		delete process.env.LLAMACPP_BASE_URL;
		expect(resolveLlamaCppBaseUrl()).toBe("http://localhost:8080/v1");
	});

	it("reads base URL from LLAMACPP_BASE_URL env var", () => {
		process.env.LLAMACPP_BASE_URL = "http://192.168.1.10:8080/v1";
		expect(resolveLlamaCppBaseUrl()).toBe("http://192.168.1.10:8080/v1");
		delete process.env.LLAMACPP_BASE_URL;
	});

	it("creates a model using the resolved base URL", () => {
		process.env.LLAMACPP_BASE_URL = "http://custom:9999/v1";
		const model = createLlamaCppModel("my-gguf");
		expect(model.baseUrl).toBe("http://custom:9999/v1");
		delete process.env.LLAMACPP_BASE_URL;
	});

	it("fetches models from the configured /v1/models endpoint and reads the context metadata", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				object: "list",
				data: [
					{ id: "qwen-coder", meta: { n_ctx: 262144, n_ctx_train: 262144 } },
					{ id: "served-lower", meta: { n_ctx: 8192, n_ctx_train: 131072 } },
					{ id: "no-meta" },
				],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchLlamaCppModels();
		expect(models).toHaveLength(3);
		expect(models[0]?.contextWindow).toBe(262144); // served context from meta
		expect(models[1]?.contextWindow).toBe(8192); // n_ctx wins over n_ctx_train
		expect(models[2]?.contextWindow).toBe(128000); // no meta: default
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8080/v1/models",
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);

		vi.unstubAllGlobals();
	});

	it("createLlamaCppModel applies a discovered context window", () => {
		expect(createLlamaCppModel("m", undefined, 262144).contextWindow).toBe(262144);
		expect(createLlamaCppModel("m", undefined, 0).contextWindow).toBe(128000);
		expect(llamaCppContextWindow({ id: "x", meta: { n_ctx_train: 4096 } })).toBe(4096);
		expect(llamaCppContextWindow({ id: "x" })).toBeUndefined();
	});

	it("provider exposes the placeholder model and dynamic refresh", () => {
		const provider = llamaCppProvider();
		expect(provider.id).toBe("llama-cpp");
		expect(provider.getModels()).toHaveLength(1);
		expect(provider.refreshModels).toBeDefined();
	});
});

describe("Ollama provider", () => {
	it("uses the default base URL when no env override is set", () => {
		delete process.env.OLLAMA_BASE_URL;
		expect(resolveOllamaBaseUrl()).toBe("http://localhost:11434/v1");
	});

	it("reads base URL from OLLAMA_BASE_URL env var", () => {
		process.env.OLLAMA_BASE_URL = "http://192.168.1.10:11434/v1";
		expect(resolveOllamaBaseUrl()).toBe("http://192.168.1.10:11434/v1");
		delete process.env.OLLAMA_BASE_URL;
	});

	it("creates a model using the resolved base URL", () => {
		process.env.OLLAMA_BASE_URL = "http://custom:11434/v1";
		const model = createOllamaModel("llama3.2:latest");
		expect(model.provider).toBe("ollama");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("http://custom:11434/v1");
		expect(model.contextWindow).toBe(128000);
		expect(model.input).toContain("image");
		delete process.env.OLLAMA_BASE_URL;
	});

	it("fetches models from the native /api/tags endpoint and probes /api/show for context windows", async () => {
		const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : (input as Request).url;
			if (url === "http://localhost:11434/api/tags") {
				return new Response(
					JSON.stringify({
						models: [
							{
								name: "llama3.2:latest",
								model: "llama3.2:latest",
								modified_at: "",
								size: 0,
								digest: "",
								details: {},
								model_info: { "llama.context_length": 131072 },
							},
							{ name: "qwen2.5:7b", model: "qwen2.5:7b", modified_at: "", size: 0, digest: "", details: {} },
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "http://localhost:11434/api/show") {
				return new Response(JSON.stringify({ model_info: { "llama.context_length": 32768 } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchOllamaModels();
		expect(fetchMock).toHaveBeenCalledTimes(2); // 1 tags + 1 show (only qwen2.5 probed)
		expect(models.map((m) => m.id)).toEqual(["llama3.2:latest", "qwen2.5:7b"]);
		expect(models[0]?.contextWindow).toBe(131072); // from /api/tags model_info
		expect(models[1]?.contextWindow).toBe(32768); // from /api/show probe
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:11434/api/tags",
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);

		vi.unstubAllGlobals();
	});

	it("createOllamaModel applies a discovered context window", () => {
		expect(createOllamaModel("llama3.2:latest", undefined, 32768).contextWindow).toBe(32768);
		expect(createOllamaModel("x", undefined, 0).contextWindow).toBe(128000);
		expect(createOllamaModel("x", undefined, -1).contextWindow).toBe(128000);
	});

	it("provider exposes the placeholder model and dynamic refresh", () => {
		const provider = ollamaProvider();
		expect(provider.id).toBe("ollama");
		expect(provider.getModels()).toHaveLength(1);
		expect(provider.refreshModels).toBeDefined();
	});
});

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
import {
	createSgLangModel,
	fetchSgLangModels,
	resolveSgLangBaseUrl,
	sgLangContextWindow,
	sgLangProvider,
} from "../src/providers/sglang.ts";
import {
	createUnslothModel,
	fetchUnslothModels,
	resolveUnslothBaseUrl,
	unslothContextWindow,
	unslothProvider,
} from "../src/providers/unsloth.ts";
import {
	createVllmModel,
	fetchVllmModels,
	resolveVllmBaseUrl,
	vllmContextWindow,
	vllmProvider,
} from "../src/providers/vllm.ts";

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
							// Vision-capable models report type "vlm" (e.g. mimo-v2.6 distills).
							{
								id: "mimo-v2.6-distill-qwen-9b",
								type: "vlm",
								state: "loaded",
								max_context_length: 262144,
								loaded_context_length: 262144,
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
		expect(models.map((m) => m.id)).toEqual(["lfm2.5-8b-a1b", "mimo-v2.6-distill-qwen-9b", "big-model"]);
		expect(models[0]?.contextWindow).toBe(131072); // served instance context wins
		expect(models[1]?.contextWindow).toBe(262144); // vlm with served context
		expect(models[2]?.contextWindow).toBe(262144); // catalog max as fallback

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

describe("Unsloth provider", () => {
	it("uses the default base URL when no env override is set", () => {
		delete process.env.UNSLOTH_BASE_URL;
		expect(resolveUnslothBaseUrl()).toBe("http://localhost:8888/v1");
	});

	it("reads base URL from UNSLOTH_BASE_URL env var", () => {
		process.env.UNSLOTH_BASE_URL = "http://192.168.1.10:8888/v1";
		expect(resolveUnslothBaseUrl()).toBe("http://192.168.1.10:8888/v1");
		delete process.env.UNSLOTH_BASE_URL;
	});

	it("creates a model using the resolved base URL", () => {
		process.env.UNSLOTH_BASE_URL = "http://custom:8888/v1";
		const model = createUnslothModel("unsloth/Qwen3.8-27B-GGUF");
		expect(model.provider).toBe("unsloth");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("http://custom:8888/v1");
		delete process.env.UNSLOTH_BASE_URL;
	});

	it("fetches models from /v1/models and reads the context metadata", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				object: "list",
				data: [
					{ id: "unsloth/Qwen3.8-27B-GGUF", context_length: 262144, loaded: true, quant: "UD-IQ2_S" },
					{ id: "unsloth/Qwen3.5-0.8B-GGUF", max_context_length: 131072 },
					{ id: "unsloth/no-meta" },
				],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchUnslothModels();
		expect(models).toHaveLength(3);
		expect(models[0]?.contextWindow).toBe(262144); // context_length
		expect(models[1]?.contextWindow).toBe(131072); // max_context_length fallback
		expect(models[2]?.contextWindow).toBe(128000); // no meta: default
		expect(models[0]?.maxTokens).toBe(128000); // llama.cpp-style output budget
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8888/v1/models",
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);

		vi.unstubAllGlobals();
	});

	it("createUnslothModel applies a discovered context window", () => {
		expect(createUnslothModel("m", undefined, 262144).contextWindow).toBe(262144);
		expect(createUnslothModel("m", undefined, 0).contextWindow).toBe(128000);
		expect(unslothContextWindow({ id: "x", context_length: 4096 })).toBe(4096);
		expect(unslothContextWindow({ id: "x", max_context_length: 8192 })).toBe(8192);
		expect(unslothContextWindow({ id: "x" })).toBeUndefined();
	});

	it("provider exposes the placeholder model and dynamic refresh", () => {
		const provider = unslothProvider();
		expect(provider.id).toBe("unsloth");
		expect(provider.getModels()).toHaveLength(1);
		expect(provider.refreshModels).toBeDefined();
	});
});

describe("vLLM provider", () => {
	it("uses the default base URL when no env override is set", () => {
		delete process.env.VLLM_BASE_URL;
		expect(resolveVllmBaseUrl()).toBe("http://localhost:8000/v1");
	});

	it("reads base URL from VLLM_BASE_URL env var", () => {
		process.env.VLLM_BASE_URL = "http://192.168.1.10:8000/v1";
		expect(resolveVllmBaseUrl()).toBe("http://192.168.1.10:8000/v1");
		delete process.env.VLLM_BASE_URL;
	});

	it("creates a model using the resolved base URL", () => {
		process.env.VLLM_BASE_URL = "http://custom:8000/v1";
		const model = createVllmModel("meta-llama/Llama-3.1-8B-Instruct");
		expect(model.provider).toBe("vllm");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("http://custom:8000/v1");
		delete process.env.VLLM_BASE_URL;
	});

	it("fetches models from /v1/models and reads the served context length", async () => {
		const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : (input as Request).url;
			if (url === "http://localhost:8000/v1/models") {
				return new Response(
					JSON.stringify({
						object: "list",
						data: [
							{
								id: "meta-llama/Llama-3.1-8B-Instruct",
								object: "model",
								max_model_len: 131072,
							},
							{ id: "Qwen/Qwen3-32B", object: "model", max_model_len: 40960 },
							{ id: "old-vllm-model" },
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchVllmModels();
		expect(models).toHaveLength(3);
		expect(models[0]?.contextWindow).toBe(131072);
		// vLLM caps prompt + completion against the served window.
		expect(models[0]?.maxTokens).toBe(131072);
		expect(models[1]?.contextWindow).toBe(40960);
		expect(models[2]?.contextWindow).toBe(128000); // no metadata: default
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8000/v1/models",
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);

		vi.unstubAllGlobals();
	});

	it("createVllmModel applies a discovered context window", () => {
		expect(createVllmModel("m", undefined, 262144).contextWindow).toBe(262144);
		expect(createVllmModel("m", undefined, 0).contextWindow).toBe(128000);
		expect(vllmContextWindow({ id: "x", max_model_len: 4096 })).toBe(4096);
		expect(vllmContextWindow({ id: "x" })).toBeUndefined();
	});

	it("provider exposes the placeholder model and dynamic refresh", () => {
		const provider = vllmProvider();
		expect(provider.id).toBe("vllm");
		expect(provider.getModels()).toHaveLength(1);
		expect(provider.refreshModels).toBeDefined();
	});
});

describe("SGLang provider", () => {
	it("uses the default base URL when no env override is set", () => {
		delete process.env.SGLANG_BASE_URL;
		expect(resolveSgLangBaseUrl()).toBe("http://localhost:30000/v1");
	});

	it("reads base URL from SGLANG_BASE_URL env var", () => {
		process.env.SGLANG_BASE_URL = "http://192.168.1.10:30000/v1";
		expect(resolveSgLangBaseUrl()).toBe("http://192.168.1.10:30000/v1");
		delete process.env.SGLANG_BASE_URL;
	});

	it("creates a model using the resolved base URL", () => {
		process.env.SGLANG_BASE_URL = "http://custom:30000/v1";
		const model = createSgLangModel("meta-llama/Llama-3.2-3B-Instruct");
		expect(model.provider).toBe("sglang");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("http://custom:30000/v1");
		delete process.env.SGLANG_BASE_URL;
	});

	it("fetches models from /v1/models and reads the context metadata when reported", async () => {
		const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
			const url = typeof input === "string" ? input : (input as Request).url;
			if (url === "http://localhost:30000/v1/models") {
				return new Response(
					JSON.stringify({
						object: "list",
						data: [
							{
								id: "meta-llama/Llama-3.1-70B-Instruct",
								object: "model",
								owned_by: "sglang",
								max_model_len: 131072,
							},
							{ id: "reported-by-older-sglang" },
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchSgLangModels();
		expect(models).toHaveLength(2);
		expect(models[0]?.contextWindow).toBe(131072);
		expect(models[0]?.maxTokens).toBe(131072);
		expect(models[1]?.contextWindow).toBe(128000); // no metadata: default
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:30000/v1/models",
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);

		vi.unstubAllGlobals();
	});

	it("createSgLangModel applies a discovered context window", () => {
		expect(createSgLangModel("m", undefined, 262144).contextWindow).toBe(262144);
		expect(createSgLangModel("m", undefined, 0).contextWindow).toBe(128000);
		expect(sgLangContextWindow({ id: "x", max_model_len: 4096 })).toBe(4096);
		expect(sgLangContextWindow({ id: "x" })).toBeUndefined();
	});

	it("provider exposes the placeholder model and dynamic refresh", () => {
		const provider = sgLangProvider();
		expect(provider.id).toBe("sglang");
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

	it("removes the 4096 output cap for :cloud models (same backend as the ollama-cloud provider)", () => {
		const cloud = createOllamaModel("glm-5.3-flash:cloud", undefined, 1048576);
		expect(cloud.maxTokens).toBe(1048576);
		// Without a probed context window the budget still fits the default.
		const cloudDefault = createOllamaModel("qwen3:cloud");
		expect(cloudDefault.maxTokens).toBe(128000);
		// Local (non-cloud) models keep the generic Ollama num_predict default.
		const local = createOllamaModel("llama3.2:latest");
		expect(local.maxTokens).toBe(4096);
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

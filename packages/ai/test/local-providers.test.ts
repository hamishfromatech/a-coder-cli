import { describe, expect, it, vi } from "vitest";
import {
	createLlamaCppModel,
	fetchLlamaCppModels,
	llamaCppProvider,
	resolveLlamaCppBaseUrl,
} from "../src/providers/llama-cpp.ts";
import { createLMStudioModel, fetchLMStudioModels, lmStudioProvider } from "../src/providers/lm-studio.ts";

describe("LM Studio provider", () => {
	it("creates a placeholder model with default base URL", () => {
		const model = createLMStudioModel("my-model");
		expect(model.provider).toBe("lm-studio");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("http://localhost:1234/v1");
		expect(model.input).toContain("image");
	});

	it("fetches models from the local /v1/models endpoint", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				object: "list",
				data: [{ id: "model-a" }, { id: "model-b" }],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchLMStudioModels();
		expect(models).toHaveLength(2);
		expect(models[0].id).toBe("model-a");
		expect(models[1].id).toBe("model-b");
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

	it("fetches models from the configured /v1/models endpoint", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				object: "list",
				data: [{ id: "llama-3" }],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchLlamaCppModels();
		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("llama-3");
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:8080/v1/models",
			expect.objectContaining({ headers: { accept: "application/json" } }),
		);

		vi.unstubAllGlobals();
	});

	it("provider exposes the placeholder model and dynamic refresh", () => {
		const provider = llamaCppProvider();
		expect(provider.id).toBe("llama-cpp");
		expect(provider.getModels()).toHaveLength(1);
		expect(provider.refreshModels).toBeDefined();
	});
});

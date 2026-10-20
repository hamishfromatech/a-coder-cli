import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchOllamaDecisionModels, localDecisionsProviders } from "../src/providers/decisions/static.ts";

const TAGS = {
	models: [
		{
			name: "clef-flash:latest",
			model: "clef-flash:latest",
			modified_at: "",
			size: 1,
			digest: "a",
			details: {
				parent_model: "",
				format: "safetensors",
				family: "",
				families: null,
				parameter_size: "",
				quantization_level: "mxfp8",
			},
			capabilities: ["decision", "vision"],
		},
		{
			name: "nimble-v3:latest",
			model: "nimble-v3:latest",
			modified_at: "",
			size: 1,
			digest: "b",
			details: {
				parent_model: "",
				format: "gguf",
				family: "qwen",
				families: null,
				parameter_size: "9B",
				quantization_level: "Q4",
			},
			capabilities: ["decision"],
			model_info: { "qwen.context_length": 65536 },
		},
		{
			name: "clef:cloud",
			model: "clef:cloud",
			modified_at: "",
			size: 1,
			digest: "c",
			details: {
				parent_model: "",
				format: "",
				family: "",
				families: null,
				parameter_size: "27B",
				quantization_level: "FP8",
				context_length: 65536,
			},
			capabilities: ["decision", "vision"],
		},
		{
			name: "qwen3:8b",
			model: "qwen3:8b",
			modified_at: "",
			size: 1,
			digest: "d",
			details: {
				parent_model: "",
				format: "gguf",
				family: "qwen",
				families: null,
				parameter_size: "8B",
				quantization_level: "Q4",
			},
			capabilities: ["completion", "tools"],
		},
	],
};

describe("Ollama decision-model discovery", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("lists installed decision models with capability metadata", async () => {
		const fetchMock = vi.fn(
			async (_input: unknown) =>
				new Response(JSON.stringify(TAGS), { status: 200, headers: { "content-type": "application/json" } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchOllamaDecisionModels("http://localhost:11434/v1");
		expect(models.map((model) => model.id)).toEqual(["clef-flash", "nimble-v3", "clef:cloud"]);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:11434/api/tags");

		const clef = models.find((model) => model.id === "clef-flash");
		expect(clef?.input).toEqual(["text", "image"]);
		expect(clef?.contextWindow).toBe(64000);

		const nimble = models.find((model) => model.id === "nimble-v3");
		expect(nimble?.input).toEqual(["text"]);
		expect(nimble?.contextWindow).toBe(65536);

		const cloud = models.find((model) => model.id === "clef:cloud");
		expect(cloud?.input).toEqual(["text", "image"]);
	});

	test("provider refresh replaces the static rows with installed models", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify(TAGS), { status: 200, headers: { "content-type": "application/json" } }),
			),
		);
		const provider = localDecisionsProviders().find((entry) => entry.id === "ollama");
		expect(provider).toBeDefined();
		await provider?.refreshModels?.();
		expect(provider?.getModels().map((model) => model.id)).toContain("nimble-v3");
	});
});

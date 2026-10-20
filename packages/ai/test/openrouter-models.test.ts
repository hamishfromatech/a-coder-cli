import { afterEach, describe, expect, test, vi } from "vitest";
import { OPENROUTER_MODELS } from "../src/providers/openrouter.models.ts";
import {
	createOpenRouterModel,
	fetchOpenRouterModels,
	type OpenRouterModelListItem,
} from "../src/providers/openrouter.ts";

const NEW_MODEL: OpenRouterModelListItem = {
	id: "deepseek/deepseek-v4.1-flash-1017",
	name: "DeepSeek: DeepSeek V4.1 Flash 1017",
	supported_parameters: ["tools", "reasoning"],
	architecture: { modality: "text+image->text", input_modalities: ["text", "image"] },
	pricing: {
		prompt: "0.00000015",
		completion: "0.0000006",
		input_cache_read: "0.000000003",
	},
	top_provider: { context_length: 1048576, max_completion_tokens: 393216 },
	reasoning: {
		mandatory: false,
		supported_efforts: ["max", "high", "low", "none"],
	},
};

describe("OpenRouter dynamic models", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("maps a new tool-capable model with live metadata", () => {
		const model = createOpenRouterModel(NEW_MODEL);
		expect(model.id).toBe(NEW_MODEL.id);
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("https://openrouter.ai/api/v1");
		expect(model.input).toEqual(["text", "image"]);
		expect(model.reasoning).toBe(true);
		expect(model.cost).toEqual({ input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 });
		expect(model.contextWindow).toBe(1048576);
		expect(model.maxTokens).toBe(262144);
		expect(model.thinkingLevelMap).toEqual({
			off: "none",
			minimal: null,
			low: "low",
			medium: null,
			high: "high",
			xhigh: null,
			max: "max",
		});
		expect(model.compat).toEqual({ supportsDeveloperRole: false, thinkingFormat: "openrouter" });
	});

	test("keeps native Anthropic routing for anthropic/* ids", () => {
		const model = createOpenRouterModel({
			id: "anthropic/claude-sonnet-9",
			name: "Anthropic: Claude Sonnet 9",
			supported_parameters: ["tools"],
			architecture: { input_modalities: ["text", "image"] },
			pricing: { prompt: "0.000003", completion: "0.000015" },
			top_provider: { context_length: 200000, max_completion_tokens: 64000 },
		});
		expect(model.api).toBe("anthropic-messages");
		expect(model.baseUrl).toBe("https://openrouter.ai/api");
	});

	test("preserves curated compat from the generated catalog", () => {
		const generated = Object.values(OPENROUTER_MODELS).find(
			(model) => model.api === "anthropic-messages" && model.compat,
		);
		expect(generated).toBeDefined();
		if (!generated) return;

		const model = createOpenRouterModel({
			...NEW_MODEL,
			id: generated.id,
			name: `${generated.name} (live)`,
			top_provider: { context_length: 123456, max_completion_tokens: 9999 },
		});
		expect(model.api).toBe(generated.api);
		expect(model.baseUrl).toBe(generated.baseUrl);
		expect(model.compat).toEqual(generated.compat);
		expect(model.contextWindow).toBe(123456);
		expect(model.maxTokens).toBe(9999);
	});

	test("fetches the live catalog, filters non-tool models, and sends auth", async () => {
		const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
			return new Response(
				JSON.stringify({
					data: [
						NEW_MODEL,
						{
							id: "anthropic/claude-sonnet-9",
							name: "Anthropic: Claude Sonnet 9",
							supported_parameters: ["tools"],
							pricing: { prompt: "0.000003", completion: "0.000015" },
						},
						{ id: "no-tools/model", name: "No Tools", supported_parameters: ["temperature"] },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchOpenRouterModels("test-key");
		expect(models.map((model) => model.id)).toEqual([
			"deepseek/deepseek-v4.1-flash-1017",
			"anthropic/claude-sonnet-9",
		]);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/models");
	});
});

import { afterEach, describe, expect, test, vi } from "vitest";
import { INCEPTION_MODELS } from "../src/providers/inception.models.ts";
import { createInceptionModel, fetchInceptionModels, type InceptionModelListItem } from "../src/providers/inception.ts";

const MERCURY_3: InceptionModelListItem = {
	id: "mercury-3",
	name: "Inception: Mercury 3",
	context_length: 1_000_000,
	max_output_length: 131_072,
	input_modalities: ["text"],
	output_modalities: ["text"],
	pricing: {
		prompt: "0.0000002",
		completion: "0.00000075",
		input_cache_reads: "0.00000002",
		input_cache_writes: "0",
	},
	supported_features: ["tools", "json_mode"],
	supported_endpoints: ["chat.completions"],
};

describe("Inception dynamic models", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("maps live model metadata and keeps the generated compat", () => {
		const model = createInceptionModel(MERCURY_3);
		expect(model.id).toBe("mercury-3");
		expect(model.provider).toBe("inception");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("https://api.inceptionlabs.ai/v1");
		expect(model.cost).toEqual({ input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0 });
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxTokens).toBe(131_072);
		expect(model.compat).toMatchObject({ supportsDeveloperRole: false, maxTokensField: "max_tokens" });

		const mercury2 = createInceptionModel({
			id: "mercury-2",
			name: "Inception: Mercury 2",
			supported_features: ["tools"],
			supported_endpoints: ["chat.completions"],
		});
		expect(mercury2.compat).toEqual(INCEPTION_MODELS["mercury-2"]?.compat);
	});

	test("fetches the live catalog and filters non-chat/non-tool models", async () => {
		const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
			return new Response(
				JSON.stringify({
					data: [
						MERCURY_3,
						{
							id: "mercury-decide",
							name: "Inception: Mercury Decide",
							supported_features: [],
							supported_endpoints: ["decisions"],
						},
						{
							id: "mercury-edit-2",
							name: "Inception: Mercury Edit 2",
							supported_features: [],
							supported_endpoints: ["edit.completions"],
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchInceptionModels("test-key");
		expect(models.map((model) => model.id)).toEqual(["mercury-3"]);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.inceptionlabs.ai/v1/models");
	});
});

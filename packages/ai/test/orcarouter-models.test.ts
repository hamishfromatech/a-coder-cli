import { describe, expect, it } from "vitest";

import {
	createOrcaRouterModel,
	inputModalitiesOf,
	isChatWorthyOrcaRouterModel,
	type OrcaRouterModelListItem,
} from "../src/providers/orcarouter.ts";

describe("isChatWorthyOrcaRouterModel", () => {
	it("keeps entries with no endpoint metadata", () => {
		expect(isChatWorthyOrcaRouterModel({ id: "openai/gpt-4o-mini" })).toBe(true);
	});

	it("keeps openai-chat entries and drops images/video-only ones", () => {
		const chat: OrcaRouterModelListItem = { id: "x", supported_endpoint_types: ["openai"] };
		const images: OrcaRouterModelListItem = { id: "x", supported_endpoint_types: ["images"] };
		const video: OrcaRouterModelListItem = { id: "x", supported_endpoint_types: ["openai", "video"] };
		expect(isChatWorthyOrcaRouterModel(chat)).toBe(true);
		expect(isChatWorthyOrcaRouterModel(images)).toBe(false);
		expect(isChatWorthyOrcaRouterModel(video)).toBe(true);
	});
});

describe("inputModalitiesOf", () => {
	it("claims image only when the capability metadata has it", () => {
		expect(inputModalitiesOf({ id: "x" })).toEqual(["text"]);
		expect(
			inputModalitiesOf({
				id: "x",
				architecture: { input_modalities: ["text", "image"] },
			}),
		).toEqual(["text", "image"]);
	});
});

describe("createOrcaRouterModel", () => {
	it("falls back to sane budgets when the catalog metadata is absent", () => {
		const model = createOrcaRouterModel("openai/gpt-4o-mini", { id: "openai/gpt-4o-mini" });
		expect(model.contextWindow).toBe(128000);
		expect(model.maxTokens).toBe(32768);
		expect(model.input).toEqual(["text"]);
	});

	it("trusts the catalog budgets when present", () => {
		const model = createOrcaRouterModel("m", {
			id: "m",
			context_length: 200000,
			max_completion_tokens: 8192,
			architecture: { input_modalities: ["text", "image"] },
		});
		expect(model.contextWindow).toBe(200000);
		expect(model.maxTokens).toBe(8192);
		expect(model.input).toEqual(["text", "image"]);
	});

	it("caps max tokens under the context window", () => {
		const model = createOrcaRouterModel("m", { id: "m", context_length: 4096, max_completion_tokens: 999999 });
		expect(model.contextWindow).toBe(4096);
		expect(model.maxTokens).toBe(4096);
	});
});

import { afterEach, describe, expect, it } from "vitest";
import { getModel } from "../src/compat.ts";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalInceptionApiKey = process.env.INCEPTION_API_KEY;

afterEach(() => {
	if (originalInceptionApiKey === undefined) {
		delete process.env.INCEPTION_API_KEY;
	} else {
		process.env.INCEPTION_API_KEY = originalInceptionApiKey;
	}
});

describe("Inception models", () => {
	it("registers Mercury 2.5 via the OpenAI-compatible Chat Completions API", () => {
		const model = getModel("inception", "mercury-2.5");

		expect(model).toBeDefined();
		expect(model.api).toBe("openai-completions");
		expect(model.provider).toBe("inception");
		expect(model.baseUrl).toBe("https://api.inceptionlabs.ai/v1");
		expect(model.contextWindow).toBe(260000);
		expect(model.maxTokens).toBe(65536);
		expect(model.cost).toEqual({
			input: 0.04,
			output: 0.15,
			cacheRead: 0.004,
			cacheWrite: 0,
		});
		// Inception's /v1/chat/completions expects the classic max_tokens field.
		expect(model.compat?.maxTokensField).toBe("max_tokens");
	});

	it("registers Mercury 2", () => {
		const model = getModel("inception", "mercury-2");
		expect(model).toBeDefined();
		expect(model.contextWindow).toBe(128000);
		expect(model.maxTokens).toBe(50000);
	});

	it("resolves INCEPTION_API_KEY from the environment", () => {
		process.env.INCEPTION_API_KEY = "test-inception-key";

		expect(findEnvKeys("inception")).toEqual(["INCEPTION_API_KEY"]);
		expect(getEnvApiKey("inception")).toBe("test-inception-key");
	});
});

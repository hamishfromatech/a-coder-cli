import { describe, expect, it } from "vitest";
import { resolveSubagentModel } from "../src/core/subagents/inline-extension.ts";

const models = [
	{ provider: "anthropic", id: "claude-sonnet-4-5" },
	{ provider: "openai", id: "gpt-5" },
	{ provider: "openai", id: "claude-sonnet-4-5" },
];

describe("resolveSubagentModel", () => {
	it("uses an explicit provider and model before every fallback", () => {
		expect(
			resolveSubagentModel(models, "openai", "claude-sonnet-4-5", "gpt-5", {
				provider: "anthropic",
				model: "claude-sonnet-4-5",
			}),
		).toEqual({ provider: "openai", id: "claude-sonnet-4-5" });
	});

	it("understands a provider/model reference", () => {
		expect(resolveSubagentModel(models, undefined, "openai/gpt-5", undefined, {})).toEqual({
			provider: "openai",
			id: "gpt-5",
		});
	});

	it("uses an agent definition before the global default", () => {
		expect(
			resolveSubagentModel(models, undefined, undefined, "gpt-5", {
				provider: "anthropic",
				model: "claude-sonnet-4-5",
			}),
		).toEqual({ provider: "openai", id: "gpt-5" });
	});

	it("uses the global subagent default", () => {
		expect(
			resolveSubagentModel(models, undefined, undefined, undefined, {
				provider: "openai",
				model: "gpt-5",
			}),
		).toEqual({ provider: "openai", id: "gpt-5" });
	});

	it("inherits when nothing names a model", () => {
		expect(resolveSubagentModel(models, undefined, undefined, undefined, {})).toBeUndefined();
	});

	it("picks a provider's first model when only the provider is set", () => {
		expect(resolveSubagentModel(models, "openai", undefined, undefined, {})).toEqual({
			provider: "openai",
			id: "gpt-5",
		});
	});
});

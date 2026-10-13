import type { DecisionResult, DecisionsModel, DecisionsProvider } from "@earendil-works/pi-ai";
import { builtinDecisionsModels, createDecisionsModels } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildDecisionClassifierQuestions,
	type ClassifierVerdict,
	classifyToolCallWithDecisionModel,
} from "../src/core/permission-classifier.ts";

function fakeProvider(id: string, modelId: string, answers: DecisionResult["answers"]): DecisionsProvider {
	const model: DecisionsModel<any> = {
		id: modelId,
		name: modelId,
		api: "systemone",
		provider: id,
		baseUrl: "https://fake.invalid/v1",
		contextWindow: 32000,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	return {
		id,
		name: id,
		auth: { apiKey: undefined },
		getModels: () => [model],
		postDecisions: async (_model, _context) => {
			// The classifier questions are present; the answers keyed by name.
			return {
				api: "systemone",
				provider: id,
				model: modelId,
				servedModel: modelId,
				answers,
				stopReason: "stop",
				durationMs: 12,
				timestamp: Date.now(),
			};
		},
	};
}

function blockAnswers(confidence = 0.95): DecisionResult["answers"] {
	return {
		verdict: {
			type: "choice",
			choice: "block",
			probabilities: { allow: 1 - confidence, block: confidence },
			confidence,
		},
		risk: { type: "score", score: 3, legend: {} },
	};
}

describe("auto-mode decision-model classifier", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("maps choice[block] onto the shared shouldBlock verdict", async () => {
		const models = createDecisionsModels();
		models.setProvider(fakeProvider("fake", "fake-model", blockAnswers()));
		const outcome = await classifyToolCallWithDecisionModel(models, models.getModels()[0], {
			toolName: "bash",
			args: { command: "rm -rf /" },
		});
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			const verdict: ClassifierVerdict = outcome.verdict;
			expect(verdict.engine).toBe("decision");
			expect(verdict.shouldBlock).toBe(true);
			expect(verdict.topProbability).toBe(0.95);
			expect(verdict.model).toBe("fake-model");
		}
	});

	it("allows with allow verdict and zeroes blocking", async () => {
		const models = createDecisionsModels();
		models.setProvider(
			fakeProvider("fake", "fake-model", {
				verdict: { type: "choice", choice: "allow", probabilities: { allow: 0.99, block: 0.01 }, confidence: 0.99 },
				risk: { type: "score", score: 0 },
			}),
		);
		const outcome = await classifyToolCallWithDecisionModel(models, models.getModels()[0], {
			toolName: "bash",
			args: { command: "npm test" },
		});
		expect(outcome.ok && !outcome.verdict.shouldBlock).toBe(true);
	});

	it("falls back to an LLM-shaped error when the request fails", async () => {
		const models = createDecisionsModels();
		models.setProvider({
			...fakeProvider("fake", "fake-model", blockAnswers()),
			postDecisions: async () => ({
				api: "systemone",
				provider: "fake",
				model: "fake-model",
				answers: {},
				stopReason: "error",
				errorMessage: "server absent",
				timestamp: Date.now(),
			}),
		});
		const outcome = await classifyToolCallWithDecisionModel(models, models.getModels()[0], {
			toolName: "bash",
			args: {},
		});
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error).toContain("server absent");
	});

	it("builds the verdict + risk question set", () => {
		const questions = buildDecisionClassifierQuestions();
		expect(questions.verdict.type).toBe("choice");
		expect(questions.risk.type).toBe("score");
		expect(Object.keys(questions.verdict.criteria ?? {})).toEqual(["allow", "block"]);
	});

	it("builtin decisions providers carry the jev rows and local family", () => {
		const models = builtinDecisionsModels();
		const all = models.getModels().map((m) => `${m.provider}/${m.id}`);
		expect(all).toContain("openrouter/~typesafe/jev-latest");
		expect(all).toContain("openrouter/typesafe/jev-1.13");
		expect(all).toContain("typesafe/jev-latest");
		expect(all).toContain("ollama/clef-flash");
		expect(all).toContain("lm-studio/clef");
		expect(all).toContain("llama-cpp/clef-flash");
		expect(all).toContain("unsloth/nimble");
		expect(models.getModel("openrouter", "~typesafe/jev-latest")?.systemonePath).toBe("/alpha/decisions");
	});
});

import type { DecisionResult } from "@earendil-works/pi-ai";
import { createDecisionsModels } from "@earendil-works/pi-ai/compat";
import { describe, expect, test, vi } from "vitest";
import {
	type AutoContinueChoiceInput,
	type AutoContinueHistoryEntry,
	type AutoContinueState,
	buildAutoContinueQuestions,
	chooseAutoContinueAction,
	decideAutoContinue,
	localAutoContinueStop,
	recordAutoContinueDecision,
} from "../src/core/decision-policy.ts";
import type { ResolvedAutoContinueSettings } from "../src/core/settings-manager.ts";

const settings: ResolvedAutoContinueSettings = {
	mode: "smart",
	minContinueProbability: 0.7,
	minProgressProbability: 0.55,
	maxConsecutive: 2,
};

function choose(overrides: Partial<AutoContinueChoiceInput> = {}): string {
	return chooseAutoContinueAction({
		probabilities: { continue: 0.82, ask_user: 0.08, done: 0.06, blocked: 0.04 },
		progress: 0.8,
		consecutive: 0,
		settings,
		...overrides,
	});
}

describe("auto-continue decision policy", () => {
	test("continues only with strong unfinished-work and progress signals", () => {
		expect(choose()).toBe("continue");
	});

	test("stops when the task is done or blocked", () => {
		expect(choose({ probabilities: { continue: 0.1, ask_user: 0.1, done: 0.75, blocked: 0.05 } })).toBe("stop");
		expect(choose({ probabilities: { continue: 0.2, ask_user: 0.1, done: 0.1, blocked: 0.6 } })).toBe("stop");
	});

	test("stops when another turn would not make progress", () => {
		expect(choose({ progress: 0.2 })).toBe("stop");
	});

	test("asks the user when the task is unfinished but blocked on input", () => {
		expect(choose({ probabilities: { continue: 0.4, ask_user: 0.45, done: 0.1, blocked: 0.05 } })).toBe("ask_user");
	});

	test("stops at the consecutive continuation limit", () => {
		expect(choose({ consecutive: 2 })).toBe("stop");
	});

	test("continues past a blank assistant turn after a tool when the tool made progress", () => {
		expect(
			choose({
				emptyAfterTool: true,
				probabilities: { continue: 0.1, ask_user: 0.1, done: 0.75, blocked: 0.05 },
				progress: 0.8,
			}),
		).toBe("continue");
	});

	test("still respects a block or a lack of progress after a blank tool stop", () => {
		expect(
			choose({
				emptyAfterTool: true,
				probabilities: { continue: 0.1, ask_user: 0.1, done: 0.1, blocked: 0.7 },
				progress: 0.8,
			}),
		).toBe("stop");
		expect(choose({ emptyAfterTool: true, progress: 0.2 })).toBe("stop");
	});

	test("asks the model for a bounded, typed question set", () => {
		const questions = buildAutoContinueQuestions();
		expect(questions.next?.type).toBe("choice");
		expect(questions.progress?.type).toBe("noul");
		expect(questions.completion?.type).toBe("score");
		if (questions.next?.type === "choice") {
			expect(Object.keys(questions.next.criteria)).toEqual(["done", "ask_user", "blocked", "continue"]);
		}
		if (questions.completion?.type === "score") {
			expect(questions.completion.criteria.length).toBe(7);
		}
		expect(buildAutoContinueQuestions("tool_pause").next?.instructions).toContain("no final response");
	});
});

describe("local hard guards", () => {
	function minimalState(overrides: Partial<AutoContinueState> = {}): AutoContinueState {
		return {
			checkpoint: "agent_end",
			goal: "fix the bug",
			lastAssistant: "",
			recent: [],
			consecutive: 0,
			...overrides,
		};
	}

	test("stops on trailing tool error streaks, repeated identical calls, and full context", () => {
		expect(localAutoContinueStop(minimalState({ errorStreak: 3 }), settings)).toContain("error streak");
		expect(localAutoContinueStop(minimalState({ errorStreak: 2 }), settings)).toBeUndefined();
		expect(localAutoContinueStop(minimalState({ repeatStreak: 4 }), settings)).toContain("repeated identical");
		expect(localAutoContinueStop(minimalState({ context: { used: 860, window: 1000 } }), settings)).toContain(
			"context near window",
		);
	});

	test("allows a healthy state through", () => {
		expect(localAutoContinueStop(minimalState({ context: { used: 400, window: 1000 } }), settings)).toBeUndefined();
	});

	test("the policy honors the same guards even when the model leans continue", () => {
		expect(choose({ errorStreak: 3, repeatStreak: 4, context: { used: 900, window: 1000 } })).toBe("stop");
	});
});

describe("plan awareness", () => {
	test("accepts a weaker done vote when the plan is fully complete", () => {
		expect(
			choose({
				probabilities: { continue: 0.4, ask_user: 0.05, done: 0.5, blocked: 0.05 },
				plan: { total: 4, done: 4 },
			}),
		).toBe("stop");
	});

	test("does not lower the done threshold without a plan", () => {
		expect(choose({ probabilities: { continue: 0.4, ask_user: 0.05, done: 0.5, blocked: 0.05 } })).not.toBe("stop");
	});

	test("raises the done bar while plan items are still open", () => {
		// 0.6 done would stop without plan context; with open items it must not.
		expect(
			choose({
				probabilities: { continue: 0.3, ask_user: 0.05, done: 0.6, blocked: 0.05 },
				plan: { total: 6, done: 1 },
			}),
		).not.toBe("stop");
		// A strong done vote with open items still stops (parked backlog).
		expect(
			choose({
				probabilities: { continue: 0.1, ask_user: 0.1, done: 0.75, blocked: 0.05 },
				plan: { total: 6, done: 1 },
			}),
		).toBe("stop");
	});
});

describe("trajectory", () => {
	const history = (entries: AutoContinueHistoryEntry[]): AutoContinueHistoryEntry[] => entries;

	test("counts a rising completion as progress", () => {
		expect(
			choose({
				probabilities: { continue: 0.8, ask_user: 0.05, done: 0.1, blocked: 0.05 },
				progress: 0.3,
				completion: 0.5,
				history: history([
					{ checkpoint: "agent_end", action: "continue", continueP: 0.8, progress: 0.7, completion: 0.17 },
				]),
			}),
		).toBe("continue");
	});

	test("stops after two continuations without completion gains", () => {
		const stalledHistory = history([
			{ checkpoint: "agent_end", action: "continue", continueP: 0.8, progress: 0.8, completion: 0.25 },
			{ checkpoint: "agent_end", action: "continue", continueP: 0.8, progress: 0.8, completion: 0.2 },
		]);
		expect(choose({ completion: 0.2, history: stalledHistory })).toBe("stop");
	});

	test("still continues after one flat plateau", () => {
		const plateauedHistory = history([
			{ checkpoint: "agent_end", action: "continue", continueP: 0.8, progress: 0.8, completion: 0.5 },
		]);
		expect(choose({ completion: 0.5, history: plateauedHistory })).toBe("continue");
	});

	test("averages the continue lean with the previous checkpoint", () => {
		// One strong prior: a weaker current lean still continues.
		expect(
			choose({
				probabilities: { continue: 0.66, ask_user: 0.1, done: 0.1, blocked: 0.14 },
				history: history([
					{ checkpoint: "agent_end", action: "continue", continueP: 0.9, progress: 0.8, completion: 0.1 },
				]),
			}),
		).toBe("continue");
		// Two weaker leans average below the threshold.
		expect(
			choose({
				probabilities: { continue: 0.66, ask_user: 0.1, done: 0.1, blocked: 0.14 },
				history: history([
					{ checkpoint: "agent_end", action: "continue", continueP: 0.6, progress: 0.8, completion: 0.1 },
				]),
			}),
		).toBe("ask_user");
	});
});

describe("unattended runs", () => {
	test("ask_user becomes stop when nobody can answer", () => {
		expect(
			choose({ probabilities: { continue: 0.4, ask_user: 0.45, done: 0.1, blocked: 0.05 }, unattended: true }),
		).toBe("stop");
	});

	test("continued work still runs headless when the model leans continue", () => {
		expect(
			choose({
				probabilities: { continue: 0.85, ask_user: 0.05, done: 0.05, blocked: 0.05 },
				progress: 0.9,
				unattended: true,
			}),
		).toBe("continue");
	});
});

describe("decision-model round trip", () => {
	test("normalizes the completion score and reports progressed", async () => {
		const answers: DecisionResult["answers"] = {
			next: {
				type: "choice",
				choice: "continue",
				probabilities: { continue: 0.85, ask_user: 0.05, done: 0.05, blocked: 0.05 },
				confidence: 0.8,
			},
			progress: { type: "noul", noul: 0.2 },
			completion: { type: "score", score: 3 },
		};
		const { models, model } = installFake(answers);
		const decision = await decideAutoContinue(
			models,
			model,
			{
				checkpoint: "agent_end",
				goal: "do the thing",
				lastAssistant: "half done",
				recent: [],
				consecutive: 0,
				history: [{ checkpoint: "agent_end", action: "continue", continueP: 0.8, progress: 0.7, completion: 0.17 }],
			},
			settings,
		);
		expect(decision?.action).toBe("continue");
		expect(decision?.completion).toBeCloseTo(0.5, 5);
		expect(decision?.progressed).toBe(true);
		expect(decision?.reason).toContain("completion=0.50");
	});

	test("skips the model call when a local guard is decisive", async () => {
		const { models, model } = installFake({});
		const postDecisions = vi.spyOn(models, "postDecisions");
		const decision = await decideAutoContinue(
			models,
			model,
			{
				checkpoint: "agent_end",
				goal: "do the thing",
				lastAssistant: "",
				recent: [],
				consecutive: 0,
				errorStreak: 3,
			},
			settings,
		);
		expect(postDecisions).not.toHaveBeenCalled();
		expect(decision?.action).toBe("stop");
		expect(decision?.reason).toContain("error streak");
	});
});

describe("history recording", () => {
	test("appends and stays bounded", () => {
		const history: AutoContinueHistoryEntry[] = [];
		for (let i = 0; i < 10; i++) {
			recordAutoContinueDecision(history, {
				action: "continue",
				checkpoint: "agent_end",
				probabilities: { continue: 0.8 },
				progress: 0.8,
				completion: 0.1 + i / 20,
				latencyMs: 1,
				reason: "test",
			});
		}
		expect(history).toHaveLength(6);
		expect(history[0].completion).toBeCloseTo(0.3, 5);
		expect(history[5].completion).toBeCloseTo(0.55, 5);
	});
});

function installFake(answers: DecisionResult["answers"]): {
	models: ReturnType<typeof createDecisionsModels>;
	model: Parameters<typeof decideAutoContinue>[1];
} {
	const models = createDecisionsModels();
	const model: Parameters<typeof decideAutoContinue>[1] = {
		id: "fake-model",
		name: "fake",
		api: "systemone",
		provider: "fake",
		baseUrl: "https://fake.invalid/v1",
		contextWindow: 32_000,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	models.setProvider({
		id: "fake",
		name: "fake",
		auth: { apiKey: undefined },
		getModels: () => [model],
		postDecisions: async () => ({
			api: "systemone",
			provider: "fake",
			model: model.id,
			servedModel: model.id,
			answers,
			stopReason: "stop",
			durationMs: 12,
			timestamp: Date.now(),
		}),
	});
	return { models, model };
}

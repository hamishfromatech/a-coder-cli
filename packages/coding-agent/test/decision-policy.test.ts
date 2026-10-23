import { describe, expect, test } from "vitest";
import {
	type AutoContinueChoiceInput,
	buildAutoContinueQuestions,
	chooseAutoContinueAction,
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
		if (questions.next?.type === "choice") {
			expect(Object.keys(questions.next.criteria)).toEqual(["done", "ask_user", "blocked", "continue"]);
		}
		expect(buildAutoContinueQuestions("tool_pause").next?.instructions).toContain("no final response");
	});
});

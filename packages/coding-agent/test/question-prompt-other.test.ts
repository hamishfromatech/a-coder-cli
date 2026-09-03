import { beforeAll, describe, expect, it } from "vitest";
import { QuestionPromptComponent } from "../src/modes/interactive/components/question-prompt.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

/**
 * The implicit "Other" row: an extra choice after the model's options that
 * opens a free-text input whose submitted text becomes the answer (desktop
 * AskUserQuestionCard parity).
 */
describe("QuestionPromptComponent Other option", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	const DOWN = "\x1b[B";
	const ENTER = "\r";
	const ESC = "\x1b";
	const BACKSPACE = "\x7f";

	function makePrompt(onComplete: (answers: Record<string, string> | undefined) => void) {
		return new QuestionPromptComponent(
			[
				{
					question: "Which library?",
					header: "Library",
					options: [
						{ label: "date-fns", description: "first" },
						{ label: "dayjs", description: "second" },
					],
				},
			],
			onComplete,
		);
	}

	it("shows an Other row after the options and opens a text input", () => {
		const prompt = makePrompt(() => {});
		const rendered = prompt.render(80).join("\n");
		expect(rendered).toContain("Other");

		// Move onto the Other row (down twice) and confirm — switches to input mode.
		prompt.handleInput(DOWN);
		prompt.handleInput(DOWN);
		prompt.handleInput(ENTER);
		const inputRendered = prompt.render(80).join("\n");
		expect(inputRendered).toContain("your answer:");
	});

	it("submits the typed text as the answer (single-select)", () => {
		let answers: Record<string, string> | undefined;
		const prompt = makePrompt((a) => {
			answers = a;
		});
		prompt.handleInput(DOWN);
		prompt.handleInput(DOWN);
		prompt.handleInput(ENTER);
		for (const ch of "luxon") prompt.handleInput(ch);
		prompt.handleInput(ENTER);
		expect(answers).toEqual({ "Which library?": "luxon" });
	});

	it("empty Other input does not submit; Esc returns to the options", () => {
		let answers: Record<string, string> | undefined;
		const prompt = makePrompt((a) => {
			answers = a;
		});
		prompt.handleInput(DOWN);
		prompt.handleInput(DOWN);
		prompt.handleInput(ENTER);
		// Enter with nothing typed stays in the input.
		prompt.handleInput(ENTER);
		expect(answers).toBeUndefined();

		// Esc closes the input without answering; cursor returns to the last option.
		prompt.handleInput(ESC);
		const rendered = prompt.render(80).join("\n");
		expect(rendered).not.toContain("your answer:");
		// Enter selects the cursor option (dayjs) normally.
		prompt.handleInput(ENTER);
		expect(answers).toEqual({ "Which library?": "dayjs" });
	});

	it("adds the typed text to a multi-select selection", () => {
		let answers: Record<string, string> | undefined;
		const prompt = new QuestionPromptComponent(
			[
				{
					question: "Which files?",
					header: "Files",
					options: [{ label: "a.ts" }, { label: "b.ts" }],
					multiSelect: true,
				},
			],
			(a) => {
				answers = a;
			},
		);
		// Toggle "a.ts", then add a custom entry via Other.
		prompt.handleInput(ENTER); // selects a.ts
		prompt.handleInput(DOWN);
		prompt.handleInput(DOWN); // cursor on Other
		prompt.handleInput(ENTER);
		for (const ch of "c.ts") prompt.handleInput(ch);
		prompt.handleInput(ENTER); // adds c.ts to the selection
		// Submit the staged selection.
		prompt.handleInput(ENTER);
		expect(answers).toEqual({ "Which files?": "a.ts, c.ts" });
	});

	it("backspace edits the typed answer", () => {
		let answers: Record<string, string> | undefined;
		const prompt = makePrompt((a) => {
			answers = a;
		});
		prompt.handleInput(DOWN);
		prompt.handleInput(DOWN);
		prompt.handleInput(ENTER);
		for (const ch of "luxonn") prompt.handleInput(ch);
		prompt.handleInput(BACKSPACE);
		prompt.handleInput(ENTER);
		expect(answers).toEqual({ "Which library?": "luxon" });
	});
});

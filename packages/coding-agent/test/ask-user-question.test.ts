import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createAskUserQuestionTool, createAskUserQuestionToolDefinition } from "../src/core/tools/ask-user-question.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";

const validInput = {
	questions: [
		{
			question: "Which library?",
			header: "Library",
			options: [
				{ label: "React", description: "Popular" },
				{ label: "Preact", description: "Lighter" },
			],
		},
	],
};

function contextWithQuestions(
	requestUserQuestion: (payload: { questions: unknown[] }) => Promise<{ answers: Record<string, string> } | undefined>,
): ExtensionContext {
	return { ui: { requestUserQuestion } } as unknown as ExtensionContext;
}

describe("ask_user_question tool", () => {
	it("errors when no interactive frontend is attached", async () => {
		const tool = createAskUserQuestionTool();
		const result = await tool.execute("t1", validInput as never);
		expect((result.content[0] as { text?: string }).text).toContain("no interactive frontend");
	});

	it("passes normalized questions to the UI callback and formats answers", async () => {
		const calls: unknown[] = [];
		const ctx = contextWithQuestions(async (payload) => {
			calls.push(payload);
			return { answers: { "Which library?": "React" } };
		});
		const wrapped = wrapToolDefinition(createAskUserQuestionToolDefinition(), () => ctx);
		const result = await wrapped.execute("t1", validInput as never);
		expect((result.content[0] as { text?: string }).text).toContain('"Which library?" = "React"');
		expect(calls).toHaveLength(1);
	});

	it("reports a declined answer without erroring", async () => {
		const ctx = contextWithQuestions(async () => undefined);
		const wrapped = wrapToolDefinition(createAskUserQuestionToolDefinition(), () => ctx);
		const result = await wrapped.execute("t1", validInput as never);
		expect((result.content[0] as { text?: string }).text).toContain("declined");
	});

	it("rejects duplicate option labels", async () => {
		const tool = createAskUserQuestionTool();
		const result = await tool.execute("t1", {
			questions: [
				{
					question: "Pick one",
					header: "Pick",
					options: [{ label: "Same" }, { label: "Same" }],
				},
			],
		} as never);
		expect((result.content[0] as { text?: string }).text).toContain("unique");
	});
});

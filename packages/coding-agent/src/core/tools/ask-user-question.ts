/**
 * Built-in `ask_user_question` tool.
 *
 * Ports easy-agent's AskUserQuestion (itself modeled on Claude Code's): lets
 * the model put a structured multiple-choice question to the user instead of
 * guessing or rattling off options in prose. The tool does no I/O of its own —
 * it hands the questions to the frontend via the optional
 * `ui.requestUserQuestion` context method, which renders an interactive
 * selector (TUI) or modal (desktop) and resolves with the user's answers. When
 * no interactive frontend is attached (print/headless mode), the tool returns a
 * clear error so the model falls back to asking inline.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition, UserQuestion, UserQuestionOption } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const HEADER_MAX = 12;
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;

const askSchema = Type.Object(
	{
		questions: Type.Array(
			Type.Object(
				{
					question: Type.String({
						minLength: 1,
						description: "The complete question text. Should end with a question mark.",
					}),
					header: Type.String({
						minLength: 1,
						description: `Very short chip label (max ${HEADER_MAX} chars), e.g. "Library", "Approach".`,
					}),
					options: Type.Array(
						Type.Object(
							{
								label: Type.String({ minLength: 1, description: "Concise display text (1-5 words)." }),
								description: Type.Optional(
									Type.String({ description: "What choosing this option means or implies." }),
								),
							},
							{ additionalProperties: false, maxItems: MAX_OPTIONS, minItems: 2 },
						),
						{ description: "2-4 distinct choices.", minItems: 2, maxItems: MAX_OPTIONS },
					),
					multiSelect: Type.Optional(
						Type.Boolean({ description: "Allow selecting multiple options. Default false." }),
					),
				},
				{ additionalProperties: false },
			),
			{ description: "1-4 multiple-choice questions to ask the user.", minItems: 1, maxItems: MAX_QUESTIONS },
		),
	},
	{ additionalProperties: false },
);

export type AskUserQuestionInput = Static<typeof askSchema>;

export interface AskUserQuestionDetails {
	questions: UserQuestion[];
	answers?: Record<string, string>;
	declined?: boolean;
}

function normalizeQuestions(input: AskUserQuestionInput): UserQuestion[] | { error: string } {
	if (input.questions.length === 0) return { error: "questions must be a non-empty array" };
	if (input.questions.length > MAX_QUESTIONS) {
		return { error: `at most ${MAX_QUESTIONS} questions are allowed` };
	}
	const questions: UserQuestion[] = [];
	const seenQuestions = new Set<string>();
	for (const raw of input.questions) {
		const question = raw.question.trim();
		if (!question) return { error: "each question needs a non-empty `question` string" };
		if (seenQuestions.has(question)) return { error: "question texts must be unique" };
		seenQuestions.add(question);

		const header = raw.header.trim();
		if (!header) return { error: `question "${question}" needs a short \`header\` label` };

		if (raw.options.length < 2 || raw.options.length > MAX_OPTIONS) {
			return { error: `question "${question}" must have 2-${MAX_OPTIONS} options` };
		}
		const options: UserQuestionOption[] = [];
		const seenLabels = new Set<string>();
		for (const opt of raw.options) {
			const label = opt.label.trim();
			if (!label) return { error: `each option in "${question}" needs a non-empty \`label\`` };
			if (seenLabels.has(label)) return { error: `option labels must be unique within "${question}"` };
			seenLabels.add(label);
			const description = opt.description?.trim();
			options.push({ label, ...(description ? { description } : {}) });
		}
		questions.push({
			question,
			header: header.slice(0, HEADER_MAX),
			options,
			multiSelect: raw.multiSelect === true || undefined,
		});
	}
	return questions;
}

export function createAskUserQuestionToolDefinition(): ToolDefinition<
	typeof askSchema,
	AskUserQuestionDetails | undefined
> {
	return {
		name: "ask_user_question",
		label: "Ask User",
		description:
			"Ask the user one or more multiple-choice questions and wait for their answer. " +
			"Use this when you need the user to make a decision among concrete alternatives " +
			"(e.g. which library, which approach, which files to touch) rather than guessing or " +
			"asking in free-form prose. Provide 1-4 questions, each with a short `header` chip, " +
			"the full `question` text, and 2-4 distinct `options` (each with a `label` and a short " +
			"`description` of its trade-offs). Set `multiSelect: true` when the user may pick more " +
			"than one option. The UI automatically adds an 'Other' choice where the user can type " +
			"a custom answer — do not add your own 'Other' option.",
		promptSnippet: "Ask the user structured multiple-choice questions",
		promptGuidelines: [
			"Use `ask_user_question` when a decision among concrete alternatives would otherwise require guessing.",
			"Ask questions only when the answer genuinely changes what you do next; do not ask for confirmation of obvious choices.",
		],
		parameters: askSchema,
		executionMode: "sequential",
		async execute(_toolCallId, input: AskUserQuestionInput, _signal?, _onUpdate?, rawContext?) {
			const parsed = normalizeQuestions(input);
			if ("error" in parsed) {
				return { content: [{ type: "text" as const, text: `Error: ${parsed.error}` }], details: undefined };
			}

			const ui = (rawContext as ExtensionContext | undefined)?.ui;
			if (!ui?.requestUserQuestion) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Error: no interactive frontend is attached, so the user cannot be prompted. Ask your question directly in your reply instead.",
						},
					],
					details: undefined,
				};
			}

			const response = await ui.requestUserQuestion({ questions: parsed });
			if (!response) {
				return {
					content: [{ type: "text" as const, text: "The user declined to answer the question(s)." }],
					details: { questions: parsed, declined: true },
				};
			}

			const answersText = Object.entries(response.answers)
				.map(([question, answer]) => `"${question}" = "${answer}"`)
				.join(", ");
			return {
				content: [
					{
						type: "text" as const,
						text: `User has answered your questions: ${answersText}. Continue with the user's answers in mind.`,
					},
				],
				details: { questions: parsed, answers: response.answers },
			};
		},
		renderCall(args, theme, context) {
			const text = (context as { lastComponent?: Text } | undefined)?.lastComponent ?? new Text("", 0, 0);
			const count = Array.isArray(args.questions) ? args.questions.length : 0;
			const first = count > 0 ? String(args.questions[0]?.question ?? "") : "";
			text.setText(`${theme.fg("toolTitle", theme.bold("ask_user_question"))} ${theme.fg("muted", first)}`);
			return text;
		},
		renderResult(result, _options, theme, context) {
			const text = (context as { lastComponent?: Text } | undefined)?.lastComponent ?? new Text("", 0, 0);
			const details = result.details as AskUserQuestionDetails | undefined;
			if (details?.declined) {
				text.setText(theme.fg("dim", "User declined to answer"));
			} else if (details?.answers) {
				const answers = Object.entries(details.answers)
					.map(([q, a]) => `${theme.fg("dim", q)}: ${theme.fg("text", a)}`)
					.join(theme.fg("dim", " · "));
				text.setText(answers);
			} else {
				const firstLine = (result.content[0] as { text?: string } | undefined)?.text ?? "";
				text.setText(theme.fg("muted", firstLine));
			}
			return text;
		},
	};
}

export function createAskUserQuestionTool(): AgentTool<typeof askSchema> {
	return wrapToolDefinition(createAskUserQuestionToolDefinition());
}

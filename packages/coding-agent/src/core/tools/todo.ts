import type { AgentTool } from "@theatechcorporation/pi-agent-core";
import { StringEnum } from "@theatechcorporation/pi-ai";
import { Text } from "@theatechcorporation/pi-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const todoSchema = Type.Object(
	{
		todos: Type.Array(
			Type.Object(
				{
					text: Type.String({
						minLength: 1,
						description: "The task description, concise and imperative.",
					}),
					status: StringEnum(["pending", "in_progress", "completed"] as const, {
						description:
							"pending = not started, in_progress = actively working on it now (use for exactly one task at a time), completed = done.",
					}),
					activeForm: Type.Optional(
						Type.String({
							description:
								'Present-progressive phrasing of the in_progress task for UI display (e.g. "Refactoring utils.ts").',
						}),
					),
				},
				{ additionalProperties: false },
			),
			{ description: "The complete, authoritative task list. Replace the entire list on every call." },
		),
	},
	{ additionalProperties: false },
);

export type TodoToolInput = Static<typeof todoSchema>;

export interface TodoItem {
	text: string;
	status: "pending" | "in_progress" | "completed";
	activeForm?: string;
}

export interface TodoToolDetails {
	todos: TodoItem[];
}

const STATUS_GLYPH: Record<TodoItem["status"], string> = {
	pending: "○",
	in_progress: "→",
	completed: "✓",
};

function summarize(todos: TodoItem[]): string {
	if (todos.length === 0) return "No tasks";
	const done = todos.filter((t) => t.status === "completed").length;
	const inProgress = todos.filter((t) => t.status === "in_progress").length;
	const parts = [`${done}/${todos.length} completed`];
	if (inProgress > 0) parts.push(`${inProgress} in progress`);
	return parts.join(" · ");
}

function formatTodoResult(
	result: { content: Array<{ type: string; text?: string }>; details?: TodoToolDetails },
	_options: ToolRenderResultOptions,
	theme: Theme,
): string {
	const todos = result.details?.todos ?? [];
	if (todos.length === 0) {
		return theme.fg("dim", "No tasks");
	}
	let text = theme.fg("muted", summarize(todos));
	for (const t of todos) {
		const glyph =
			t.status === "completed"
				? theme.fg("success", STATUS_GLYPH.completed)
				: t.status === "in_progress"
					? theme.fg("accent", STATUS_GLYPH.in_progress)
					: theme.fg("dim", STATUS_GLYPH.pending);
		const body = t.status === "completed" ? theme.fg("dim", t.text) : theme.fg("text", t.text);
		text += `\n${glyph} ${body}`;
	}
	return text;
}

/**
 * Built-in `todo` tool — a TodoWrite-style task list the model rewrites in full
 * on every call. Stateless by design: the model is the source of truth and each
 * tool result snapshots the list in `details.todos`, so branching stays correct
 * and the desktop UI can render a live checklist from the latest result.
 */
export function createTodoToolDefinition(): ToolDefinition<typeof todoSchema, TodoToolDetails | undefined> {
	return {
		name: "todo",
		label: "Todo",
		description:
			"Maintain a task list for multi-step work. Pass the COMPLETE, updated list on every call — this replaces the prior list entirely. Use it before starting non-trivial tasks (3+ steps), mark exactly one task in_progress while working on it, and mark completed immediately when done. Do not use for trivial single-step actions.",
		promptSnippet: "Maintain a task list for multi-step work",
		parameters: todoSchema,
		async execute(_toolCallId, { todos }: TodoToolInput, _signal?, _onUpdate?, _ctx?) {
			const normalized: TodoItem[] = Array.isArray(todos)
				? todos
						.filter((t) => t && typeof t.text === "string" && t.text.trim().length > 0)
						.map((t) => ({
							text: t.text.trim(),
							status: t.status ?? "pending",
							activeForm: typeof t.activeForm === "string" ? t.activeForm : undefined,
						}))
				: [];

			const content =
				normalized.length === 0
					? "Todo list cleared."
					: normalized
							.map(
								(t) => `[${t.status === "completed" ? "x" : t.status === "in_progress" ? ">" : " "}] ${t.text}`,
							)
							.join("\n");

			return {
				content: [{ type: "text", text: content }],
				details: { todos: normalized },
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const count = Array.isArray(args.todos) ? args.todos.length : 0;
			text.setText(
				`${theme.fg("toolTitle", theme.bold("todo"))} ${theme.fg("muted", `${count} task${count === 1 ? "" : "s"}`)}`,
			);
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatTodoResult(result as never, options, theme));
			return text;
		},
	};
}

export function createTodoTool(): AgentTool<typeof todoSchema> {
	return wrapToolDefinition(createTodoToolDefinition());
}

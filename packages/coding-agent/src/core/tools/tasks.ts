/**
 * Persistent task graph built-in tools: task_create, task_get, task_list,
 * task_update.
 *
 * Ports easy-agent's TaskCreate/TaskGet/TaskList/TaskUpdate toolchain into
 * pi-mono. Unlike the session-scoped `todo` tool (which the model rewrites in
 * full every call), tasks persist to disk under ~/.a-coder/cli/tasks/<session>
 * with stable high-water-mark ids and a bidirectional blocks/blockedBy
 * dependency graph. `task_update` accepts status "deleted" as a pseudo-status
 * to delete a task and cascade reference cleanup. Every result snapshots the
 * affected task list in `details.tasks` so the TUI and desktop panels can
 * render the graph from the latest result.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import {
	blockTask,
	createTask,
	deleteTask,
	getTask,
	getTaskListId,
	listTasks,
	type Task,
	updateTask,
} from "../tasks/task-store.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

// ─── Schemas ───────────────────────────────────────────────────────

const TASK_CREATE_SCHEMA = Type.Object(
	{
		subject: Type.String({ minLength: 1, description: "Imperative one-line title, e.g. 'Fix login bug'." }),
		description: Type.String({ minLength: 1, description: "What needs to be done. One or two paragraphs is fine." }),
		activeForm: Type.Optional(
			Type.String({
				description:
					'Present-progressive shown while the task is in_progress, e.g. "Fixing login bug". If omitted, the subject is used.',
			}),
		),
		metadata: Type.Optional(
			Type.Record(Type.String(), Type.Unknown(), {
				description: "Free-form metadata attached to the task.",
			}),
		),
	},
	{ additionalProperties: false },
);

const TASK_GET_SCHEMA = Type.Object(
	{
		taskId: Type.String({ minLength: 1, description: "The id of the task to retrieve." }),
	},
	{ additionalProperties: false },
);

const TASK_LIST_SCHEMA = Type.Object({}, { additionalProperties: false });

const TASK_UPDATE_SCHEMA = Type.Object(
	{
		taskId: Type.String({ minLength: 1, description: "The id of the task to update." }),
		subject: Type.Optional(Type.String({ description: "New subject (imperative form)." })),
		description: Type.Optional(Type.String({ description: "New description." })),
		activeForm: Type.Optional(
			Type.String({ description: "Present-continuous shown while the task is in_progress." }),
		),
		status: StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
			description: "New status. 'deleted' removes the task and cleans up references.",
		}),
		owner: Type.Optional(
			Type.String({
				description:
					'Teammate name that owns this task (Agent Teams). Use "team-lead" for the lead. Omit to keep unowned.',
			}),
		),
		addBlocks: Type.Optional(
			Type.Array(Type.String(), {
				description: "Task ids that this task blocks (downstream dependencies).",
			}),
		),
		addBlockedBy: Type.Optional(
			Type.Array(Type.String(), { description: "Task ids that block this task (upstream dependencies)." }),
		),
		metadata: Type.Optional(
			Type.Record(Type.String(), Type.Unknown(), {
				description: "Metadata keys to merge. Set a key to null to delete it.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type TaskCreateInput = Static<typeof TASK_CREATE_SCHEMA>;
export type TaskGetInput = Static<typeof TASK_GET_SCHEMA>;
export type TaskListInput = Static<typeof TASK_LIST_SCHEMA>;
export type TaskUpdateInput = Static<typeof TASK_UPDATE_SCHEMA>;

export interface TaskToolDetails {
	/** Full task-list snapshot after the mutation, for live UI panels. */
	tasks: Task[];
	/** The task this call created/updated/deleted (when applicable). */
	taskId?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────

function taskListIdFromContext(context?: ExtensionContext): string {
	const sessionId = context?.sessionManager?.getSessionId();
	return getTaskListId(sessionId ?? "default");
}

function textResult(text: string, details: TaskToolDetails) {
	return { content: [{ type: "text" as const, text }], details };
}

/**
 * Compact per-task line with blocker ids filtered down to *unresolved*
 * blockers only (a completed upstream task doesn't still block anyone).
 */
function formatTaskLines(tasks: Task[]): string[] {
	const resolvedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
	return tasks
		.slice()
		.sort((a, b) => Number(a.id) - Number(b.id))
		.map((task) => {
			const openBlockers = task.blockedBy.filter((id) => !resolvedIds.has(id));
			const blocked =
				openBlockers.length > 0 ? ` [blocked by ${openBlockers.map((id) => `#${id}`).join(", ")}]` : "";
			const owner = task.owner ? ` (owner: ${task.owner})` : "";
			return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
		});
}

function mergeMetadata(
	existing: Record<string, unknown> | undefined,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...(existing ?? {}) };
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) {
			delete merged[key];
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

// ─── TUI rendering ─────────────────────────────────────────────────

const STATUS_GLYPH: Record<Task["status"], string> = {
	pending: "○",
	in_progress: "→",
	completed: "✓",
};

function renderTaskListResult(
	result: { content: Array<{ type: string; text?: string }>; details?: TaskToolDetails },
	theme: Theme,
): string {
	const tasks = result.details?.tasks ?? [];
	if (tasks.length === 0) {
		return theme.fg("dim", "No tasks");
	}
	const sorted = tasks.slice().sort((a, b) => Number(a.id) - Number(b.id));
	const done = sorted.filter((t) => t.status === "completed").length;
	const inProgress = sorted.filter((t) => t.status === "in_progress").length;
	const parts = [`${done}/${sorted.length} done`];
	if (inProgress > 0) parts.push(`${inProgress} in progress`);
	let text = theme.fg("muted", parts.join(" · "));
	const unresolvedIds = new Set(sorted.filter((t) => t.status !== "completed").map((t) => t.id));
	for (const task of sorted) {
		const glyph =
			task.status === "completed"
				? theme.fg("success", STATUS_GLYPH.completed)
				: task.status === "in_progress"
					? theme.fg("accent", STATUS_GLYPH.in_progress)
					: theme.fg("dim", STATUS_GLYPH.pending);
		const body = task.status === "completed" ? theme.fg("dim", task.subject) : theme.fg("text", task.subject);
		const openBlockers = task.blockedBy.filter((id) => unresolvedIds.has(id));
		const blocked =
			openBlockers.length > 0
				? ` ${theme.fg("muted", `[blocked by ${openBlockers.map((id) => `#${id}`).join(", ")}]`)}`
				: "";
		const owner = task.owner ? ` ${theme.fg("muted", `(${task.owner})`)}` : "";
		text += `\n${glyph} ${theme.fg("dim", `#${task.id}`)} ${body}${owner}${blocked}`;
	}
	return text;
}

function renderToolCallRow(label: string, summary: string, theme: Theme, context: unknown): Text {
	const text = (context as { lastComponent?: Text } | undefined)?.lastComponent ?? new Text("", 0, 0);
	text.setText(`${theme.fg("toolTitle", theme.bold(label))} ${theme.fg("muted", summary)}`);
	return text;
}

// ─── Tool definitions ──────────────────────────────────────────────

export function createTaskCreateToolDefinition(): ToolDefinition<typeof TASK_CREATE_SCHEMA, TaskToolDetails> {
	return {
		name: "task_create",
		label: "Task Create",
		description:
			"Create a task in the session's persistent task graph. Tasks survive restarts and conversation clears, and support dependencies via blocks/blockedBy. Use proactively for 3+ step work, multi-step plans, and any task list the user would want to see across sessions.",
		promptSnippet: "Maintain a persistent task graph for multi-session work",
		parameters: TASK_CREATE_SCHEMA,
		async execute(_toolCallId, input: TaskCreateInput, _signal?, _onUpdate?, rawContext?) {
			const taskListId = taskListIdFromContext(rawContext as ExtensionContext | undefined);
			const id = await createTask(taskListId, {
				subject: input.subject,
				description: input.description,
				activeForm: input.activeForm,
				status: "pending",
				blocks: [],
				blockedBy: [],
				...(input.metadata ? { metadata: input.metadata } : {}),
			});
			const tasks = await listTasks(taskListId);
			return textResult(`Task #${id} created: ${input.subject}`, { tasks, taskId: id });
		},
		renderCall(args, theme, context) {
			return renderToolCallRow("task_create", String(args.subject ?? ""), theme, context);
		},
		renderResult(result, _options, theme, context) {
			const text = (context as { lastComponent?: Text } | undefined)?.lastComponent ?? new Text("", 0, 0);
			text.setText(renderTaskListResult(result as never, theme));
			return text;
		},
	};
}

export function createTaskGetToolDefinition(): ToolDefinition<typeof TASK_GET_SCHEMA, TaskToolDetails | undefined> {
	return {
		name: "task_get",
		label: "Task Get",
		description:
			"Retrieve the full details of a single task by id. Always call this before task_update to read current state.",
		promptSnippet: "Read a task's full details",
		parameters: TASK_GET_SCHEMA,
		async execute(_toolCallId, input: TaskGetInput, _signal?, _onUpdate?, rawContext?) {
			const taskListId = taskListIdFromContext(rawContext as ExtensionContext | undefined);
			const task = await getTask(taskListId, input.taskId.trim());
			if (!task) return { content: [{ type: "text" as const, text: "Task not found" }], details: undefined };

			const lines = [
				`Task #${task.id}: ${task.subject}`,
				`Status: ${task.status}`,
				`Description: ${task.description}`,
			];
			if (task.activeForm) lines.push(`ActiveForm: ${task.activeForm}`);
			if (task.owner) lines.push(`Owner: ${task.owner}`);
			if (task.blockedBy.length > 0) lines.push(`Blocked by: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
			if (task.blocks.length > 0) lines.push(`Blocks: ${task.blocks.map((id) => `#${id}`).join(", ")}`);
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { tasks: [task], taskId: task.id },
			};
		},
		renderCall(args, theme, context) {
			return renderToolCallRow("task_get", `#${String(args.taskId ?? "")}`, theme, context);
		},
		renderResult(result, _options, theme, context) {
			const text = (context as { lastComponent?: Text } | undefined)?.lastComponent ?? new Text("", 0, 0);
			const firstLine = (result.content[0] as { text?: string } | undefined)?.text?.split("\n")[0] ?? "";
			text.setText(theme.fg("muted", firstLine));
			return text;
		},
	};
}

export function createTaskListToolDefinition(): ToolDefinition<typeof TASK_LIST_SCHEMA, TaskToolDetails> {
	return {
		name: "task_list",
		label: "Task List",
		description:
			"List every task in the session's persistent task graph. Use this before starting work to find the next unblocked task, and after finishing one to see what was unblocked. Prefer tasks in ascending id order when multiple are ready.",
		promptSnippet: "List the persistent task graph",
		parameters: TASK_LIST_SCHEMA,
		async execute(_toolCallId, _input: TaskListInput, _signal?, _onUpdate?, rawContext?) {
			const taskListId = taskListIdFromContext(rawContext as ExtensionContext | undefined);
			const tasks = await listTasks(taskListId);
			if (tasks.length === 0) {
				return textResult("No tasks found", { tasks });
			}
			return textResult(formatTaskLines(tasks).join("\n"), { tasks });
		},
		renderCall(_args, theme, context) {
			return renderToolCallRow("task_list", "", theme, context);
		},
		renderResult(result, _options, theme, context) {
			const text = (context as { lastComponent?: Text } | undefined)?.lastComponent ?? new Text("", 0, 0);
			text.setText(renderTaskListResult(result as never, theme));
			return text;
		},
	};
}

export function createTaskUpdateToolDefinition(): ToolDefinition<typeof TASK_UPDATE_SCHEMA, TaskToolDetails> {
	return {
		name: "task_update",
		label: "Task Update",
		description:
			"Update a task in the persistent task graph. Use this to mark progress (pending → in_progress → completed), edit fields, assign an owner (Agent Teams), add dependencies, or delete tasks by setting status to 'deleted'. Always read the task's latest state with task_get before editing.",
		promptSnippet: "Update the persistent task graph",
		parameters: TASK_UPDATE_SCHEMA,
		async execute(_toolCallId, input: TaskUpdateInput, _signal?, _onUpdate?, rawContext?) {
			const taskId = input.taskId.trim();
			const taskListId = taskListIdFromContext(rawContext as ExtensionContext | undefined);
			const existing = await getTask(taskListId, taskId);
			if (!existing) {
				return {
					content: [{ type: "text" as const, text: `Task #${taskId} not found` }],
					details: { tasks: await listTasks(taskListId) },
				};
			}

			// Short-circuit status="deleted": run the cascading delete. Other
			// updates in the same call are ignored — the edits are moot anyway.
			const statusValue = input.status;
			if (statusValue === "deleted") {
				const ok = await deleteTask(taskListId, taskId);
				const tasks = await listTasks(taskListId);
				return ok
					? textResult(`Task #${taskId} deleted.`, { tasks })
					: {
							content: [{ type: "text" as const, text: `Failed to delete task #${taskId}.` }],
							details: { tasks },
						};
			}

			const updates: Partial<Omit<Task, "id">> = {};
			const updatedFields: string[] = [];

			if (input.subject !== undefined && input.subject !== existing.subject) {
				updates.subject = input.subject;
				updatedFields.push("subject");
			}
			if (input.description !== undefined && input.description !== existing.description) {
				updates.description = input.description;
				updatedFields.push("description");
			}
			if (input.activeForm !== undefined && input.activeForm !== existing.activeForm) {
				updates.activeForm = input.activeForm;
				updatedFields.push("activeForm");
			}
			if (statusValue !== undefined && statusValue !== existing.status) {
				updates.status = statusValue;
				updatedFields.push("status");
			}
			if (input.owner !== undefined && input.owner !== existing.owner) {
				updates.owner = input.owner || undefined;
				updatedFields.push("owner");
			}
			if (input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)) {
				updates.metadata = mergeMetadata(existing.metadata, input.metadata as Record<string, unknown>);
				updatedFields.push("metadata");
			}

			if (Object.keys(updates).length > 0) {
				await updateTask(taskListId, taskId, updates);
			}

			// Dependency wires run AFTER the main update so both sides of each
			// block/blockedBy pair see the freshest state.
			const addBlocks = input.addBlocks;
			if (addBlocks && addBlocks.length > 0) {
				let changed = false;
				for (const downstreamId of addBlocks) {
					if (existing.blocks.includes(downstreamId)) continue;
					const ok = await blockTask(taskListId, taskId, downstreamId);
					if (ok) changed = true;
				}
				if (changed) updatedFields.push("blocks");
			}

			const addBlockedBy = input.addBlockedBy;
			if (addBlockedBy && addBlockedBy.length > 0) {
				let changed = false;
				for (const upstreamId of addBlockedBy) {
					if (existing.blockedBy.includes(upstreamId)) continue;
					const ok = await blockTask(taskListId, upstreamId, taskId);
					if (ok) changed = true;
				}
				if (changed) updatedFields.push("blockedBy");
			}

			const tasks = await listTasks(taskListId);
			if (updatedFields.length === 0) {
				return textResult(`Task #${taskId} unchanged.`, { tasks, taskId });
			}
			return textResult(`Updated task #${taskId}: ${updatedFields.join(", ")}`, { tasks, taskId });
		},
		renderCall(args, theme, context) {
			return renderToolCallRow("task_update", `#${String(args.taskId ?? "")}`, theme, context);
		},
		renderResult(result, _options, theme, context) {
			const text = (context as { lastComponent?: Text } | undefined)?.lastComponent ?? new Text("", 0, 0);
			text.setText(renderTaskListResult(result as never, theme));
			return text;
		},
	};
}

// ─── AgentTool wrappers ────────────────────────────────────────────

export function createTaskCreateTool(): AgentTool<typeof TASK_CREATE_SCHEMA> {
	return wrapToolDefinition(createTaskCreateToolDefinition());
}
export function createTaskGetTool(): AgentTool<typeof TASK_GET_SCHEMA> {
	return wrapToolDefinition(createTaskGetToolDefinition());
}
export function createTaskListTool(): AgentTool<typeof TASK_LIST_SCHEMA> {
	return wrapToolDefinition(createTaskListToolDefinition());
}
export function createTaskUpdateTool(): AgentTool<typeof TASK_UPDATE_SCHEMA> {
	return wrapToolDefinition(createTaskUpdateToolDefinition());
}

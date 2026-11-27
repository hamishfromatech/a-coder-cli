/**
 * TaskPanel — collapsible inline task board above the editor (desktop
 * TodoPanel + TaskPanel parity). Renders the persistent task graph first,
 * then legacy todos, whenever either has content:
 *
 *   ☰ TASKS · 3/8 done · ▰▰▱▱▱▱ · 1 active · 2 blocked · 0/2 todos
 *   IN PROGRESS
 *   → #4 Wiring auth · @backend
 *   NEXT
 *   ○ #5 Add tests
 *   BLOCKED
 *   ○ #6 Docs · ⤷ #4, #5
 *   DONE
 *   ✓ #1 Scaffold
 *   TODOS
 *   ✓ set up the harness
 *
 * Collapsible via app.tasks.toggle (ctrl+o): boards larger than
 * AUTO_COLLAPSE_THRESHOLD items auto-collapse to the header plus the
 * in-progress rows, and a toggle hint derived from the keybindings config
 * is shown (never a hardcoded key). Zero lines when empty.
 */

import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { Task } from "../../../core/tasks/task-store.ts";
import type { TodoItem } from "../../../core/tools/todo.ts";
import { theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

const AUTO_COLLAPSE_THRESHOLD = 8;
const PROGRESS_BAR_WIDTH = 6;

const STATUS_GLYPH: Record<Task["status"], string> = {
	pending: "○",
	in_progress: "→",
	completed: "✓",
};

export class TaskPanelComponent implements Component {
	private todos: TodoItem[] = [];
	private tasks: Task[] = [];
	private collapsed = false;
	/** Set once the user toggles manually — auto-collapse then yields to them. */
	private userToggled = false;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private lastRenderAt = 0;

	handleInput(_data: string): void {
		// Display only; toggling is wired through app.tasks.toggle.
	}

	update(todos: TodoItem[], tasks: Task[]): void {
		const total = todos.length + tasks.length;

		if (total === 0) {
			// Session reset — clear board and auto-collapse state.
			this.todos = [];
			this.tasks = [];
			this.collapsed = false;
			this.userToggled = false;
			this.cachedLines = undefined;
			return;
		}

		const crossedLarge = this.total() <= AUTO_COLLAPSE_THRESHOLD && total > AUTO_COLLAPSE_THRESHOLD;
		const crossedBack = this.total() > AUTO_COLLAPSE_THRESHOLD && total <= AUTO_COLLAPSE_THRESHOLD;
		this.todos = todos;
		this.tasks = tasks;

		if (!this.userToggled) {
			if (crossedLarge) this.collapsed = true;
			else if (crossedBack) this.collapsed = false;
		} else if (crossedBack) {
			// Leaving large-board territory clears the manual override.
			this.userToggled = false;
			this.collapsed = false;
		}
		this.cachedLines = undefined;
	}

	/** Expand/collapse (app.tasks.toggle). Marks the user as in control of the
	 *  collapsed state so auto-collapse stops overriding them. */
	toggle(): void {
		this.userToggled = true;
		this.collapsed = !this.collapsed;
		this.cachedLines = undefined;
	}

	private total(): number {
		return this.todos.length + this.tasks.length;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (
			this.cachedLines &&
			this.cachedWidth === width &&
			this.lastRenderAt > 0 &&
			Date.now() - this.lastRenderAt < 1000
		) {
			return this.cachedLines;
		}
		this.lastRenderAt = Date.now();
		this.cachedWidth = width;

		if (this.total() === 0) {
			this.cachedLines = [];
			return this.cachedLines;
		}

		const taskById = new Map(this.tasks.map((task) => [String(task.id), task]));
		const doneTasks = this.tasks.filter((task) => task.status === "completed");
		const inProgressTasks = this.tasks.filter((task) => task.status === "in_progress");
		const pendingTasks = this.tasks.filter((task) => task.status === "pending");
		const blockedTasks = pendingTasks.filter((task) => unresolvedBlockers(task, taskById).length > 0);
		const nextTasks = pendingTasks.filter((task) => unresolvedBlockers(task, taskById).length === 0);
		const doneTodos = this.todos.filter((todo) => todo.status === "completed").length;
		const inProgressTodos = this.todos.filter((todo) => todo.status === "in_progress");
		const inProgressCount = inProgressTasks.length + inProgressTodos.length;

		const lines: string[] = [];
		const parts: string[] = [];
		parts.push(theme.fg("accent", theme.bold(this.tasks.length > 0 ? "☰ TASKS" : "☰ TODOS")));
		if (this.tasks.length > 0) {
			parts.push(theme.fg("muted", `${doneTasks.length}/${this.tasks.length} done`));
			parts.push(progressBar(doneTasks.length, this.tasks.length));
		}
		if (inProgressCount > 0) parts.push(theme.fg("accent", `${inProgressCount} active`));
		if (blockedTasks.length > 0) parts.push(theme.fg("warning", `${blockedTasks.length} blocked`));
		if (this.todos.length > 0) parts.push(theme.fg("muted", `${doneTodos}/${this.todos.length} todos`));
		const join = theme.fg("dim", " · ");
		const header =
			parts.join(join) +
			(this.collapsed ? theme.fg("dim", ` · ${keyText("app.tasks.toggle") || "ctrl+o"} to expand`) : "");
		lines.push(truncateToWidth(header, width));

		if (this.collapsed) {
			// Collapsed: header + whatever is running right now. Keep the panel
			// short even when several tasks are active at once.
			const active: string[] = [];
			for (const task of inProgressTasks) {
				active.push(
					`  ${theme.fg("accent", "→")} ${theme.fg("dim", `#${task.id}`)} ${theme.fg(
						"text",
						task.activeForm || task.subject,
					)}`,
				);
			}
			for (const todo of inProgressTodos) {
				active.push(`  ${theme.fg("accent", "→")} ${theme.fg("text", todo.activeForm || todo.text)}`);
			}
			for (const line of active.slice(0, 3)) lines.push(truncateToWidth(line, width));
			if (active.length > 3) {
				lines.push(truncateToWidth(theme.fg("dim", `  … ${active.length - 3} more active`), width));
			}
			this.cachedWidth = width;
			this.cachedLines = lines;
			return this.cachedLines;
		}

		renderTaskSection(lines, width, "IN PROGRESS", inProgressTasks, taskById);
		renderTaskSection(lines, width, "NEXT", nextTasks, taskById);
		renderTaskSection(lines, width, "BLOCKED", blockedTasks, taskById);
		renderTaskSection(lines, width, "DONE", doneTasks, taskById);

		if (this.todos.length > 0) {
			lines.push(
				truncateToWidth(`  ${theme.fg("dim", "TODOS")} ${theme.fg("dim", String(this.todos.length))}`, width),
			);
			for (const todo of this.todos) lines.push(truncateToWidth(todoRow(todo), width));
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return this.cachedLines;
	}
}

function progressBar(done: number, total: number): string {
	const filled =
		total <= 0 ? 0 : Math.max(0, Math.min(PROGRESS_BAR_WIDTH, Math.round((done / total) * PROGRESS_BAR_WIDTH)));
	return theme.fg("success", "▰".repeat(filled)) + theme.fg("dim", "▱".repeat(PROGRESS_BAR_WIDTH - filled));
}

function unresolvedBlockers(task: Task, byId: Map<string, Task>): string[] {
	return task.blockedBy.filter((id) => byId.get(String(id))?.status !== "completed");
}

function renderTaskSection(
	lines: string[],
	width: number,
	label: string,
	tasks: Task[],
	byId: Map<string, Task>,
): void {
	if (tasks.length === 0) return;
	lines.push(truncateToWidth(`  ${theme.fg("dim", label)} ${theme.fg("dim", String(tasks.length))}`, width));
	const sorted = tasks.slice().sort((a, b) => Number(a.id) - Number(b.id));
	for (const task of sorted) lines.push(truncateToWidth(taskRow(task, byId), width));
}

function todoRow(t: TodoItem): string {
	const glyph =
		t.status === "completed"
			? theme.fg("success", "✓")
			: t.status === "in_progress"
				? theme.fg("accent", "→")
				: theme.fg("dim", "○");
	const text = t.status === "completed" ? theme.fg("dim", t.text) : theme.fg("text", t.text);
	return `  ${glyph} ${text}`;
}

function taskRow(task: Task, byId: Map<string, Task>): string {
	const glyph = theme.fg(
		task.status === "completed" ? "success" : task.status === "in_progress" ? "accent" : "dim",
		STATUS_GLYPH[task.status],
	);
	const primary = task.status === "in_progress" ? task.activeForm || task.subject : task.subject;
	const subject =
		task.status === "completed"
			? theme.fg("dim", primary)
			: task.status === "in_progress"
				? theme.fg("accent", primary)
				: theme.fg("text", primary);

	const tags: string[] = [];
	if (task.owner) tags.push(theme.fg("dim", `@${task.owner}`));
	const blockers = unresolvedBlockers(task, byId);
	if (task.status !== "completed" && blockers.length > 0) {
		tags.push(theme.fg("warning", `⤷ ${blockers.map((id) => `#${id}`).join(", ")}`));
	}
	const extras = tags.length > 0 ? ` ${tags.join(theme.fg("dim", " · "))}` : "";
	return `  ${glyph} ${theme.fg("dim", `#${task.id}`)} ${subject}${extras}`;
}

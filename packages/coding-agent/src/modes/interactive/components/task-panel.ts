/**
 * TaskPanel — collapsible inline task board above the editor (desktop
 * TodoPanel + TaskPanel parity). Renders the live todo list and the
 * persistent task graph whenever either has content:
 *
 *   ☰ TASKS · 2/5 todos · 3/8 tasks · 1 in progress
 *   TODOS
 *   ✓ set up the harness
 *   → refactor login · in progress
 *   ○ write docs
 *   TASK GRAPH
 *   → #3 wire auth · owner: backend · blocked
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

		const doneTodos = this.todos.filter((t) => t.status === "completed").length;
		const doneTasks = this.tasks.filter((t) => t.status === "completed").length;
		const inProgress = [
			...this.todos.filter((t) => t.status === "in_progress"),
			...this.tasks.filter((t) => t.status === "in_progress"),
		];

		const lines: string[] = [];
		const parts: string[] = [theme.fg("accent", "☰ TASKS")];
		if (this.todos.length > 0) {
			parts.push(theme.fg("muted", `${doneTodos}/${this.todos.length} todos`));
		}
		if (this.tasks.length > 0) {
			parts.push(theme.fg("muted", `${doneTasks}/${this.tasks.length} tasks`));
		}
		if (inProgress.length > 0) {
			parts.push(theme.fg("dim", `${inProgress.length} in progress`));
		}
		const header =
			parts.join(theme.fg("dim", " · ")) +
			(this.collapsed ? theme.fg("dim", ` · ${keyText("app.tasks.toggle") || "ctrl+o"} to expand`) : "");
		lines.push(truncateToWidth(header, width));

		if (this.collapsed) {
			// Collapsed: header + whatever is running right now.
			for (const todo of this.todos.filter((t) => t.status === "in_progress")) {
				const glyph = theme.fg("accent", "→");
				const label = todo.activeForm || todo.text;
				lines.push(truncateToWidth(`  ${glyph} ${theme.fg("text", label)}`, width));
			}
			for (const task of this.tasks.filter((t) => t.status === "in_progress")) {
				lines.push(
					truncateToWidth(
						`  ${theme.fg("accent", "→")} ${theme.fg("text", `#${task.id} ${task.activeForm || task.subject}`)}`,
						width,
					),
				);
			}
			this.cachedWidth = width;
			this.cachedLines = lines;
			return this.cachedLines;
		}

		const both = this.todos.length > 0 && this.tasks.length > 0;
		if (both) lines.push(truncateToWidth(theme.fg("dim", "  TODOS"), width));
		for (const todo of this.todos) lines.push(truncateToWidth(todoRow(todo), width));
		if (this.tasks.length > 0) {
			if (both) lines.push(truncateToWidth(theme.fg("dim", "  TASK GRAPH"), width));
			const sorted = this.tasks.slice().sort((a, b) => Number(a.id) - Number(b.id));
			for (const task of sorted) lines.push(truncateToWidth(taskRow(task), width));
		}
		this.cachedWidth = width;
		this.cachedLines = lines;
		return this.cachedLines;
	}
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

function taskRow(task: Task): string {
	const glyph = theme.fg(
		task.status === "completed" ? "success" : task.status === "in_progress" ? "accent" : "dim",
		STATUS_GLYPH[task.status],
	);

	const bits: string[] = [`#${task.id} ${task.subject}`];
	if (task.owner) bits.push(`owner: ${task.owner}`);
	if (task.blockedBy.length > 0 && task.status !== "completed") {
		bits.push(theme.fg("muted", `blocked by ${task.blockedBy.length}`));
	}

	const subject =
		task.status === "completed"
			? theme.fg("dim", bits[0])
			: task.status === "in_progress"
				? theme.fg("accent", bits[0])
				: theme.fg("text", bits[0]);
	const extras = bits.length > 1 ? theme.fg("dim", ` · ${bits.slice(1).join(" · ")}`) : "";
	return `  ${glyph} ${subject}${extras}`;
}

import { type Component, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { TodoItem } from "../../../core/tools/todo.ts";
import { theme } from "../theme/theme.ts";

/**
 * TUI panel for the `/todos` command. Renders the latest `todo` tool list on
 * the current branch as a checklist with a done/total count. Press Escape or
 * Ctrl+C to close. Mirrors the desktop's inline `TodoPanel` so both surfaces
 * show the same list.
 */
export class TodoListComponent implements Component {
	private todos: TodoItem[];
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(todos: TodoItem[], onClose: () => void) {
		this.todos = todos;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const th = theme;
		const lines: string[] = [""];

		const title = th.fg("accent", " Tasks ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.todos.length === 0) {
			lines.push(
				truncateToWidth(`  ${th.fg("dim", "No tasks yet. Ask the agent to plan with the todo tool.")}`, width),
			);
		} else {
			const done = this.todos.filter((t) => t.status === "completed").length;
			const inProgress = this.todos.filter((t) => t.status === "in_progress").length;
			const parts = [`${done}/${this.todos.length} completed`];
			if (inProgress > 0) parts.push(`${inProgress} in progress`);
			lines.push(truncateToWidth(`  ${th.fg("muted", parts.join(" · "))}`, width));
			lines.push("");

			for (const t of this.todos) {
				const glyph =
					t.status === "completed"
						? th.fg("success", "✓")
						: t.status === "in_progress"
							? th.fg("accent", "→")
							: th.fg("dim", "○");
				const text = t.status === "completed" ? th.fg("dim", t.text) : th.fg("text", t.text);
				lines.push(truncateToWidth(`  ${glyph} ${text}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

/** Read the latest `todo` tool list from a session branch (newest first). */
export function readTodosFromBranch(branch: Array<{ type: string; message?: unknown }>): TodoItem[] {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const msg = entry.message as { role?: string; toolName?: string; details?: { todos?: TodoItem[] } } | undefined;
		if (!msg || msg.role !== "toolResult" || msg.toolName !== "todo") continue;
		return msg.details?.todos ?? [];
	}
	return [];
}

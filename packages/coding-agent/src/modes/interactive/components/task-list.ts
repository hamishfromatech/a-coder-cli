import { type Component, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Task } from "../../../core/tasks/task-store.ts";
import { theme } from "../theme/theme.ts";

/**
 * TUI panel for the `/tasks` command. Renders the persistent task graph for
 * the current session — read live from disk so it stays accurate even when the
 * list changed outside the conversation. Dependency info (blocked-by) and
 * owners are shown per row. Press Escape or Ctrl+C to close.
 */

const STATUS_GLYPH: Record<Task["status"], string> = {
	pending: "○",
	in_progress: "→",
	completed: "✓",
};

export class TaskListComponent implements Component {
	private tasks: Task[];
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(tasks: Task[], onClose: () => void) {
		this.tasks = tasks;
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

		const title = th.fg("accent", " Task Graph ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 13)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.tasks.length === 0) {
			lines.push(
				truncateToWidth(
					`  ${th.fg("dim", "No tasks yet. Ask the agent to plan with the task_create tool.")}`,
					width,
				),
			);
		} else {
			const sorted = this.tasks.slice().sort((a, b) => Number(a.id) - Number(b.id));
			const done = sorted.filter((t) => t.status === "completed").length;
			const inProgress = sorted.filter((t) => t.status === "in_progress").length;
			const parts = [`${done}/${sorted.length} done`];
			if (inProgress > 0) parts.push(`${inProgress} in progress`);
			lines.push(truncateToWidth(`  ${th.fg("muted", parts.join(" · "))}`, width));
			lines.push("");

			const unresolvedIds = new Set(sorted.filter((t) => t.status !== "completed").map((t) => t.id));
			for (const task of sorted) {
				const glyph =
					task.status === "completed"
						? th.fg("success", STATUS_GLYPH.completed)
						: task.status === "in_progress"
							? th.fg("accent", STATUS_GLYPH.in_progress)
							: th.fg("dim", STATUS_GLYPH.pending);
				const subject = task.status === "completed" ? th.fg("dim", task.subject) : th.fg("text", task.subject);
				const id = th.fg("dim", `#${task.id}`);
				const owner = task.owner ? ` ${th.fg("muted", `(${task.owner})`)}` : "";
				const openBlockers = task.blockedBy.filter((id2) => unresolvedIds.has(id2));
				const blocked =
					openBlockers.length > 0
						? ` ${th.fg("muted", `[blocked by ${openBlockers.map((id2) => `#${id2}`).join(", ")}]`)}`
						: "";
				const body = task.status === "in_progress" && task.activeForm ? th.fg("text", task.activeForm) : subject;
				lines.push(truncateToWidth(`  ${glyph} ${id} ${body}${owner}${blocked}`, width));
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

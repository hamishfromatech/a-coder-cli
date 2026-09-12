/**
 * StatusRail — the single consolidated line for background activity, rendered
 * flush below the editor box:
 *
 *   ⚡ 2 running · backend (5 tools, 1.2k tok, 8s) · npm run dev (12s, 1.2KB)      ↓ tasks
 *
 * Replaces the former trio of surfaces (inline ⚙ AGENTS card, ⚡ background
 * agents bar, ▸ background processes bar): sub-agents and background terminal
 * processes now share one row. Full drill-down stays in the running-tasks
 * viewer (plain Down from an empty editor / app.tasks.view). Renders zero
 * lines when nothing is running so the row collapses entirely.
 */

import { type Component, getKeybindings, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { InProcessSubAgentRecord } from "../../../core/extensions/types.ts";
import type { BackgroundProcessRecord } from "../../../core/stores/background-process-store.ts";
import { formatDuration } from "../../../utils/duration.ts";
import { theme } from "../theme/theme.ts";
import { formatKeyText } from "./keybinding-hints.ts";

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
	return `${(n / 1000000).toFixed(1)}M`;
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** One line per item: collapse whitespace, cap length. */
function oneLine(text: string, maxLen: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= maxLen ? flat : `${flat.slice(0, maxLen - 1)}…`;
}

/** Dim right-aligned hint for the running-tasks viewer keybinding. */
function tasksHint(): string {
	const keys = getKeybindings().getKeys("app.tasks.view");
	if (keys.length === 0) return "";
	// Plain "down" reads better as the arrow glyph it produces.
	const part = keys[0].split("/")[0].split("+").pop() ?? "";
	const glyph = part.toLowerCase() === "down" ? "↓" : formatKeyText(part);
	return `${glyph} tasks`;
}

export class StatusRailComponent implements Component {
	private subAgents: InProcessSubAgentRecord[] = [];
	private processes: BackgroundProcessRecord[] = [];
	private cachedWidth?: number;
	private cachedLines?: string[];
	private lastRenderAt = 0;

	update(subAgents: InProcessSubAgentRecord[], processes: BackgroundProcessRecord[]): void {
		this.subAgents = subAgents;
		this.processes = processes;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	/** Force a re-render (elapsed-time tick while anything is running). */
	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(_data: string): void {
		// No key handling — display only. Drill-down lives in the
		// running-tasks viewer (app.tasks.view).
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width && Date.now() - this.lastRenderAt < 500) {
			return this.cachedLines;
		}
		this.lastRenderAt = Date.now();
		this.cachedWidth = width;

		const runningSubs = this.subAgents.filter((r) => r.status === "running");
		const runningProcs = this.processes.filter((r) => r.status === "running");
		const runningCount = runningSubs.length + runningProcs.length;
		if (runningCount === 0) {
			this.cachedLines = [];
			return this.cachedLines;
		}

		const summaries: string[] = [];
		for (const sub of runningSubs) {
			const label = sub.teammateName ? `@${sub.teammateName}` : sub.agentType;
			const parts = [`${sub.toolUseCount} tool${sub.toolUseCount === 1 ? "" : "s"}`];
			if (sub.totalTokens && sub.totalTokens > 0) parts.push(`${formatTokens(sub.totalTokens)} tok`);
			parts.push(formatDuration(Date.now() - sub.startedAt));
			summaries.push(`${theme.fg("text", oneLine(label, 24))} ${theme.fg("muted", `(${parts.join(", ")})`)}`);
		}
		for (const proc of runningProcs) {
			const parts = [formatDuration(Date.now() - proc.startedAt)];
			if (proc.totalBytes > 0) parts.push(formatBytes(proc.totalBytes));
			summaries.push(`${theme.fg("text", oneLine(proc.command, 32))} ${theme.fg("muted", `(${parts.join(", ")})`)}`);
		}

		const hint = tasksHint();
		const main =
			theme.fg("accent", "⚡") +
			" " +
			theme.fg("accent", `${runningCount} running`) +
			theme.fg("dim", " · ") +
			summaries.join(theme.fg("dim", " · "));

		if (hint) {
			const hintWidth = visibleWidth(hint) + 2;
			if (visibleWidth(main) + hintWidth <= width) {
				const padding = " ".repeat(width - visibleWidth(main) - visibleWidth(hint));
				this.cachedLines = [main + padding + theme.fg("dim", hint)];
				return this.cachedLines;
			}
		}

		this.cachedLines = [truncateToWidth(main, width)];
		return this.cachedLines;
	}
}

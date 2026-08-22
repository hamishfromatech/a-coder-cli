/**
 * BackgroundAgentsBar — persistent footer line for running background
 * sub-agents. Ports easy-agent's BackgroundAgentBar:
 *
 *   ⚡ 2 running · Explore (3 tools, 1.2k tokens, 4s) · reviewer (5 tools, 2.4k tokens, 8s)
 *
 * Rendered only while at least one sub-agent is running — returns an empty
 * render otherwise so the TUI collapses the row entirely. Settled agents are
 * not shown (the completion notification is the surface for those).
 */

import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { InProcessSubAgentRecord } from "../../../core/extensions/types.ts";
import { theme } from "../theme/theme.ts";

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
	const min = Math.floor(sec / 60);
	return `${min}m${Math.round(sec - min * 60)}s`;
}

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
	return `${(n / 1000000).toFixed(1)}M`;
}

export class BackgroundAgentsBarComponent implements Component {
	private records: InProcessSubAgentRecord[] = [];
	private cachedWidth?: number;
	private cachedLines?: string[];
	private lastRenderAt = 0;

	update(records: InProcessSubAgentRecord[]): void {
		this.records = records;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	/** Force a re-render (elapsed time tick). */
	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(_data: string): void {
		// No key handling — display only.
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width && Date.now() - this.lastRenderAt < 500) {
			return this.cachedLines;
		}
		this.lastRenderAt = Date.now();
		this.cachedWidth = width;

		const running = this.records.filter((r) => r.status === "running");
		if (running.length === 0) {
			this.cachedLines = [];
			return this.cachedLines;
		}

		const summaries = running.map((r) => {
			const label = r.teammateName ?? r.agentType;
			const parts = [`${r.toolUseCount} tool${r.toolUseCount === 1 ? "" : "s"}`];
			if (r.totalTokens && r.totalTokens > 0) parts.push(`${formatTokens(r.totalTokens)} tokens`);
			parts.push(formatDuration(Date.now() - r.startedAt));
			return `${theme.fg("text", label)} ${theme.fg("muted", `(${parts.join(", ")})`)}`;
		});

		const line =
			theme.fg("accent", "⚡") +
			" " +
			theme.fg("muted", `${running.length} running`) +
			theme.fg("dim", " · ") +
			summaries.join(theme.fg("dim", " · "));

		this.cachedLines = [truncateToWidth(line, width)];
		return this.cachedLines;
	}
}

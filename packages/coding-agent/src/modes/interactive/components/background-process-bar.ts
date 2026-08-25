/**
 * BackgroundProcessesBar — persistent footer line for running background
 * bash processes. Mirrors BackgroundAgentsBarComponent:
 *
 *   ▸ 2 running · npm run dev (12s, 1.2KB) · webpack --watch (45s, 8.4KB)
 *
 * Rendered only while at least one background process is running — returns
 * an empty render otherwise so the TUI collapses the row entirely. Completed
 * processes are not shown (the completion is surfaced via the tool result).
 */

import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { BackgroundProcessRecord } from "../../../core/stores/background-process-store.ts";
import { formatDuration } from "../../../utils/duration.ts";
import { theme } from "../theme/theme.ts";

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function truncateCommand(cmd: string, maxLen: number): string {
	if (cmd.length <= maxLen) return cmd;
	return `${cmd.slice(0, maxLen - 1)}…`;
}

export class BackgroundProcessesBarComponent implements Component {
	private records: BackgroundProcessRecord[] = [];
	private cachedWidth?: number;
	private cachedLines?: string[];
	private lastRenderAt = 0;

	update(records: BackgroundProcessRecord[]): void {
		this.records = records;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

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
			const cmd = truncateCommand(r.command, 30);
			const parts = [formatDuration(Date.now() - r.startedAt)];
			if (r.totalBytes > 0) parts.push(formatBytes(r.totalBytes));
			return `${theme.fg("text", cmd)} ${theme.fg("muted", `(${parts.join(", ")})`)}`;
		});

		const line =
			theme.fg("accent", "▸") +
			" " +
			theme.fg("muted", `${running.length} bg`) +
			theme.fg("dim", " · ") +
			summaries.join(theme.fg("dim", " · "));

		this.cachedLines = [truncateToWidth(line, width)];
		return this.cachedLines;
	}
}

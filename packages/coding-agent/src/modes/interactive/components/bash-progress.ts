/**
 * Live tail component for a running Bash command.
 *
 * Subscribes to the bash-progress store (keyed by tool call id) and renders
 * the last few output lines + a status row (line count, elapsed, timeout,
 * bytes) while the command runs. Mirrors easy-agent's BashProgressBody.
 *
 * The store emits on a throttled cadence (~10fps) plus a 1s heartbeat, so
 * the elapsed clock advances even for silent commands. On completion the
 * store emits a final snapshot with `done: true`; this component then stops
 * subscribing and the ToolExecutionComponent falls back to the normal
 * result renderer.
 */

import { type Component, Container, type TUI } from "@earendil-works/pi-tui";
import type { BashProgress } from "../../../core/stores/bash-progress-store.ts";
import { subscribeBashProgress } from "../../../core/stores/bash-progress-store.ts";
import { formatSize } from "../../../core/tools/truncate.ts";
import { theme } from "../theme/theme.ts";

const BASH_TAIL_LINES = 5;

function formatDuration(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	if (totalSec < 60) return `${totalSec}s`;
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	return sec > 0 ? `${min}m${sec}s` : `${min}m`;
}

function shellTimeHint(elapsedMs: number, timeoutMs?: number): string {
	const timeout = timeoutMs ? formatDuration(timeoutMs) : undefined;
	const elapsed = formatDuration(elapsedMs);
	return timeout ? `(${elapsed} · timeout ${timeout})` : `(${elapsed})`;
}

export class BashProgressComponent extends Container {
	private toolCallId: string;
	private ui: TUI;
	private unsubscribe?: () => void;
	private currentSnapshot?: BashProgress;
	private cachedWidth: number | undefined;
	private cachedLines: string[] = [];

	constructor(toolCallId: string, ui: TUI) {
		super();
		this.toolCallId = toolCallId;
		this.ui = ui;

		this.unsubscribe = subscribeBashProgress((id: string, snapshot: BashProgress | undefined) => {
			if (id !== this.toolCallId) return;
			this.currentSnapshot = snapshot;
			this.cachedWidth = undefined; // force re-truncate
			this.invalidate();
			this.ui.requestRender();
		});
	}

	dispose(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
	}

	private renderLines(_width: number): string[] {
		const snapshot = this.currentSnapshot;
		if (!snapshot) {
			return [theme.fg("muted", "Running…")];
		}

		const elapsedMs = Math.max(0, Date.now() - snapshot.startTime);
		const allLines = snapshot.output.split("\n").filter((l: string) => l.length > 0);
		const tail = allLines.slice(-BASH_TAIL_LINES);

		// No output yet → just the running hint with time/timeout.
		if (tail.length === 0) {
			return [theme.fg("muted", `Running… ${shellTimeHint(elapsedMs, snapshot.timeoutMs)}`)];
		}

		// `+N lines`  → exact overflow past the shown tail.
		// `~N lines`  → the preview buffer dropped earlier lines (approximate).
		const retainedCount = snapshot.output.split("\n").length;
		const previewDroppedLines = snapshot.totalLines > retainedCount;
		const extraLines = Math.max(0, snapshot.totalLines - BASH_TAIL_LINES);
		let lineStatus = "";
		if (extraLines > 0) {
			lineStatus = previewDroppedLines ? `~${snapshot.totalLines} lines` : `+${extraLines} lines`;
		}

		const statusBits = [
			lineStatus,
			shellTimeHint(elapsedMs, snapshot.timeoutMs),
			snapshot.totalBytes > 0 ? formatSize(snapshot.totalBytes) : "",
		].filter(Boolean);

		const lines: string[] = [];
		for (const l of tail) {
			lines.push(theme.fg("muted", l.length > 0 ? l : " "));
		}
		if (statusBits.length > 0) {
			lines.push(theme.fg("muted", statusBits.join("  ")));
		}
		return lines;
	}

	override render(width: number): string[] {
		if (this.cachedWidth !== width) {
			this.cachedWidth = width;
			this.cachedLines = this.renderLines(width);
		}
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
	}
}

/**
 * A renderable component wrapper for use inside tool renderers that need
 * to return a Component object (not just render lines).
 */
export function createBashProgressRenderable(toolCallId: string, ui: TUI): Component {
	const comp = new BashProgressComponent(toolCallId, ui);
	return comp;
}

/**
 * AgentsPanel — unified inline status card for background sub-agents and
 * background terminal processes (parity with the desktop RuntimePanel):
 *
 *   ⚙ AGENTS · 2 running · 4 total
 *   SUB-AGENTS
 *   ⚡ Agent[Explore] · map the auth flow · 3 tools · 1.2k tok · 12s
 *   ✓ Agent[Coder] · done · 7 tools · 4 / 45s
 *   BACKGROUND
 *   ▸ npm run dev · 12s · 1.2KB
 *   ✓ webpack --watch · done · 4 / 45s · 8.4KB
 *
 * Behavior:
 *   - foreground (non-detached) sub-agents render only while running — their
 *     result lands in the transcript as the tool result
 *   - detached sub-agents and finished background processes persist with a
 *     terminal glyph for FINISHED_TTL_MS, then drop
 *   - durations tick live; the host (InteractiveMode.syncAgentsPanel) drives
 *     a 1s invalidate while anything is running
 *   - renders zero lines when there is nothing to show, collapsing the row
 *
 * The footer background-processes bar and the running-tasks viewer
 * (app.subagents.view) remain mounted; this panel is the inline transcript
 * companion, matching the desktop's RuntimePanel.
 */

import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { InProcessSubAgentRecord } from "../../../core/extensions/types.ts";
import type { BackgroundProcessRecord } from "../../../core/stores/background-process-store.ts";
import { formatDuration } from "../../../utils/duration.ts";
import { theme } from "../theme/theme.ts";

/** Finished runs stay visible with a terminal glyph for this long. */
const FINISHED_TTL_MS = 120_000;

const isStale = (finishedAt: number): boolean => Date.now() - finishedAt > FINISHED_TTL_MS;

function subVisible(sub: InProcessSubAgentRecord): boolean {
	if (sub.status === "running") return true;
	// Foreground (awaited) sub-agents drop immediately: the tool result in the
	// transcript is the durable record. Detached ones linger via the TTL.
	if (!sub.detached) return false;
	return !isStale(sub.updatedAt);
}

function processVisible(proc: BackgroundProcessRecord): boolean {
	if (proc.status === "running") return true;
	return !isStale(proc.endedAt ?? proc.startedAt);
}

function formatNumber(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}m`;
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** One command per row: collapse whitespace, cap length. */
function oneLine(cmd: string, maxLen: number): string {
	const flat = cmd.replace(/\s+/g, " ").trim();
	return flat.length <= maxLen ? flat : `${flat.slice(0, maxLen - 1)}…`;
}

export class AgentsPanelComponent implements Component {
	private subAgents: InProcessSubAgentRecord[] = [];
	private processes: BackgroundProcessRecord[] = [];
	private cachedWidth?: number;
	private cachedLines?: string[];
	private lastRenderAt = 0;

	update(subAgents: InProcessSubAgentRecord[], processes: BackgroundProcessRecord[]): void {
		this.subAgents = subAgents;
		this.processes = processes;
		this.cachedLines = undefined;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(_data: string): void {
		// No key handling — display only. Details live in the
		// app.subagents.view running-tasks viewer.
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width && Date.now() - this.lastRenderAt < 500) {
			return this.cachedLines;
		}
		this.lastRenderAt = Date.now();
		this.cachedWidth = width;

		const subs = this.subAgents.filter((r) => subVisible(r));
		const procs = this.processes.filter((r) => processVisible(r));
		if (subs.length === 0 && procs.length === 0) {
			this.cachedLines = [];
			return this.cachedLines;
		}

		const running =
			subs.filter((s) => s.status === "running").length + procs.filter((p) => p.status === "running").length;

		const lines: string[] = [];
		lines.push(
			theme.fg("accent", "⚙") +
				" " +
				theme.bold("AGENTS") +
				theme.fg("dim", " · ") +
				(running > 0 ? theme.fg("accent", `${running} running`) : theme.fg("dim", "idle")) +
				theme.fg("dim", ` · ${subs.length + procs.length} total`),
		);

		if (subs.length > 0) {
			lines.push(theme.fg("dim", "  SUB-AGENTS"));
			for (const sub of subs) lines.push(this.subAgentLine(sub, width));
		}
		if (procs.length > 0) {
			lines.push(theme.fg("dim", "  BACKGROUND"));
			for (const proc of procs) lines.push(this.processLine(proc, width));
		}

		this.cachedLines = lines.map((line) => truncateToWidth(line, width));
		return this.cachedLines;
	}

	private subAgentLine(sub: InProcessSubAgentRecord, width: number): string {
		const label = `Agent[${sub.teammateName ? `${sub.teammateName} · ` : ""}${sub.agentType}]`;
		const tools = `${sub.toolUseCount} tool use${sub.toolUseCount === 1 ? "" : "s"}`;
		const tokens = sub.totalTokens && sub.totalTokens > 0 ? ` · ${formatNumber(sub.totalTokens)} tok` : "";
		const goal = sub.goal ? ` · ${oneLine(sub.goal, Math.max(16, Math.floor(width / 4)))}` : "";

		if (sub.status === "running") {
			const last = sub.lastToolName ? ` · last: ${sub.lastToolName}` : "";
			return (
				theme.fg("accent", "⚡ ") +
				theme.bold(label) +
				theme.fg("muted", goal) +
				theme.fg("dim", ` · ${tools} · running${last}${tokens} · ${formatDuration(Date.now() - sub.startedAt)}`)
			);
		}
		const prefix =
			sub.status === "completed"
				? theme.fg("success", "✓ ")
				: sub.status === "killed"
					? theme.fg("warning", "⊘ ")
					: theme.fg("error", "✗ ");
		const state = sub.status === "completed" ? "done" : sub.status === "killed" ? "Killed" : "Failed";
		const err = sub.error ? theme.fg("error", ` · ${oneLine(sub.error, 60)}`) : "";
		return (
			prefix +
			theme.bold(label) +
			theme.fg("dim", ` · ${state} · ${tools}${tokens} · ${formatDuration(sub.updatedAt - sub.startedAt)}`) +
			err
		);
	}

	private processLine(proc: BackgroundProcessRecord, width: number): string {
		const cmd = theme.fg("text", oneLine(proc.command, Math.max(24, Math.floor(width / 2))));
		const elapsed = theme.fg("muted", `(${formatDuration((proc.endedAt ?? Date.now()) - proc.startedAt)})`);
		const parts: string[] = [];
		if (proc.totalBytes > 0) parts.push(formatBytes(proc.totalBytes));

		if (proc.status === "running") {
			return (
				theme.fg("accent", "▸ ") +
				cmd +
				" " +
				elapsed +
				theme.fg("dim", parts.length ? ` · ${parts.join(" · ")}` : "")
			);
		}
		if (proc.status === "done") {
			return (
				theme.fg("success", "✓ ") +
				theme.fg("text", oneLine(proc.command, Math.max(24, Math.floor(width / 2)))) +
				theme.fg("dim", ` · done${parts.length ? ` · ${parts.join(" · ")}` : ""}`)
			);
		}
		if (proc.status === "killed") {
			return theme.fg("warning", "⊘ ") + theme.fg("text", oneLine(proc.command, 40)) + theme.fg("dim", " · killed");
		}
		const exit = proc.exitCode !== undefined ? ` (exit ${proc.exitCode})` : "";
		return (
			theme.fg("error", "✗ ") +
			theme.fg("text", oneLine(proc.command, Math.max(24, Math.floor(width / 2)))) +
			theme.fg("error", ` · failed${exit}`)
		);
	}
}

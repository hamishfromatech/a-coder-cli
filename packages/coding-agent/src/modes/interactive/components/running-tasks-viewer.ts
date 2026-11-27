/**
 * RunningTasksViewer — unified picker + live view for running background bash
 * processes AND in-process sub-agents, mirroring Claude Code's Down-arrow
 * background-task navigation.
 *
 *   picking  — one list of every running (and recently finished) task, each
 *              tagged agent/bash, with command/goal, status, tools/tokens or
 *              bytes, and elapsed. Enter opens the live view.
 *   viewing  — live tail of the selected task: a sub-agent's timeline
 *              (text/tool uses/turns/completion) or a bash process's output
 *              tail.
 *
 * Esc or Left returns from viewing to picking, or closes from picking. 'k'
 * kills the selected/running task. Sub-agents are flat in a-coder-cli (they
 * cannot spawn children), so the list is flat — no tree.
 */

import { Container, getKeybindings, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { InProcessSubAgentRecord, SubAgentProgressEvent } from "../../../core/extensions/types.ts";
import type {
	BackgroundProcessRecord,
	BackgroundProcessStatus,
} from "../../../core/stores/background-process-store.ts";
import { formatDuration } from "../../../utils/duration.ts";
import { theme } from "../theme/theme.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

/** The slice of TUI surface this component needs (render ticker + height). */
interface TuiLike {
	requestRender: () => void;
	terminal: { rows: number };
}

/**
 * Host-provided side effects. The component never touches the clipboard, the
 * filesystem, or the agent directly, which keeps it renderable in isolation.
 */
export interface RunningTasksActions {
	/** Open a log file or worktree in the user's editor / OS handler. */
	openPath?: (path: string) => void | Promise<void>;
	/** Copy text to the system clipboard. */
	copyText?: (text: string) => void | Promise<void>;
	/** Short diff summary for a kept worktree (status + --stat), rendered inline. */
	diffStat?: (worktreePath: string) => string;
	/** Re-run a finished sub-agent; returns the new record id or a user-facing error. */
	rerunAgent?: (record: InProcessSubAgentRecord) => { id: string } | { error: string };
	/** Dismiss a finished sub-agent record. */
	removeAgent?: (record: InProcessSubAgentRecord) => boolean;
}

interface AgentItem {
	kind: "agent";
	record: InProcessSubAgentRecord;
}
interface BashItem {
	kind: "bash";
	record: BackgroundProcessRecord;
}
type TaskItem = AgentItem | BashItem;

const AGENT_STATUS_LABEL: Record<InProcessSubAgentRecord["status"], string> = {
	running: "running",
	completed: "done",
	failed: "failed",
	killed: "stopped",
};

const BASH_STATUS_LABEL: Record<BackgroundProcessStatus, string> = {
	running: "running",
	done: "done",
	error: "error",
	killed: "killed",
};

function formatTokens(n: number | undefined): string {
	if (!n || n <= 0) return "";
	if (n < 1000) return `${n} tok`;
	if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k tok`;
	return `${(n / 1000000).toFixed(1)}M tok`;
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function truncateText(text: string, maxLen: number): string {
	return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}

function formatChars(n: number): string {
	if (n < 1000) return `${n} chars`;
	if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k chars`;
	return `${(n / 1000000).toFixed(1)}M chars`;
}

/** `⎿ ok (1.2k chars): first line of output…` — dim detail under a finished tool. */
function formatToolResultDetail(event: { isError?: boolean; resultChars?: number; resultPreview?: string }): string {
	const status = event.isError ? "error" : "ok";
	const size = event.resultChars !== undefined && event.resultChars > 0 ? ` (${formatChars(event.resultChars)})` : "";
	const preview = event.resultPreview ? `: ${truncateText(event.resultPreview, 60)}` : "";
	if (!size && !preview) return `⎿ ${status}`;
	return `⎿ ${status}${size}${preview}`;
}

/** `— turn 2 · 1,842 tok (in 1,310, out 532)` — usage appended when known. */
function formatTurnLine(
	turnCount: number,
	usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined,
): string {
	if (!usage) return `— turn ${turnCount}`;
	const inTok = usage.inputTokens.toLocaleString();
	const outTok = usage.outputTokens.toLocaleString();
	return `— turn ${turnCount} · ${usage.totalTokens.toLocaleString()} tok (in ${inTok}, out ${outTok})`;
}

function itemStartedAt(item: TaskItem): number {
	return item.kind === "agent" ? item.record.startedAt : item.record.startedAt;
}

function itemId(item: TaskItem): string {
	return item.record.id;
}

function itemStatus(item: TaskItem): string {
	if (item.kind === "agent") {
		const status = item.record.status;
		return status === "running"
			? theme.fg("accent", AGENT_STATUS_LABEL[status])
			: status === "completed"
				? theme.fg("success", AGENT_STATUS_LABEL[status])
				: theme.fg("error", AGENT_STATUS_LABEL[status]);
	}
	const status = item.record.status;
	return status === "running"
		? theme.fg("accent", BASH_STATUS_LABEL[status])
		: status === "done"
			? theme.fg("success", BASH_STATUS_LABEL[status])
			: theme.fg("error", BASH_STATUS_LABEL[status]);
}

function itemLabel(item: TaskItem): string {
	if (item.kind === "agent") {
		const r = item.record;
		const name = r.teammateName ? `${r.teammateName} · ${r.agentType}` : r.agentType;
		return r.goal ? `${name}: ${truncateText(r.goal, 48)}` : name;
	}
	return `$ ${truncateText(item.record.command, 56)}`;
}

/** Compact right-hand metadata for the picker row. */
function shortItemMeta(item: TaskItem): string {
	const meta: string[] = [];
	if (item.kind === "agent") {
		const r = item.record;
		if (r.turnCount > 0) meta.push(`${r.turnCount}t`);
		if (r.toolUseCount > 0) meta.push(`${r.toolUseCount} tool${r.toolUseCount === 1 ? "" : "s"}`);
		const tokens = formatTokens(r.totalTokens);
		if (tokens) meta.push(tokens);
		meta.push(formatDuration((r.status === "running" ? Date.now() : r.updatedAt) - r.startedAt));
	} else {
		const r = item.record;
		if (r.totalBytes > 0) meta.push(formatBytes(r.totalBytes));
		meta.push(formatDuration((r.endedAt ?? Date.now()) - r.startedAt));
		if (r.exitCode !== undefined) meta.push(`exit ${r.exitCode}`);
	}
	return meta.join(" · ");
}

function statusGlyph(item: TaskItem): string {
	const status = item.record.status;
	if (status === "running") return theme.fg("accent", "●");
	if (status === "completed" || status === "done") return theme.fg("success", "✓");
	if (status === "failed" || status === "error") return theme.fg("error", "✗");
	return theme.fg("warning", "■");
}

function itemSummary(item: TaskItem): string {
	if (item.kind === "agent") {
		const r = item.record;
		const text = r.error ?? r.finalText;
		if (text?.trim()) return text.trim().split("\n")[0] ?? "";
		return r.goal ?? "";
	}
	return item.record.error ?? item.record.command;
}

/** Whether the picker should include finished tasks. Remembered across opens. */
let showFinishedDefault = true;

function isTaskRunning(item: TaskItem): boolean {
	return item.record.status === "running";
}

export class RunningTasksViewerComponent extends Container {
	/** Last render width; used for full-row selection and dividers. */
	private width = 120;
	/** Full snapshot (running + finished). */
	private allItems: TaskItem[] = [];
	/** Visible slice (respects the hide-finished toggle). */
	private items: TaskItem[] = [];
	private showFinished: boolean = showFinishedDefault;
	private mode: "picking" | "viewing" = "picking";
	private selectedIndex = 0;
	/** First visible picker row (the list window follows the cursor). */
	private scrollOffset = 0;
	private viewingId: string | undefined;
	/** Lines back from the latest timeline event / output line (0 = live tail) while viewing. */
	private viewScroll = 0;
	private onClose: () => void;
	private onKill: (item: TaskItem) => void;
	private actions: RunningTasksActions;
	private bodyContainer: Container;
	private hint: Text;
	private notice: string | undefined;
	/** 1s render ticker so elapsed/duration displays advance while idle. */
	private elapsedTimer: ReturnType<typeof setInterval> | undefined;
	private tui: TuiLike | undefined;

	constructor(
		subagents: InProcessSubAgentRecord[],
		backgrounds: BackgroundProcessRecord[],
		onClose: () => void,
		onKill: (item: TaskItem) => void,
		tui?: TuiLike,
		actions: RunningTasksActions = {},
	) {
		super();
		this.onClose = onClose;
		this.onKill = onKill;
		this.actions = actions;
		this.tui = tui;
		this.setItems(subagents, backgrounds);

		this.addChild(new Spacer(1));
		this.bodyContainer = new Container();
		this.addChild(this.bodyContainer);
		this.addChild(new Spacer(1));
		this.hint = new Text("", 1, 0);
		this.addChild(this.hint);

		this.rerender();
		this.startElapsedTicker();
	}

	/** Start the 1s elapsed ticker; stop when no item is running (or disposed). */
	private startElapsedTicker(): void {
		if (!this.tui || this.elapsedTimer) return;
		this.elapsedTimer = setInterval(() => {
			if (
				this.items.some((i) => (i.kind === "agent" ? i.record.status === "running" : i.record.status === "running"))
			) {
				this.tui?.requestRender();
			} else {
				this.stopElapsedTicker();
			}
		}, 1000);
		this.elapsedTimer.unref?.();
	}

	private stopElapsedTicker(): void {
		if (this.elapsedTimer) {
			clearInterval(this.elapsedTimer);
			this.elapsedTimer = undefined;
		}
	}

	/** Release the ticker; call when the viewer is removed from the screen. */
	dispose(): void {
		this.stopElapsedTicker();
	}

	/** Push fresh snapshots of both stores (live updates). */
	update(subagents: InProcessSubAgentRecord[], backgrounds: BackgroundProcessRecord[]): void {
		this.setItems(subagents, backgrounds);
		if (this.viewingId && !this.allItems.some((i) => itemId(i) === this.viewingId)) {
			this.mode = "picking";
			this.viewingId = undefined;
			this.viewScroll = 0;
		}
		this.rebuildVisibleItems();
		this.clampSelection();
		this.rerender();
		this.startElapsedTicker();
	}

	/** Keep the picker cursor inside the visible list. */
	private clampSelection(): void {
		if (this.selectedIndex >= this.items.length) {
			this.selectedIndex = Math.max(0, this.items.length - 1);
		}
		const maxOffset = Math.max(0, this.items.length - this.getViewportRows());
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
	}

	/** Height of the picker's scroll window (rows), adapted to the terminal. */
	private getViewportRows(): number {
		const rows = this.tui?.terminal.rows ?? 24;
		// Reserve room for the chat above, the viewer's chrome (header/spacers/
		// hint), and the status rail; never tiny, never the whole screen.
		const usable = rows - 10;
		return Math.max(4, Math.min(18, usable));
	}

	/** Keep the picker cursor inside the rendered window. */
	private keepCursorInWindow(): void {
		const viewRows = this.getViewportRows();
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + viewRows) {
			this.scrollOffset = this.selectedIndex - viewRows + 1;
		}
	}

	private setItems(subagents: InProcessSubAgentRecord[], backgrounds: BackgroundProcessRecord[]): void {
		const items: TaskItem[] = [
			...subagents.map((record): TaskItem => ({ kind: "agent", record })),
			...backgrounds.map((record): TaskItem => ({ kind: "bash", record })),
		];
		items.sort((a, b) => {
			const active = Number(isTaskRunning(b)) - Number(isTaskRunning(a));
			return active !== 0 ? active : itemStartedAt(b) - itemStartedAt(a);
		});
		this.allItems = items;
		this.rebuildVisibleItems();
	}

	/** Recompute the picker-visible list from the full snapshot. */
	private rebuildVisibleItems(): void {
		this.items = this.showFinished ? this.allItems : this.allItems.filter((i) => isTaskRunning(i));
	}

	private selectedItem(): TaskItem | undefined {
		return this.items[this.selectedIndex];
	}

	private viewItem(): TaskItem | undefined {
		return this.allItems.find((i) => itemId(i) === this.viewingId);
	}

	private rerender(): void {
		this.bodyContainer.clear();
		this.hint.setText("");
		if (this.mode === "picking") this.renderPicker();
		else this.renderView();
	}

	render(width: number): string[] {
		const nextWidth = Math.max(20, width);
		// The body is built before the first render (constructor), when the
		// terminal width is not known yet. Reflow it when the real width arrives
		// or the window is resized, so the selection bar and aligned metadata use
		// the full pane instead of the 120-column bootstrap width.
		if (nextWidth !== this.width) {
			this.width = nextWidth;
			this.rerender();
		}
		return super.render(width);
	}

	private renderPicker(): void {
		const activeCount = this.allItems.filter(isTaskRunning).length;
		const finishedCount = this.allItems.length - activeCount;
		const countText = this.showFinished
			? `${activeCount} active${finishedCount > 0 ? ` · ${finishedCount} finished` : ""}`
			: `${activeCount} active · finished hidden`;
		this.bodyContainer.addChild(
			new Text(`${theme.fg("accent", theme.bold("Background tasks"))}  ${theme.fg("muted", countText)}`, 1, 0),
		);
		if (this.items.length === 0) {
			this.bodyContainer.addChild(new Spacer(1));
			this.bodyContainer.addChild(
				new Text(
					theme.fg(
						"muted",
						this.showFinished
							? "No background tasks. Run a command with background: true or spawn a sub-agent."
							: "No running tasks — press h to show finished runs.",
					),
					1,
					0,
				),
			);
			this.bodyContainer.addChild(
				new Text(theme.fg("dim", "Background bash and sub-agents will appear here while they run."), 1, 0),
			);
		}

		// Keep the active group first, then finished. The flat item indexes still
		// drive selection; the headings are presentation only.
		const activeItems = this.items.filter(isTaskRunning);
		const finishedItems = this.items.filter((item) => !isTaskRunning(item));
		const viewRows = this.getViewportRows();
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.items.length - viewRows));
		const first = this.scrollOffset;
		const last = Math.min(this.items.length, first + viewRows);
		const contentWidth = Math.max(24, this.width - 2);
		const renderItem = (item: TaskItem, index: number): void => {
			const isCursor = index === this.selectedIndex;
			const prefix = isCursor ? "▸ " : "  ";
			const status = statusGlyph(item);
			const kind = item.kind === "agent" ? "agent" : "bash";
			const meta = shortItemMeta(item);
			const headWidth = visibleWidth(status) + 1 + kind.length + 2;
			const labelWidth = Math.max(8, contentWidth - visibleWidth(prefix) - headWidth - visibleWidth(meta) - 2);
			const label = truncateText(itemLabel(item), labelWidth);
			const head = `${status} ${theme.fg("dim", kind)} ${theme.fg("text", label)}`;
			const gap = Math.max(1, contentWidth - visibleWidth(prefix) - visibleWidth(head) - visibleWidth(meta));
			const row = `${prefix}${head}${" ".repeat(gap)}${theme.fg("dim", meta)}`;
			const padded = row + " ".repeat(Math.max(0, contentWidth - visibleWidth(row)));
			this.bodyContainer.addChild(
				isCursor
					? new Text(theme.bg("selectedBg", padded), 0, 0)
					: new Text(`  ${head}${" ".repeat(gap)}${theme.fg("dim", meta)}`, 0, 0),
			);
			if (isCursor) {
				const summary = truncateText(itemSummary(item), Math.max(16, contentWidth - 6));
				if (summary) {
					this.bodyContainer.addChild(new Text(theme.fg("dim", `    ${summary}`), 0, 0));
				}
			}
		};

		if (first > 0) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `… ${first} more above`), 1, 0));
		}

		if (activeItems.length > 0 && first < activeItems.length) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `ACTIVE ${activeItems.length}`), 1, 0));
			for (let i = first; i < Math.min(last, activeItems.length); i++) {
				renderItem(activeItems[i]!, i);
			}
		}

		if (finishedItems.length > 0 && last > activeItems.length) {
			if (first < activeItems.length) this.bodyContainer.addChild(new Spacer(1));
			this.bodyContainer.addChild(new Text(theme.fg("dim", `FINISHED ${finishedItems.length}`), 1, 0));
			const start = Math.max(0, first - activeItems.length);
			for (let i = start; i < last - activeItems.length; i++) {
				renderItem(finishedItems[i]!, activeItems.length + i);
			}
		}

		if (last < this.items.length) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `… ${this.items.length - last} more below`), 1, 0));
		}
		if (this.notice) {
			this.bodyContainer.addChild(new Spacer(1));
			this.bodyContainer.addChild(new Text(theme.fg("muted", this.notice), 1, 0));
		}

		const selected = this.selectedItem();
		const hints: string[] = [rawKeyHint("↑↓", "move"), keyHint("tui.select.confirm", "view")];
		if (selected && isTaskRunning(selected)) hints.push(rawKeyHint("k", "kill"));
		if (selected?.kind === "agent" && !isTaskRunning(selected)) {
			hints.push(rawKeyHint("r", "rerun"), rawKeyHint("x", "dismiss"));
		}
		hints.push(
			rawKeyHint("h", this.showFinished ? "hide finished" : "show finished"),
			keyHint("tui.select.cancel", "close"),
		);
		this.hint.setText(hints.join("  "));
	}

	private divider(): Text {
		return new Text(theme.fg("borderMuted", "─".repeat(Math.max(12, this.width - 4))), 1, 0);
	}

	private renderView(): void {
		const item = this.viewItem();
		if (!item) {
			this.mode = "picking";
			this.renderPicker();
			return;
		}
		if (item.kind === "agent") {
			this.renderAgentView(item.record);
		} else {
			this.renderBashView(item.record);
		}
		if (this.notice) {
			this.bodyContainer.addChild(new Spacer(1));
			this.bodyContainer.addChild(new Text(theme.fg("muted", this.notice), 1, 0));
		}
		const hints: string[] = [rawKeyHint("↑↓", "scroll")];
		if (item.record.status === "running") hints.push(rawKeyHint("k", "kill"));
		if (this.itemPath(item)) hints.push(rawKeyHint("o", "open log"), rawKeyHint("y", "copy path"));
		if (item.kind === "agent") {
			if (item.record.finalText?.trim() || item.record.error?.trim()) hints.push(rawKeyHint("c", "copy result"));
			if (item.record.worktreePath) hints.push(rawKeyHint("d", "diff"));
			if (item.record.status !== "running") hints.push(rawKeyHint("r", "rerun"), rawKeyHint("x", "dismiss"));
		} else if (item.record.output.trim()) {
			hints.push(rawKeyHint("c", "copy output"));
		}
		hints.push(keyHint("tui.select.cancel", "back"));
		this.hint.setText(hints.join("  "));
	}

	private renderAgentView(record: InProcessSubAgentRecord): void {
		const header = record.teammateName
			? `${record.teammateName} · ${record.agentType}`
			: `${record.id} · ${record.agentType}`;
		this.bodyContainer.addChild(
			new Text(
				`${statusGlyph({ kind: "agent", record })} ${itemStatus({ kind: "agent", record })}  ${theme.fg("accent", theme.bold(header))}`,
				1,
				0,
			),
		);
		if (record.goal) {
			this.bodyContainer.addChild(new Text(theme.fg("text", truncateText(record.goal, 80)), 1, 1));
		}
		const meta: string[] = [];
		if (record.model) meta.push(record.model);
		if (record.toolUseCount > 0) meta.push(`${record.toolUseCount} tool${record.toolUseCount === 1 ? "" : "s"}`);
		if (record.turnCount > 0) meta.push(`${record.turnCount} turn${record.turnCount === 1 ? "" : "s"}`);
		if (record.lastToolName) meta.push(`last ${record.lastToolName}`);
		const tokens = formatTokens(record.totalTokens);
		if (tokens) meta.push(tokens);
		meta.push(formatDuration((record.status === "running" ? Date.now() : record.updatedAt) - record.startedAt));
		if (record.status !== "running") {
			meta.push(`updated ${formatDuration(Date.now() - record.updatedAt)} ago`);
		}
		this.bodyContainer.addChild(new Text(theme.fg("muted", meta.join(" · ")), 1, 0));
		if (record.outputFile) this.bodyContainer.addChild(new Text(theme.fg("dim", `log: ${record.outputFile}`), 1, 1));
		if (record.worktreePath)
			this.bodyContainer.addChild(new Text(theme.fg("dim", `worktree: ${record.worktreePath}`), 1, 1));
		this.renderOutcome(record);
		this.bodyContainer.addChild(new Spacer(1));
		this.bodyContainer.addChild(new Text(theme.fg("dim", "Timeline"), 1, 0));
		this.bodyContainer.addChild(this.divider());

		const timelineTail = 12;
		// ↑/↓ scroll back through the FULL timeline (easy-agent TeammateViewer
		// parity): viewScroll counts lines back from the latest event; 0 = live tail.
		const total = record.timeline.length;
		const maxOffset = Math.max(0, total - timelineTail);
		this.viewScroll = Math.min(this.viewScroll, maxOffset);
		const windowStart = Math.max(0, total - timelineTail - this.viewScroll);
		const windowEnd = total - this.viewScroll;
		const droppedEvents = windowStart;
		if (droppedEvents > 0) {
			const droppedLabel =
				this.viewScroll > 0
					? `… ${droppedEvents} earlier events hidden (↓ returns to live)`
					: `… ${droppedEvents} earlier events hidden (↑ scrolls back)`;
			this.bodyContainer.addChild(new Text(theme.fg("dim", droppedLabel), 1, 1));
		}
		const tail = record.timeline.slice(windowStart, windowEnd);
		if (tail.length === 0) {
			this.bodyContainer.addChild(new Text(theme.fg("muted", "(no events yet)"), 1, 1));
		} else {
			for (const event of tail) this.renderTimelineEvent(event);
		}
	}

	private renderTimelineEvent(event: SubAgentProgressEvent): void {
		switch (event.type) {
			case "text": {
				const text = event.text.trim();
				if (!text) return;
				for (const line of text.split("\n").slice(-6)) {
					this.bodyContainer.addChild(new Text(theme.fg("text", line), 1, 1));
				}
				break;
			}
			case "tool_use_start":
				this.bodyContainer.addChild(
					new Text(`${theme.fg("accent", "→")} ${theme.fg("muted", event.toolName)}`, 1, 1),
				);
				break;
			case "tool_use_done": {
				const mark = event.isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				this.bodyContainer.addChild(new Text(`${mark} ${theme.fg("muted", event.toolName)}`, 1, 1));
				const detail = formatToolResultDetail(event);
				if (detail) {
					this.bodyContainer.addChild(new Text(theme.fg("dim", detail), 1, 1));
				}
				break;
			}
			case "turn_complete":
				this.bodyContainer.addChild(new Text(theme.fg("dim", formatTurnLine(event.turnCount, event.usage)), 1, 1));
				break;
			case "completed":
				this.bodyContainer.addChild(
					new Text(
						theme.fg("success", `— completed after ${event.turnCount} turns, ${event.toolUseCount} tools`),
						1,
						1,
					),
				);
				break;
			case "aborted":
				this.bodyContainer.addChild(new Text(theme.fg("error", "— aborted"), 1, 1));
				break;
		}
	}

	/**
	 * Lead with what the user opened the viewer for: the final answer, the
	 * failure, or the stop. The timeline below stays as the audit trail.
	 */
	private renderOutcome(record: InProcessSubAgentRecord): void {
		if (record.status === "running") return;
		this.bodyContainer.addChild(new Spacer(1));
		const heading = record.status === "completed" ? "Result" : record.status === "failed" ? "Failure" : "Stopped";
		const tone = record.status === "completed" ? "success" : "error";
		this.bodyContainer.addChild(new Text(theme.fg(tone, theme.bold(heading)), 1, 1));
		if (record.error) {
			this.bodyContainer.addChild(new Text(theme.fg("error", record.error), 1, 1));
		} else if (record.status === "failed") {
			this.bodyContainer.addChild(new Text(theme.fg("error", "No error detail recorded."), 1, 1));
		}
		const text = record.finalText?.trim();
		if (!text) {
			if (record.status === "completed") {
				this.bodyContainer.addChild(new Text(theme.fg("muted", "(no final text recorded)"), 1, 1));
			}
			return;
		}
		const lines = text.split("\n");
		const maxLines = 24;
		const shown = lines.length > maxLines ? lines.slice(-maxLines) : lines;
		if (lines.length > maxLines) {
			this.bodyContainer.addChild(
				new Text(theme.fg("dim", `… ${lines.length - maxLines} earlier lines hidden`), 1, 1),
			);
		}
		for (const line of shown) {
			this.bodyContainer.addChild(new Text(theme.fg("text", line), 1, 1));
		}
	}

	private itemPath(item: TaskItem): string | undefined {
		return item.kind === "agent" ? (item.record.outputFile ?? item.record.worktreePath) : item.record.fullOutputPath;
	}

	private copyResult(): void {
		const item = this.viewItem();
		if (!item) return;
		const text =
			item.kind === "agent"
				? (item.record.finalText?.trim() ?? item.record.error?.trim() ?? "")
				: item.record.output.trim();
		if (!text) {
			this.notice =
				item.kind === "agent" && item.record.status === "running"
					? "No result yet — the sub-agent is still running."
					: "Nothing to copy for this task yet.";
		} else if (!this.actions.copyText) {
			this.notice = "Clipboard is unavailable here.";
		} else {
			void this.actions.copyText(text);
			this.notice = `Copied ${text.length.toLocaleString()} chars to the clipboard.`;
		}
		this.rerender();
	}

	private copyPath(): void {
		const item = this.viewItem();
		const path = item ? this.itemPath(item) : undefined;
		if (!path) {
			this.notice = "This task has no log path.";
		} else if (!this.actions.copyText) {
			this.notice = "Clipboard is unavailable here.";
		} else {
			void this.actions.copyText(path);
			this.notice = `Copied path: ${path}`;
		}
		this.rerender();
	}

	private openLog(): void {
		const item = this.viewItem();
		const path = item ? this.itemPath(item) : undefined;
		if (!path) {
			this.notice = "This task has no log path.";
		} else if (!this.actions.openPath) {
			this.notice = "Opening files is unavailable here.";
		} else {
			void this.actions.openPath(path);
			this.notice = `Opening ${path}…`;
		}
		this.rerender();
	}

	private showDiff(): void {
		const item = this.viewItem();
		if (!item || item.kind !== "agent" || !item.record.worktreePath) {
			this.notice = "No kept worktree for this task.";
		} else {
			this.notice = this.actions.diffStat?.(item.record.worktreePath) ?? "Could not read the worktree diff.";
		}
		this.rerender();
	}

	private rerun(): void {
		const item = this.viewItem();
		if (!item || item.kind !== "agent") {
			this.notice = "Only sub-agents can be rerun.";
			this.rerender();
			return;
		}
		if (item.record.status === "running") {
			this.notice = "Stop the sub-agent before rerunning it.";
			this.rerender();
			return;
		}
		const result = this.actions.rerunAgent?.(item.record);
		if (!result) {
			this.notice = "Rerun is unavailable here.";
		} else if ("error" in result) {
			this.notice = result.error;
		} else {
			this.notice = `Rerunning as ${result.id} — it appears in the list.`;
		}
		this.rerender();
	}

	private renderBashView(record: BackgroundProcessRecord): void {
		const cmd = truncateText(record.command, 80);
		this.bodyContainer.addChild(
			new Text(
				`${statusGlyph({ kind: "bash", record })} ${itemStatus({ kind: "bash", record })}  ${theme.fg("accent", theme.bold(`$ ${cmd}`))}`,
				1,
				0,
			),
		);
		const meta: string[] = [];
		if (record.pid) meta.push(`pid ${record.pid}`);
		meta.push(`${record.totalLines} lines`);
		if (record.totalBytes > 0) meta.push(formatBytes(record.totalBytes));
		meta.push(formatDuration((record.endedAt ?? Date.now()) - record.startedAt));
		if (record.exitCode !== undefined) meta.push(`exit ${record.exitCode}`);
		if (record.endedAt !== undefined) meta.push(`ended ${formatDuration(Date.now() - record.endedAt)} ago`);
		this.bodyContainer.addChild(new Text(theme.fg("muted", meta.join(" · ")), 1, 0));
		if (record.error) this.bodyContainer.addChild(new Text(theme.fg("error", record.error), 1, 1));
		if (record.fullOutputPath)
			this.bodyContainer.addChild(new Text(theme.fg("dim", `log: ${record.fullOutputPath}`), 1, 0));
		this.bodyContainer.addChild(new Spacer(1));
		this.bodyContainer.addChild(new Text(theme.fg("dim", "Output"), 1, 0));
		this.bodyContainer.addChild(this.divider());

		const bashTailLines = 15;
		const lines = record.output.split("\n").filter((l) => l.length > 0);
		// ↑/↓ scroll back through the retained output tail, mirroring the agent
		// timeline scroll (viewScroll counts lines back from the latest line).
		const maxOffset = Math.max(0, lines.length - bashTailLines);
		this.viewScroll = Math.min(this.viewScroll, maxOffset);
		const windowStart = Math.max(0, lines.length - bashTailLines - this.viewScroll);
		const windowEnd = lines.length - this.viewScroll;
		const droppedLines = windowStart;
		if (droppedLines > 0) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `… ${droppedLines} earlier lines hidden`), 1, 1));
		}
		const tail = lines.slice(windowStart, windowEnd);
		if (tail.length === 0) {
			this.bodyContainer.addChild(new Text(theme.fg("muted", "(no output yet)"), 1, 1));
		} else {
			for (const line of tail) {
				this.bodyContainer.addChild(new Text(truncateToWidth(theme.fg("text", line), 120, "…"), 1, 1));
			}
		}
	}

	private dismissSelected(): void {
		const item = this.mode === "viewing" ? this.viewItem() : this.selectedItem();
		if (!item) return;
		if (item.kind !== "agent" || item.record.status === "running") {
			this.notice = "Only finished sub-agents can be dismissed.";
			this.rerender();
			return;
		}
		const removed = this.actions.removeAgent?.(item.record) ?? false;
		this.notice = removed
			? `Dismissed sub-agent "${truncateText(itemLabel(item), 30)}".`
			: "Could not dismiss this sub-agent.";
		if (removed && this.mode === "viewing") {
			this.mode = "picking";
			this.viewingId = undefined;
			this.viewScroll = 0;
		}
		this.rerender();
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		const back = kb.matches(keyData, "tui.select.cancel") || kb.matches(keyData, "tui.editor.cursorLeft");

		if (this.mode === "picking") {
			if (keyData === "h") {
				this.showFinished = !this.showFinished;
				showFinishedDefault = this.showFinished;
				this.rebuildVisibleItems();
				this.clampSelection();
				this.rerender();
			} else if (keyData === "k" && this.items.length > 0) {
				const item = this.selectedItem();
				if (item) {
					this.onKill(item);
					this.notice = `Kill requested for ${item.kind} "${truncateText(itemLabel(item), 30)}".`;
				}
				return;
			} else if (keyData === "x" && this.items.length > 0) {
				this.dismissSelected();
				return;
			}
			if (kb.matches(keyData, "tui.select.up")) {
				this.selectedIndex = Math.max(0, this.selectedIndex - 1);
				this.keepCursorInWindow();
				this.rerender();
			} else if (kb.matches(keyData, "tui.select.down")) {
				this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
				this.keepCursorInWindow();
				this.rerender();
			} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n" || keyData === "\r") {
				const item = this.selectedItem();
				if (item) {
					this.mode = "viewing";
					this.viewingId = itemId(item);
					this.viewScroll = 0;
					this.notice = undefined;
					this.rerender();
				}
			} else if (back) {
				this.onClose();
			}
			return;
		}

		// Viewing mode.
		if (back) {
			this.mode = "picking";
			this.viewingId = undefined;
			this.viewScroll = 0;
			this.notice = undefined;
			this.rerender();
		} else if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down")) {
			// Scroll the viewed task (↑ = older, ↓ = newer toward live): the
			// agent's timeline or the bash output tail.
			const step = 3;
			if (kb.matches(keyData, "tui.select.up")) {
				this.viewScroll += step;
			} else {
				this.viewScroll = Math.max(0, this.viewScroll - step);
			}
			this.rerender();
		} else if (keyData === "c") {
			this.copyResult();
		} else if (keyData === "y") {
			this.copyPath();
		} else if (keyData === "o") {
			this.openLog();
		} else if (keyData === "d") {
			this.showDiff();
		} else if (keyData === "r") {
			this.rerun();
		} else if (keyData === "x") {
			this.dismissSelected();
		} else if (keyData === "k") {
			const item = this.viewItem();
			if (item) {
				this.onKill(item);
				this.notice = `Kill requested for ${item.kind} "${truncateText(itemLabel(item), 30)}".`;
				this.rerender();
			}
		}
	}
}

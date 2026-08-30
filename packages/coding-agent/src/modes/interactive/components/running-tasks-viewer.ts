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

import { Container, getKeybindings, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { InProcessSubAgentRecord, SubAgentProgressEvent } from "../../../core/extensions/types.ts";
import type {
	BackgroundProcessRecord,
	BackgroundProcessStatus,
} from "../../../core/stores/background-process-store.ts";
import { formatDuration } from "../../../utils/duration.ts";
import { theme } from "../theme/theme.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

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

function itemMeta(item: TaskItem): string {
	const meta: string[] = [];
	if (item.kind === "agent") {
		const r = item.record;
		if (r.model) meta.push(r.model);
		if (r.toolUseCount > 0) meta.push(`${r.toolUseCount} tools`);
		const tokens = formatTokens(r.totalTokens);
		if (tokens) meta.push(tokens);
		meta.push(formatDuration(Date.now() - r.startedAt));
	} else {
		const r = item.record;
		if (r.totalBytes > 0) meta.push(formatBytes(r.totalBytes));
		meta.push(formatDuration((r.endedAt ?? Date.now()) - r.startedAt));
		if (r.exitCode !== undefined) meta.push(`exit ${r.exitCode}`);
	}
	return meta.join(", ");
}

/** Whether the picker should include finished tasks. Remembered across opens. */
let showFinishedDefault = true;

function isTaskRunning(item: TaskItem): boolean {
	return item.record.status === "running";
}

export class RunningTasksViewerComponent extends Container {
	/** Full snapshot (running + finished). */
	private allItems: TaskItem[] = [];
	/** Visible slice (respects the hide-finished toggle). */
	private items: TaskItem[] = [];
	private showFinished: boolean = showFinishedDefault;
	private mode: "picking" | "viewing" = "picking";
	private selectedIndex = 0;
	private viewingId: string | undefined;
	private onClose: () => void;
	private onKill: (item: TaskItem) => void;
	private bodyContainer: Container;
	private hint: Text;
	private killedNotice: string | undefined;
	/** 1s render ticker so elapsed/duration displays advance while idle. */
	private elapsedTimer: ReturnType<typeof setInterval> | undefined;
	private elapsedTui: { requestRender: () => void } | undefined;

	constructor(
		subagents: InProcessSubAgentRecord[],
		backgrounds: BackgroundProcessRecord[],
		onClose: () => void,
		onKill: (item: TaskItem) => void,
		elapsedTui?: { requestRender: () => void },
	) {
		super();
		this.onClose = onClose;
		this.onKill = onKill;
		this.elapsedTui = elapsedTui;
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
		if (!this.elapsedTui || this.elapsedTimer) return;
		this.elapsedTimer = setInterval(() => {
			if (
				this.items.some((i) => (i.kind === "agent" ? i.record.status === "running" : i.record.status === "running"))
			) {
				this.elapsedTui?.requestRender();
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
	}

	private setItems(subagents: InProcessSubAgentRecord[], backgrounds: BackgroundProcessRecord[]): void {
		const items: TaskItem[] = [
			...subagents.map((record): TaskItem => ({ kind: "agent", record })),
			...backgrounds.map((record): TaskItem => ({ kind: "bash", record })),
		];
		items.sort((a, b) => itemStartedAt(a) - itemStartedAt(b));
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

	private renderPicker(): void {
		this.bodyContainer.addChild(new Text(theme.fg("accent", theme.bold("Running tasks")), 1, 1));
		if (this.items.length === 0) {
			this.bodyContainer.addChild(
				new Text(
					theme.fg(
						"muted",
						this.showFinished
							? "No background processes or sub-agents."
							: "No running tasks — press h to show finished runs.",
					),
					1,
					1,
				),
			);
		}
		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			const isCursor = i === this.selectedIndex;
			const kindTag = item.kind === "agent" ? theme.fg("dim", "agent") : theme.fg("dim", "bash");
			const status = itemStatus(item);
			const line =
				`${theme.fg("muted", "[")}${kindTag} ${status}${theme.fg("muted", "]")} ` +
				`${theme.fg("text", itemLabel(item))} ${theme.fg("dim", itemMeta(item))}`;
			this.bodyContainer.addChild(new Text(isCursor ? `${theme.fg("accent", "→ ")}${line}` : `  ${line}`, 1, 1));
		}
		this.hint.setText(
			rawKeyHint("↑↓", "navigate") +
				"  " +
				keyHint("tui.select.confirm", "view") +
				"  " +
				rawKeyHint("k", "kill") +
				"  " +
				rawKeyHint("h", this.showFinished ? "hide done" : "show done") +
				"  " +
				keyHint("tui.select.cancel", "close"),
		);
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
		if (this.killedNotice) {
			this.bodyContainer.addChild(new Spacer(1));
			this.bodyContainer.addChild(new Text(theme.fg("error", this.killedNotice), 1, 1));
		}
		this.hint.setText(`${keyHint("tui.select.cancel", "back")}  ${rawKeyHint("k", "kill")}`);
	}

	private renderAgentView(record: InProcessSubAgentRecord): void {
		const header = record.teammateName
			? `${record.teammateName} · ${record.agentType}`
			: `${record.id} · ${record.agentType}`;
		this.bodyContainer.addChild(
			new Text(
				`${theme.fg("accent", theme.bold(header))} ${theme.fg("dim", `[${itemStatus({ kind: "agent", record })}]`)}`,
				1,
				1,
			),
		);
		if (record.goal) {
			this.bodyContainer.addChild(new Text(theme.fg("text", truncateText(record.goal, 80)), 1, 1));
		}
		const meta: string[] = [];
		if (record.model) meta.push(record.model);
		if (record.toolUseCount > 0) meta.push(`${record.toolUseCount} tools`);
		if (record.turnCount > 0) meta.push(`${record.turnCount} turns`);
		const tokens = formatTokens(record.totalTokens);
		if (tokens) meta.push(tokens);
		meta.push(formatDuration(Date.now() - record.startedAt));
		this.bodyContainer.addChild(new Text(theme.fg("muted", meta.join(" · ")), 1, 1));
		if (record.outputFile) this.bodyContainer.addChild(new Text(theme.fg("dim", `log: ${record.outputFile}`), 1, 1));
		if (record.worktreePath)
			this.bodyContainer.addChild(new Text(theme.fg("dim", `worktree: ${record.worktreePath}`), 1, 1));
		this.bodyContainer.addChild(new Spacer(1));

		const timelineTail = 12;
		const droppedEvents = Math.max(0, record.timeline.length - timelineTail);
		if (droppedEvents > 0) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `… ${droppedEvents} earlier events hidden`), 1, 1));
		}
		const tail = record.timeline.slice(-timelineTail);
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

	private renderBashView(record: BackgroundProcessRecord): void {
		const cmd = truncateText(record.command, 80);
		this.bodyContainer.addChild(
			new Text(
				`${theme.fg("accent", theme.bold(`$ ${cmd}`))} ${theme.fg("dim", `[${itemStatus({ kind: "bash", record })}]`)}`,
				1,
				1,
			),
		);
		const meta: string[] = [];
		if (record.pid) meta.push(`pid ${record.pid}`);
		meta.push(`${record.totalLines} lines`);
		if (record.totalBytes > 0) meta.push(formatBytes(record.totalBytes));
		meta.push(formatDuration((record.endedAt ?? Date.now()) - record.startedAt));
		if (record.exitCode !== undefined) meta.push(`exit ${record.exitCode}`);
		this.bodyContainer.addChild(new Text(theme.fg("muted", meta.join(" · ")), 1, 1));
		if (record.fullOutputPath)
			this.bodyContainer.addChild(new Text(theme.fg("dim", `log: ${record.fullOutputPath}`), 1, 1));
		this.bodyContainer.addChild(new Spacer(1));

		const bashTailLines = 15;
		const lines = record.output.split("\n").filter((l) => l.length > 0);
		const droppedLines = Math.max(0, lines.length - bashTailLines);
		if (droppedLines > 0) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `… ${droppedLines} earlier lines hidden`), 1, 1));
		}
		const tail = lines.slice(-bashTailLines);
		if (tail.length === 0) {
			this.bodyContainer.addChild(new Text(theme.fg("muted", "(no output yet)"), 1, 1));
		} else {
			for (const line of tail) {
				this.bodyContainer.addChild(new Text(truncateToWidth(theme.fg("text", line), 120, "…"), 1, 1));
			}
		}
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
					this.killedNotice = `Kill requested for ${item.kind} "${truncateText(itemLabel(item), 30)}".`;
				}
				return;
			}
			if (kb.matches(keyData, "tui.select.up")) {
				this.selectedIndex = Math.max(0, this.selectedIndex - 1);
				this.rerender();
			} else if (kb.matches(keyData, "tui.select.down")) {
				this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
				this.rerender();
			} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n" || keyData === "\r") {
				const item = this.selectedItem();
				if (item) {
					this.mode = "viewing";
					this.viewingId = itemId(item);
					this.killedNotice = undefined;
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
			this.killedNotice = undefined;
			this.rerender();
		} else if (keyData === "k") {
			const item = this.viewItem();
			if (item) {
				this.onKill(item);
				this.killedNotice = `Kill requested for ${item.kind} "${truncateText(itemLabel(item), 30)}".`;
				this.rerender();
			}
		}
	}
}

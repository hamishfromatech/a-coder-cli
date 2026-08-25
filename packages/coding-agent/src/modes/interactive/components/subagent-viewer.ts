/**
 * SubAgentViewer — picker + live transcript overlay for background sub-agents.
 *
 * Ports easy-agent's teammate navigation UX (Shift+↓ picker, Enter to view,
 * Esc to return, 'k' to kill) onto pi's in-process sub-agent store. Two
 * phases:
 *
 *   picking  — list of all sub-agents (id, teammate name, agent type,
 *              status, tools, tokens). Enter opens the transcript.
 *   viewing  — live tail of the selected record's timeline (text, tool uses,
 *              turns, completion), auto-refreshed while the agent runs.
 *
 * Esc returns from viewing to picking, or closes from picking. 'k' kills the
 * selected/running agent.
 */

import { Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";
import type { InProcessSubAgentRecord, SubAgentProgressEvent } from "../../../core/extensions/types.ts";
import { formatDuration } from "../../../utils/duration.ts";
import { theme } from "../theme/theme.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

const STATUS_LABEL: Record<InProcessSubAgentRecord["status"], string> = {
	running: "running",
	completed: "done",
	failed: "failed",
	killed: "stopped",
};

function formatTokens(n: number | undefined): string {
	if (!n || n <= 0) return "";
	if (n < 1000) return `${n} tok`;
	if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k tok`;
	return `${(n / 1000000).toFixed(1)}M tok`;
}

export class SubAgentViewerComponent extends Container {
	private records: InProcessSubAgentRecord[];
	private mode: "picking" | "viewing" = "picking";
	private selectedIndex = 0;
	private viewingId: string | undefined;
	private onClose: () => void;
	private onKill: (id: string) => void;
	private bodyContainer: Container;
	private hint: Text;
	private killedNotice: string | undefined;

	constructor(records: InProcessSubAgentRecord[], onClose: () => void, onKill: (id: string) => void) {
		super();
		this.records = [...records].sort((a, b) => a.createdAt - b.createdAt);
		this.onClose = onClose;
		this.onKill = onKill;

		this.addChild(new Spacer(1));
		this.bodyContainer = new Container();
		this.addChild(this.bodyContainer);
		this.addChild(new Spacer(1));
		this.hint = new Text("", 1, 0);
		this.addChild(this.hint);

		this.rerender();
	}

	/** Push a fresh snapshot of the sub-agent store (live updates). */
	update(records: InProcessSubAgentRecord[]): void {
		this.records = [...records].sort((a, b) => a.createdAt - b.createdAt);
		// Clamp selection / drop the viewed record if it disappeared.
		if (this.selectedIndex >= this.records.length) {
			this.selectedIndex = Math.max(0, this.records.length - 1);
		}
		if (this.viewingId && !this.records.some((r) => r.id === this.viewingId)) {
			this.mode = "picking";
			this.viewingId = undefined;
		}
		this.rerender();
	}

	private selectedRecord(): InProcessSubAgentRecord | undefined {
		return this.records[this.selectedIndex];
	}

	private viewRecord(): InProcessSubAgentRecord | undefined {
		return this.records.find((r) => r.id === this.viewingId);
	}

	private rerender(): void {
		this.bodyContainer.clear();
		this.hint.setText("");

		if (this.mode === "picking") {
			this.renderPicker();
		} else {
			this.renderTranscript();
		}
	}

	private renderPicker(): void {
		this.bodyContainer.addChild(new Text(theme.fg("accent", theme.bold("Background sub-agents")), 1, 1));
		if (this.records.length === 0) {
			this.bodyContainer.addChild(new Text(theme.fg("muted", "No sub-agents yet."), 1, 1));
		}
		for (let i = 0; i < this.records.length; i++) {
			const record = this.records[i];
			const isCursor = i === this.selectedIndex;
			const label = record.teammateName
				? `${record.id} (${record.teammateName} · ${record.agentType})`
				: `${record.id} (${record.agentType})`;
			const status =
				record.status === "running"
					? theme.fg("accent", STATUS_LABEL[record.status])
					: record.status === "completed"
						? theme.fg("success", STATUS_LABEL[record.status])
						: theme.fg("error", STATUS_LABEL[record.status]);
			const meta: string[] = [];
			if (record.toolUseCount > 0) meta.push(`${record.toolUseCount} tools`);
			const tokens = formatTokens(record.totalTokens);
			if (tokens) meta.push(tokens);
			meta.push(formatDuration(Date.now() - record.startedAt));
			const line = `${theme.fg("muted", `[${status}${theme.fg("dim", "]")} `)}${theme.fg("text", label)} ${theme.fg("dim", meta.join(", "))}`;
			this.bodyContainer.addChild(new Text(isCursor ? `${theme.fg("accent", "→ ")}${line}` : `  ${line}`, 1, 1));
		}
		this.hint.setText(
			rawKeyHint("↑↓", "navigate") +
				"  " +
				keyHint("tui.select.confirm", "view") +
				"  " +
				rawKeyHint("k", "kill") +
				"  " +
				keyHint("tui.select.cancel", "close"),
		);
	}

	private renderTranscript(): void {
		const record = this.viewRecord();
		if (!record) {
			this.mode = "picking";
			this.renderPicker();
			return;
		}

		const header = record.teammateName
			? `${record.teammateName} · ${record.agentType}`
			: `${record.id} · ${record.agentType}`;
		const status =
			record.status === "running"
				? theme.fg("accent", STATUS_LABEL[record.status])
				: record.status === "completed"
					? theme.fg("success", STATUS_LABEL[record.status])
					: theme.fg("error", STATUS_LABEL[record.status]);
		this.bodyContainer.addChild(
			new Text(`${theme.fg("accent", theme.bold(header))} ${theme.fg("dim", `[${status}]`)}`, 1, 1),
		);
		const meta: string[] = [];
		if (record.toolUseCount > 0) meta.push(`${record.toolUseCount} tools`);
		if (record.turnCount > 0) meta.push(`${record.turnCount} turns`);
		const tokens = formatTokens(record.totalTokens);
		if (tokens) meta.push(tokens);
		meta.push(formatDuration(Date.now() - record.startedAt));
		this.bodyContainer.addChild(new Text(theme.fg("muted", meta.join(" · ")), 1, 1));
		if (record.outputFile) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `log: ${record.outputFile}`), 1, 1));
		}
		if (record.worktreePath) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `worktree: ${record.worktreePath}`), 1, 1));
		}
		this.bodyContainer.addChild(new Spacer(1));

		// Live tail: render the last events from the in-memory timeline.
		const timeline = record.timeline;
		const tail = timeline.slice(-12);
		for (const event of tail) {
			this.renderTimelineEvent(event);
		}
		if (timeline.length === 0) {
			this.bodyContainer.addChild(new Text(theme.fg("muted", "(no events yet)"), 1, 1));
		}
		if (this.killedNotice) {
			this.bodyContainer.addChild(new Spacer(1));
			this.bodyContainer.addChild(new Text(theme.fg("error", this.killedNotice), 1, 1));
		}

		this.hint.setText(`${keyHint("tui.select.cancel", "back")}  ${rawKeyHint("k", "kill")}`);
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
			case "tool_use_done":
				this.bodyContainer.addChild(
					new Text(
						`${event.isError ? theme.fg("error", "✗") : theme.fg("success", "✓")} ${theme.fg("muted", event.toolName)}`,
						1,
						1,
					),
				);
				break;
			case "turn_complete":
				this.bodyContainer.addChild(new Text(theme.fg("dim", `— turn ${event.turnCount}`), 1, 1));
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

	handleInput(keyData: string): void {
		const kb = getKeybindings();

		if (this.mode === "picking") {
			if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
				if (keyData === "k" && this.records.length > 0) {
					const record = this.selectedRecord();
					if (record) {
						this.onKill(record.id);
						this.killedNotice = `Kill requested for "${record.id}".`;
					}
					return;
				}
				this.selectedIndex = Math.max(0, this.selectedIndex - 1);
				this.rerender();
			} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
				this.selectedIndex = Math.min(this.records.length - 1, this.selectedIndex + 1);
				this.rerender();
			} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n" || keyData === "\r") {
				const record = this.selectedRecord();
				if (record) {
					this.mode = "viewing";
					this.viewingId = record.id;
					this.killedNotice = undefined;
					this.rerender();
				}
			} else if (kb.matches(keyData, "tui.select.cancel")) {
				this.onClose();
			}
			return;
		}

		// Viewing mode.
		if (kb.matches(keyData, "tui.select.cancel")) {
			this.mode = "picking";
			this.viewingId = undefined;
			this.killedNotice = undefined;
			this.rerender();
		} else if (keyData === "k") {
			const record = this.viewRecord();
			if (record) {
				this.onKill(record.id);
				this.killedNotice = `Kill requested for "${record.id}".`;
				this.rerender();
			}
		}
	}
}

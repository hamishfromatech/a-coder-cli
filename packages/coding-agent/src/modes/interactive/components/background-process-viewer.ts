/**
 * BackgroundProcessViewer — picker + live output tail for background bash
 * processes. Mirrors SubAgentViewerComponent's structure:
 *
 *   picking  — list of all background processes (command, status, elapsed,
 *              bytes). Enter opens the output tail.
 *   viewing  — live tail of the selected process's output, auto-refreshed
 *              while the process runs.
 *
 * Esc returns from viewing to picking, or closes from picking. 'k' kills
 * the selected/running process.
 */

import { Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";
import type {
	BackgroundProcessRecord,
	BackgroundProcessStatus,
} from "../../../core/stores/background-process-store.ts";
import { theme } from "../theme/theme.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

const STATUS_LABEL: Record<BackgroundProcessStatus, string> = {
	running: "running",
	done: "done",
	error: "error",
	killed: "killed",
};

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
	const min = Math.floor(sec / 60);
	return `${min}m${Math.round(sec - min * 60)}s`;
}

function truncateCommand(cmd: string, maxLen: number): string {
	if (cmd.length <= maxLen) return cmd;
	return `${cmd.slice(0, maxLen - 1)}…`;
}

export class BackgroundProcessViewerComponent extends Container {
	private records: BackgroundProcessRecord[];
	private mode: "picking" | "viewing" = "picking";
	private selectedIndex = 0;
	private viewingId: string | undefined;
	private onClose: () => void;
	private onKill: (id: string) => void;
	private bodyContainer: Container;
	private hint: Text;
	private killedNotice: string | undefined;

	constructor(records: BackgroundProcessRecord[], onClose: () => void, onKill: (id: string) => void) {
		super();
		this.records = [...records].sort((a, b) => a.startedAt - b.startedAt);
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

	/** Push a fresh snapshot of the background process store (live updates). */
	update(records: BackgroundProcessRecord[]): void {
		this.records = [...records].sort((a, b) => a.startedAt - b.startedAt);
		if (this.selectedIndex >= this.records.length) {
			this.selectedIndex = Math.max(0, this.records.length - 1);
		}
		if (this.viewingId && !this.records.some((r) => r.id === this.viewingId)) {
			this.mode = "picking";
			this.viewingId = undefined;
		}
		this.rerender();
	}

	private selectedRecord(): BackgroundProcessRecord | undefined {
		return this.records[this.selectedIndex];
	}

	private viewRecord(): BackgroundProcessRecord | undefined {
		return this.records.find((r) => r.id === this.viewingId);
	}

	private rerender(): void {
		this.bodyContainer.clear();
		this.hint.setText("");

		if (this.mode === "picking") {
			this.renderPicker();
		} else {
			this.renderOutput();
		}
	}

	private statusText(status: BackgroundProcessStatus): string {
		switch (status) {
			case "running":
				return theme.fg("accent", STATUS_LABEL[status]);
			case "done":
				return theme.fg("success", STATUS_LABEL[status]);
			case "error":
			case "killed":
				return theme.fg("error", STATUS_LABEL[status]);
		}
	}

	private renderPicker(): void {
		this.bodyContainer.addChild(new Text(theme.fg("accent", theme.bold("Background processes")), 1, 1));
		if (this.records.length === 0) {
			this.bodyContainer.addChild(new Text(theme.fg("muted", "No background processes."), 1, 1));
		}
		for (let i = 0; i < this.records.length; i++) {
			const record = this.records[i];
			const isCursor = i === this.selectedIndex;
			const cmd = truncateCommand(record.command, 40);
			const status = this.statusText(record.status);
			const meta: string[] = [];
			if (record.totalBytes > 0) meta.push(formatBytes(record.totalBytes));
			const elapsed = (record.endedAt ?? Date.now()) - record.startedAt;
			meta.push(formatDuration(elapsed));
			if (record.exitCode !== undefined) meta.push(`exit ${record.exitCode}`);
			const line = `${theme.fg("muted", `[${status}${theme.fg("dim", "]")} `)}${theme.fg("text", cmd)} ${theme.fg("dim", meta.join(", "))}`;
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

	private renderOutput(): void {
		const record = this.viewRecord();
		if (!record) {
			this.mode = "picking";
			this.renderPicker();
			return;
		}

		const cmd = truncateCommand(record.command, 60);
		const status = this.statusText(record.status);
		this.bodyContainer.addChild(
			new Text(`${theme.fg("accent", theme.bold(cmd))} ${theme.fg("dim", `[${status}]`)}`, 1, 1),
		);
		const meta: string[] = [];
		if (record.pid) meta.push(`pid ${record.pid}`);
		meta.push(`${record.totalLines} lines`);
		if (record.totalBytes > 0) meta.push(formatBytes(record.totalBytes));
		const elapsed = (record.endedAt ?? Date.now()) - record.startedAt;
		meta.push(formatDuration(elapsed));
		if (record.exitCode !== undefined) meta.push(`exit ${record.exitCode}`);
		this.bodyContainer.addChild(new Text(theme.fg("muted", meta.join(" · ")), 1, 1));
		if (record.fullOutputPath) {
			this.bodyContainer.addChild(new Text(theme.fg("dim", `log: ${record.fullOutputPath}`), 1, 1));
		}
		this.bodyContainer.addChild(new Spacer(1));

		// Live tail: render the last lines of output.
		const lines = record.output.split("\n").filter((l) => l.length > 0);
		const tail = lines.slice(-15);
		if (tail.length === 0) {
			this.bodyContainer.addChild(new Text(theme.fg("muted", "(no output yet)"), 1, 1));
		} else {
			for (const line of tail) {
				this.bodyContainer.addChild(new Text(theme.fg("text", line), 1, 1));
			}
		}
		if (this.killedNotice) {
			this.bodyContainer.addChild(new Spacer(1));
			this.bodyContainer.addChild(new Text(theme.fg("error", this.killedNotice), 1, 1));
		}

		this.hint.setText(`${keyHint("tui.select.cancel", "back")}  ${rawKeyHint("k", "kill")}`);
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();

		if (this.mode === "picking") {
			if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
				if (keyData === "k" && this.records.length > 0) {
					const record = this.selectedRecord();
					if (record) {
						this.onKill(record.id);
						this.killedNotice = `Kill requested for "${truncateCommand(record.command, 30)}".`;
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
				this.killedNotice = `Kill requested for "${truncateCommand(record.command, 30)}".`;
				this.rerender();
			}
		}
	}
}

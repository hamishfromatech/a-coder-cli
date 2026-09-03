/**
 * StatusLine — user-configurable footer row (easy-agent useStatusLine parity).
 *
 * When `ui.statusLine` is set in settings.json, that command runs on a
 * trailing debounce whenever session state changes, receives a JSON context
 * snapshot on stdin (model, cwd, permissionMode, contextPercent, tokens),
 * and its first non-empty stdout line renders as an extra row above the
 * footer. A 2s timeout kills runaway scripts; failures show nothing.
 */

import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { spawn } from "child_process";
import { theme } from "../theme/theme.ts";

const DEBOUNCE_MS = 300;
const RUN_TIMEOUT_MS = 2000;

export interface StatusLineContext {
	model: string;
	cwd: string;
	permissionMode: string;
	contextPercent?: number;
	tokens?: { input: number; output: number };
}

export class StatusLineComponent implements Component {
	private command: string;
	private line = "";
	private lastWidth = 0;
	private cachedLines: string[] = [];
	private pending = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private runToken = 0;
	private requestRender: () => void;

	constructor(command: string, requestRender: () => void) {
		this.command = command;
		this.requestRender = requestRender;
	}

	/** Schedule a refresh with the given context (trailing debounce). */
	refresh(context: StatusLineContext): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.run(context);
		}, DEBOUNCE_MS);
	}

	private async run(context: StatusLineContext): Promise<void> {
		if (this.pending) return;
		this.pending = true;
		const token = ++this.runToken;
		try {
			const line = await new Promise<string | undefined>((resolve) => {
				let settled = false;
				const done = (value: string | undefined) => {
					if (!settled) {
						settled = true;
						resolve(value);
					}
				};
				const child = spawn("/bin/sh", ["-c", this.command], {
					stdio: ["pipe", "pipe", "pipe"],
					windowsHide: true,
				});
				const timeout = setTimeout(() => {
					child.kill("SIGKILL");
					done(undefined);
				}, RUN_TIMEOUT_MS);
				let stdout = "";
				child.stdout?.on("data", (chunk: Buffer) => {
					stdout += chunk.toString("utf-8");
				});
				child.on("error", () => {
					clearTimeout(timeout);
					done(undefined);
				});
				child.on("close", () => {
					clearTimeout(timeout);
					const first = stdout
						.split("\n")
						.map((l) => l.trimEnd())
						.find((l) => l.trim().length > 0);
					done(first);
				});
				child.stdin?.on("error", () => {});
				child.stdin?.end(JSON.stringify(context));
			});
			// A newer run was scheduled meanwhile — drop the stale result.
			if (token === this.runToken && line !== undefined && line !== this.line) {
				this.line = line;
				this.cachedLines = [];
				this.requestRender();
			}
		} finally {
			this.pending = false;
		}
	}

	invalidate(): void {
		this.cachedLines = [];
	}

	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
		this.runToken++;
	}

	render(width: number): string[] {
		if (!this.line) return [];
		if (this.cachedLines.length > 0 && this.lastWidth === width) {
			return this.cachedLines;
		}
		this.lastWidth = width;
		this.cachedLines = [truncateToWidth(theme.fg("muted", this.line), width)];
		return this.cachedLines;
	}
}

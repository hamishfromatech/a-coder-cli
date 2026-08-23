import { type Component, Loader, type TUI } from "@earendil-works/pi-tui";
import type { WorkingIndicatorOptions } from "../../../core/extensions/index.ts";
import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { keyText } from "./keybinding-hints.ts";

const SHIMMER_STEP_MS = 100;
const SHIMMER_HALF_WIDTH = 1; // 3-char shimmer window
const REST_PADDING = 10; // ticks the shimmer rests off each side

/** Apply a right-to-left shimmer sweep across plain text. */
function applyShimmer(text: string): string {
	const len = text.length;
	if (len === 0) return text;

	const baseColor = theme.getFgAnsi("accent");
	const shimmerColor = theme.getFgAnsi("text"); // lighter accent
	const reset = "\x1b[39m";

	const tick = Math.floor(Date.now() / SHIMMER_STEP_MS);
	const cycleLength = len + REST_PADDING * 2;
	const glimmerIndex = len + REST_PADDING - (tick % cycleLength);
	const start = glimmerIndex - SHIMMER_HALF_WIDTH;
	const endExcl = glimmerIndex + SHIMMER_HALF_WIDTH + 1;

	// Shimmer is off-screen (resting): solid base color.
	if (start >= len || endExcl <= 0) return `${baseColor}${text}${reset}`;

	const s = Math.max(0, start);
	const e = Math.min(len, endExcl);
	return `${baseColor}${text.slice(0, s)}${shimmerColor}${text.slice(s, e)}${baseColor}${text.slice(e)}${reset}`;
}

export type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

export class StatusIndicator extends Loader {
	readonly kind: StatusIndicatorKind;

	constructor(
		kind: StatusIndicatorKind,
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string,
		indicator?: WorkingIndicatorOptions,
	) {
		super(ui, spinnerColorFn, messageColorFn, message, indicator);
		this.kind = kind;
	}

	dispose(): void {
		this.stop();
	}
}

export class WorkingStatusIndicator extends StatusIndicator {
	private elapsedTimer: NodeJS.Timeout | undefined;
	private startTime = Date.now();
	private baseMessage: string;
	private interruptKey: string;

	constructor(ui: TUI, message: string, indicator?: WorkingIndicatorOptions) {
		super(
			"working",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => applyShimmer(text),
			message,
			indicator,
		);
		this.baseMessage = message;
		this.interruptKey = keyText("app.interrupt");
		this.startElapsedTimer();
	}

	private startElapsedTimer(): void {
		this.elapsedTimer = setInterval(() => {
			this.refreshHint();
		}, 1000);
	}

	private refreshHint(): void {
		const seconds = Math.floor((Date.now() - this.startTime) / 1000);
		const hint = `(${seconds >= 1 ? `${seconds}s · ` : ""}${this.interruptKey} to interrupt)`;
		super.setMessage(`${this.baseMessage}  ${hint}`);
	}

	override setMessage(message: string): void {
		this.baseMessage = message;
		this.refreshHint();
	}

	override dispose(): void {
		if (this.elapsedTimer) {
			clearInterval(this.elapsedTimer);
			this.elapsedTimer = undefined;
		}
		super.dispose();
	}
}

export class RetryStatusIndicator extends StatusIndicator {
	private countdown: CountdownTimer | undefined;

	constructor(ui: TUI, attempt: number, maxAttempts: number, delayMs: number) {
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		super(
			"retry",
			ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.countdown = new CountdownTimer(
			delayMs,
			ui,
			(seconds) => {
				this.setMessage(retryMessage(seconds));
			},
			() => {
				this.countdown = undefined;
			},
		);
	}

	override dispose(): void {
		this.countdown?.dispose();
		this.countdown = undefined;
		super.dispose();
	}
}

export type CompactionStatusReason = "manual" | "threshold" | "overflow";

export class CompactionStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, reason: CompactionStatusReason) {
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		super(
			"compaction",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
		);
	}
}

export class BranchSummaryStatusIndicator extends StatusIndicator {
	constructor(ui: TUI) {
		super(
			"branchSummary",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
	}
}

export class IdleStatus implements Component {
	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		const emptyLine = " ".repeat(width);
		return [emptyLine, emptyLine];
	}
}

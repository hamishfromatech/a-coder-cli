/**
 * Notices — grouped system notices (errors, warnings) pinned at the end of
 * the transcript:
 *
 *     ⚠ models.json error: could not parse provider list
 *     ✗ Retry failed after 3 attempts: rate limited
 *
 * Replaces the former naked `Spacer + red "Error: …"` lines that spliced
 * themselves into the conversation: notices now live in one contiguous block
 * directly below the chat, styled with icons and theme colors, so they read
 * as system output rather than loose transcript text. Identical consecutive
 * notices collapse into one line with a ×N count; only the most recent
 * MAX_VISIBLE are shown, with a dim "earlier hidden" marker when truncated.
 * Renders zero lines when there is nothing to show.
 *
 * Notices are transient: each entry auto-expires NOTICE_TTL_MS after it was
 * last (re)seen, so transient errors — retry failures, timeouts, overflow
 * notices — do not linger over the transcript indefinitely. Repeating the
 * same notice refreshes its expiry. `clear()` removes everything at once.
 */

import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

export type NoticeKind = "error" | "warning";

export interface NoticeItem {
	kind: NoticeKind;
	text: string;
	/** Number of consecutive identical notices collapsed into this entry. */
	count: number;
	/** Epoch ms when this entry auto-expires (refreshed on identical repeats). */
	expiresAt: number;
}

const MAX_VISIBLE = 6;
const INDENT = "  ";
/** How long a notice stays visible after it was last shown. */
const NOTICE_TTL_MS = 8000;

export class NoticesComponent implements Component {
	private notices: NoticeItem[] = [];
	private cachedWidth?: number;
	private cachedLines?: string[];
	private expireTimer?: ReturnType<typeof setTimeout>;

	/** Called after expired notices are purged so the host can re-render. */
	onExpire?: () => void;

	/** Append a notice; collapses into the previous entry when identical. */
	add(kind: NoticeKind, text: string): void {
		const now = Date.now();
		const last = this.notices[this.notices.length - 1];
		if (last && last.kind === kind && last.text === text) {
			last.count++;
			last.expiresAt = now + NOTICE_TTL_MS;
		} else {
			this.notices.push({ kind, text, count: 1, expiresAt: now + NOTICE_TTL_MS });
		}
		this.invalidate();
		this.scheduleExpiry();
	}

	clear(): void {
		if (this.expireTimer) {
			clearTimeout(this.expireTimer);
			this.expireTimer = undefined;
		}
		this.notices = [];
		this.invalidate();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(_data: string): void {
		// No key handling — display only.
	}

	private scheduleExpiry(): void {
		if (this.expireTimer) {
			clearTimeout(this.expireTimer);
			this.expireTimer = undefined;
		}
		if (this.notices.length === 0) return;
		const earliest = Math.min(...this.notices.map((n) => n.expiresAt));
		this.expireTimer = setTimeout(
			() => {
				this.expireTimer = undefined;
				const now = Date.now();
				if (!this.notices.some((n) => n.expiresAt <= now)) return;
				this.notices = this.notices.filter((n) => n.expiresAt > now);
				this.invalidate();
				this.onExpire?.();
				this.scheduleExpiry();
			},
			Math.max(0, earliest - Date.now()),
		);
	}

	render(width: number): string[] {
		if (this.notices.length === 0) return [];
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		this.cachedWidth = width;

		const lines: string[] = [""];
		const visible = this.notices.slice(-MAX_VISIBLE);
		const hidden = this.notices.length - visible.length;
		if (hidden > 0) {
			lines.push(truncateToWidth(theme.fg("dim", `${INDENT}… ${hidden} earlier hidden`), width));
		}

		for (const notice of visible) {
			const color = notice.kind === "error" ? "error" : "warning";
			const icon = notice.kind === "error" ? "✗" : "⚠";
			const suffix = notice.count > 1 ? theme.fg("muted", ` (×${notice.count})`) : "";
			const body = theme.fg(color, `${icon} ${notice.text}`) + suffix;
			const wrapped = wrapTextWithAnsi(body, Math.max(20, width - INDENT.length - 1));
			for (let i = 0; i < wrapped.length; i++) {
				const line = i === 0 ? `${INDENT}${wrapped[i]}` : `${INDENT}  ${wrapped[i]}`;
				lines.push(truncateToWidth(line, width));
			}
		}

		this.cachedLines = lines;
		return lines;
	}
}

/**
 * Full-screen, scrollable transcript overlay.
 *
 * Rendered as an overlay on top of the live frame. Shows a scrollable view
 * of the conversation history with verbose tool output. Keyboard navigation:
 * ↑/↓ line, PgUp/PgDn page, g/G top/bottom, / search, n/N next/prev match,
 * Esc / Ctrl+Shift+T / q to close.
 *
 * Mirrors easy-agent's TranscriptOverlay + useTranscript, adapted to pi-mono's
 * pi-tui component architecture.
 */

import { Container, getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]|\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

function stripAnsi(s: string): string {
	return s.replace(ANSI_RE, "");
}

export interface TranscriptOverlayOptions {
	tui: TUI;
	/** Pre-rendered lines of the verbose transcript (one string per terminal row). */
	lines: string[];
	/** Called when the overlay should close. */
	onClose: () => void;
}

export class TranscriptOverlayComponent extends Container {
	private lines: string[];
	private onCloseCallback: () => void;
	private scroll = 0;
	private viewportHeight = 0;
	private tui: TUI;
	private keybindings = getKeybindings();
	private searching = false;
	private query = "";
	private matchIndices: number[] = [];
	private matchIdx = 0;

	constructor(opts: TranscriptOverlayOptions) {
		super();
		this.tui = opts.tui;
		this.lines = opts.lines;
		this.onCloseCallback = opts.onClose;

		// Open at the bottom (most recent).
		this.scroll = Math.max(0, this.lines.length - this.getViewportHeight());
	}

	private getViewportHeight(): number {
		const total = this.tui.terminal.rows;
		// Reserve 1 line for header, 1 for search bar (if active), 1 for footer.
		const reserved = 3;
		return Math.max(1, total - reserved);
	}

	private maxScroll(): number {
		return Math.max(0, this.lines.length - this.getViewportHeight());
	}

	private clamp(n: number): number {
		return Math.max(0, Math.min(this.maxScroll(), n));
	}

	private scrollToLine(line: number): void {
		this.scroll = this.clamp(line - 2);
		this.tui.requestRender();
	}

	private computeMatches(): void {
		const q = this.query.toLowerCase();
		this.matchIndices = [];
		if (!q) return;
		for (let i = 0; i < this.lines.length; i++) {
			if (
				stripAnsi(this.lines[i] ?? "")
					.toLowerCase()
					.includes(q)
			) {
				this.matchIndices.push(i);
			}
		}
	}

	handleInput(data: string): boolean {
		const kb = this.keybindings;

		// Search-entry mode: keystrokes build the query.
		if (this.searching) {
			if (kb.matches(data, "app.interrupt") || data === "\x1b") {
				this.searching = false;
				this.query = "";
				this.matchIndices = [];
				this.matchIdx = 0;
				this.tui.requestRender();
				return true;
			}
			if (data === "\r" || data === "\n") {
				// Lock in the query; n/N now cycle.
				this.searching = false;
				this.tui.requestRender();
				return true;
			}
			if (data === "\x7f" || data === "\b") {
				this.query = this.query.slice(0, -1);
				this.computeMatches();
				if (this.matchIndices.length > 0) {
					this.matchIdx = 0;
					this.scrollToLine(this.matchIndices[0]);
				}
				this.tui.requestRender();
				return true;
			}
			// Printable character
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				this.query += data;
				this.computeMatches();
				if (this.matchIndices.length > 0) {
					this.matchIdx = 0;
					this.scrollToLine(this.matchIndices[0]);
				}
				this.tui.requestRender();
				return true;
			}
			return true;
		}

		// Close
		if (kb.matches(data, "app.interrupt") || data === "q" || kb.matches(data, "app.transcript.toggle")) {
			this.onCloseCallback();
			return true;
		}

		// Search entry
		if (data === "/") {
			this.searching = true;
			this.query = "";
			this.matchIndices = [];
			this.matchIdx = 0;
			this.tui.requestRender();
			return true;
		}

		// Search navigation
		if (data === "n" && this.matchIndices.length > 0) {
			this.matchIdx = (this.matchIdx + 1) % this.matchIndices.length;
			this.scrollToLine(this.matchIndices[this.matchIdx]);
			return true;
		}
		if (data === "N" && this.matchIndices.length > 0) {
			this.matchIdx = (this.matchIdx - 1 + this.matchIndices.length) % this.matchIndices.length;
			this.scrollToLine(this.matchIndices[this.matchIdx]);
			return true;
		}

		// Scrolling
		if (data === "\x1b[A" || data === "k") {
			// Up arrow or k
			this.scroll = this.clamp(this.scroll - 1);
			this.tui.requestRender();
			return true;
		}
		if (data === "\x1b[B" || data === "j") {
			// Down arrow or j
			this.scroll = this.clamp(this.scroll + 1);
			this.tui.requestRender();
			return true;
		}
		if (data === "\x1b[5~") {
			// PgUp
			this.scroll = this.clamp(this.scroll - this.getViewportHeight());
			this.tui.requestRender();
			return true;
		}
		if (data === "\x1b[6~" || data === " ") {
			// PgDn or Space
			this.scroll = this.clamp(this.scroll + this.getViewportHeight());
			this.tui.requestRender();
			return true;
		}
		if (data === "g") {
			this.scroll = 0;
			this.tui.requestRender();
			return true;
		}
		if (data === "G") {
			this.scroll = this.maxScroll();
			this.tui.requestRender();
			return true;
		}

		return true; // Consume all other input
	}

	updateLines(lines: string[]): void {
		this.lines = lines;
		this.scroll = this.clamp(this.scroll);
		this.tui.requestRender();
	}

	override render(_width: number): string[] {
		const total = this.tui.terminal.rows;
		this.viewportHeight = this.getViewportHeight();

		const result: string[] = [];

		// Header
		const end = Math.min(this.scroll + this.viewportHeight, this.lines.length);
		const atTop = this.scroll === 0;
		const atBottom = end >= this.lines.length;
		const position =
			this.lines.length === 0
				? "empty"
				: `${this.scroll + 1}–${end} / ${this.lines.length}` +
					(atTop ? "  (top)" : "") +
					(atBottom ? "  (bottom)" : "");

		result.push(`${theme.bg("userMessageBg", theme.fg("accent", " Transcript "))}  ${theme.fg("muted", position)}`);

		// Content window
		const window = this.lines.slice(this.scroll, this.scroll + this.viewportHeight);
		while (window.length < this.viewportHeight) {
			window.push("");
		}
		for (const line of window) {
			result.push(line);
		}

		// Search bar (visible while typing or once a query is locked)
		if (this.searching || this.query) {
			const matchInfo = this.query
				? this.matchIndices.length > 0
					? `   ${this.matchIdx + 1}/${this.matchIndices.length} matches`
					: "   no matches"
				: "";
			const cursor = this.searching ? theme.inverse(" ") : "";
			result.push(`${theme.fg("accent", "/")}${this.query}${cursor}${theme.fg("muted", matchInfo)}`);
		}

		// Footer
		const footer = this.searching
			? "type to search · Enter confirm · Esc cancel"
			: "↑/↓ scroll · / search · n/N next/prev · g/G top/bottom · Esc / q close";
		result.push(theme.fg("muted", footer));

		// Pad to full height
		while (result.length < total) {
			result.push("");
		}

		return result;
	}
}

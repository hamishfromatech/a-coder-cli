/**
 * Welcome banner — the startup hero shown once at the top of the session.
 *
 * Mirrors easy-agent's WelcomeBanner layout, adapted to pi-mono's pi-tui:
 * - ASCII art wordmark with a vertical accent gradient (truecolor only;
 *   falls back to solid accent in 256-color mode)
 * - Subtitle line (tagline + version)
 * - Info block: model, permission mode, cwd
 * - Getting-started tips
 * - Wrapped in a rounded border
 */

import os from "node:os";
import path from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import { getCapabilities } from "@earendil-works/pi-tui";
import type { PermissionMode } from "../../../core/settings-manager.ts";
import { theme } from "../theme/theme.ts";
import { ASCII_LOGO_STACKED, ASCII_LOGO_WIDE } from "./ascii-logo.ts";

export interface WelcomeBannerOptions {
	version: string;
	modelId: string | undefined;
	permissionMode: PermissionMode;
	cwd: string;
}

/** Collapse the home prefix to `~` so the cwd line stays short. */
function prettyCwd(cwd: string): string {
	const home = os.homedir();
	if (cwd === home) return "~";
	if (cwd.startsWith(home + path.sep)) return "~" + cwd.slice(home.length);
	return cwd;
}

/** Parse R;G;B from a truecolor ANSI fg code, or undefined if not truecolor. */
function parseRgbFromAnsi(ansi: string): [number, number, number] | undefined {
	const m = ansi.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
	if (!m) return undefined;
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Interpolate between two RGB colors. t=0 → from, t=1 → to. */
function lerpRgb(from: [number, number, number], to: [number, number, number], t: number): [number, number, number] {
	return [
		Math.round(from[0] + (to[0] - from[0]) * t),
		Math.round(from[1] + (to[1] - from[1]) * t),
		Math.round(from[2] + (to[2] - from[2]) * t),
	];
}

function rgbAnsi(rgb: [number, number, number]): string {
	return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

/** Permission mode display: symbol + label + theme color. */
function modeStyle(mode: PermissionMode): { label: string; color: string; symbol: string } {
	switch (mode) {
		case "ask":
			return { label: "ask", color: theme.getFgAnsi("muted"), symbol: "" };
		case "auto":
			return { label: "auto", color: theme.getFgAnsi("warning"), symbol: "\u23F5\u23F5" }; // ⏵⏵
		case "read-only":
			return { label: "read-only", color: theme.getFgAnsi("success"), symbol: "\u23F8" }; // ⏸
		case "allow":
			return { label: "allow", color: theme.getFgAnsi("warning"), symbol: "\u23F5\u23F5" }; // ⏵⏵
	}
}

export class WelcomeBannerComponent implements Component {
	private version: string;
	private modelId: string | undefined;
	private permissionMode: PermissionMode;
	private cwd: string;

	constructor(opts: WelcomeBannerOptions) {
		this.version = opts.version;
		this.modelId = opts.modelId;
		this.permissionMode = opts.permissionMode;
		this.cwd = opts.cwd;
	}

	invalidate(): void {
		// Stateless — nothing to invalidate.
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 4); // border (2) + padding (2)
		const lines: string[] = [];

		// === Logo with vertical gradient ===
		// Pick the single-line wordmark when it fits the bordered box, else the
		// two-row stack. Overhead = round border (2) + padding (1*2) = 4 cols.
		const logo = width - 4 >= 78 ? ASCII_LOGO_WIDE : ASCII_LOGO_STACKED;

		const accentAnsi = theme.getFgAnsi("accent");
		const accentRgb = parseRgbFromAnsi(accentAnsi);
		const caps = getCapabilities();
		const canGradient = accentRgb !== undefined && caps.trueColor;

		// Gradient: accent → a lighter version of accent (lifted 25% toward white).
		const fromRgb: [number, number, number] = accentRgb ?? [0, 0, 0];
		const toRgb: [number, number, number] = canGradient ? lerpRgb(fromRgb, [255, 255, 255], 0.25) : fromRgb;

		for (let i = 0; i < logo.length; i++) {
			const row = logo[i] ?? "";
			if (canGradient) {
				const t = logo.length <= 1 ? 0 : i / (logo.length - 1);
				const rgb = lerpRgb(fromRgb, toRgb, t);
				lines.push(`${rgbAnsi(rgb)}${row}\x1b[39m`);
			} else {
				lines.push(`${accentAnsi}${row}\x1b[39m`);
			}
		}

		// === Subtitle ===
		lines.push("");
		lines.push(`${theme.fg("muted", "Terminal-native coding agent  ")}${theme.fg("accent", `v${this.version}`)}`);

		// === Info block ===
		lines.push("");
		const mode = modeStyle(this.permissionMode);
		const modeChip = mode.symbol ? `${mode.symbol} ${mode.label}` : mode.label;
		const modelDisplay = this.modelId ?? "no model";
		lines.push(
			`${theme.fg("muted", "model  ")}${theme.fg("accent", modelDisplay)}` +
				`${theme.fg("muted", "   mode  ")}${mode.color}${theme.bold(`[ ${modeChip} ]`)}\x1b[39m`,
		);
		lines.push(`${theme.fg("muted", "cwd    ")}${prettyCwd(this.cwd)}`);

		// === Tips ===
		lines.push("");
		const tips = [
			"Type a message to start, or /help to list commands.",
			"/clear resets the conversation · /mode switches permissions.",
			"Ctrl+C interrupts a turn · Ctrl+D exits.",
		];
		for (const tip of tips) {
			lines.push(` ${theme.fg("accent", "•")} ${theme.fg("muted", tip)}`);
		}

		// === Wrap in a rounded border ===
		return wrapInBorder(lines, innerWidth, width);
	}
}

/** Wrap content lines in a rounded border box, padded and width-filled. */
function wrapInBorder(contentLines: string[], innerWidth: number, fullWidth: number): string[] {
	const borderColor = theme.getFgAnsi("borderAccent");
	const reset = "\x1b[39m";

	// Top border: ╭──...──╮
	const topBorder = `${borderColor}╭${"─".repeat(Math.max(1, fullWidth - 2))}╮${reset}`;
	// Bottom border: ╰──...──╯
	const bottomBorder = `${borderColor}╰${"─".repeat(Math.max(1, fullWidth - 2))}╯${reset}`;
	// Empty side: │  ...  │
	const emptySide = `${borderColor}│${" ".repeat(Math.max(1, fullWidth - 2))}│${reset}`;

	const result: string[] = [topBorder, emptySide];

	for (const line of contentLines) {
		// Strip ANSI for width measurement, pad to innerWidth, then re-add side borders.
		const stripped = stripAnsi(line);
		const padNeeded = Math.max(0, innerWidth - stripped.length);
		const padded = `${line}${" ".repeat(padNeeded)}`;
		// Truncate if too long (shouldn't happen, but safety)
		const truncated = stripped.length > innerWidth ? padded.slice(0, innerWidth) : padded;
		result.push(`${borderColor}│${reset} ${truncated} ${borderColor}│${reset}`);
	}

	result.push(emptySide, bottomBorder);
	return result;
}

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s: string): string {
	return s.replace(ANSI_RE, "");
}

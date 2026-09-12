/**
 * Shared settled-result headline primitives for built-in tool renderers.
 *
 * Every settled tool card answers "did it work, and what did it get?" with
 * one headline line — glyph + outcome stats — before any content:
 *
 *   ✓ 40 lines
 *   ✓ 3 matches in 2 files
 *   ✓ +12 −4
 *   ✓ exit 0 · 1.2s
 *   ✗ exit 1 · 3.4s
 *
 * Cards that show content collapsed also share one preview budget and one
 * "N more …" footer phrasing so expansion affordances look identical across
 * tools.
 */

import { getKeybindings } from "@earendil-works/pi-tui";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

export type ToolOutcome = "success" | "error";

/** Colored terminal glyph for a settled result. */
export function resultGlyph(outcome: ToolOutcome, theme: Theme): string {
	return outcome === "success" ? theme.fg("success", "✓") : theme.fg("error", "✗");
}

/**
 * One-line settled-result headline: colored glyph + plain stats.
 * `stats` may be empty (renders just the glyph).
 */
export function formatHeadline(outcome: ToolOutcome, theme: Theme, stats?: string): string {
	return stats ? `${resultGlyph(outcome, theme)} ${theme.fg("toolOutput", stats)}` : resultGlyph(outcome, theme);
}

/**
 * Unified truncation footer: `(N more lines, ctrl+shift+o to expand)`.
 * `unit` varies per tool (lines / matches / entries / results); `earlier`
 * flips the wording for head-truncated output (bash keeps the tail).
 */
export function moreLinesFooter(
	theme: Theme,
	remaining: number,
	unit = "lines",
	options?: { earlier?: boolean },
): string {
	const where = options?.earlier ? "earlier" : "more";
	// Without an active keybinding registry (bare component tests) the key
	// slot is empty — fall back to the bare verb so the paren stays clean.
	const keys = getKeybindings().getKeys("app.tools.expand");
	const expandHint = keys.length > 0 ? keyHint("app.tools.expand", "to expand") : theme.fg("muted", "to expand");
	return `${theme.fg("muted", `... (${remaining} ${where} ${unit},`)} ${expandHint}${theme.fg("muted", ")")}`;
}

/** Count added/removed lines in a unified-diff patch (ignores +++/--- headers). */
export function diffStats(patch: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

/** Colored `+A −B` stat fragment for diffs. */
export function formatDiffStats(theme: Theme, added: number, removed: number): string {
	return `${theme.fg("success", `+${added}`)} ${theme.fg("error", `−${removed}`)}`;
}

/** First line of an error message, for ✗ headlines that quote it. */
export function firstErrorLine(text: string, maxLen = 80): string {
	const line = text.split("\n", 1)[0]?.trim() ?? "";
	return line.length <= maxLen ? line : `${line.slice(0, maxLen - 1)}…`;
}

/**
 * Collapsed generic-result block for tools without custom renderers (MCP,
 * bare extension tools): headline + preview lines + unified footer instead
 * of the raw output dump.
 */
export function formatPreviewResult(lines: string[], isError: boolean, theme: Theme, previewCount = 3): string {
	const headline = formatHeadline(isError ? "error" : "success", theme, isError ? undefined : `${lines.length} lines`);
	const shown = lines.slice(0, previewCount);
	const body = shown.map((line) => `  ${isError ? theme.fg("error", line) : theme.fg("toolOutput", line)}`);
	const remaining = lines.length - shown.length;
	if (remaining > 0) {
		body.push(`  ${moreLinesFooter(theme, remaining)}`);
	}
	return `\n${[headline, ...body].join("\n")}`;
}

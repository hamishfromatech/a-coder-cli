/**
 * `/context` — context-window breakdown (easy-agent/Claude Code parity).
 *
 * Visualizes how the context window is currently split across System prompt /
 * Tool definitions / Conversation history / Free space as proportional bars.
 * Estimates reuse the same token heuristics the auto-compactor relies on for
 * history (estimateContextTokens) and chars/4, chars/2 rough counts for text
 * and JSON payloads (mirrors easy-agent's roughText/roughJson).
 */

import { theme } from "./theme/theme.ts";

const BAR_WIDTH = 20;

/** Rough token estimate for plain text (chars / 4). */
export function roughTextTokens(text: string): number {
	return Math.max(0, Math.round(text.length / 4));
}

/** Rough token estimate for JSON blobs (chars / 2 — JSON is denser). */
export function roughJsonTokens(text: string): number {
	return Math.max(0, Math.round(text.length / 2));
}

export interface ContextBreakdownInput {
	modelId: string;
	contextWindow: number;
	systemPrompt: string;
	/** JSON string of the active tool definitions sent to the model. */
	toolsJson: string;
	historyTokens: number;
}

function bar(tokens: number, contextWindow: number): string {
	const filled = Math.min(BAR_WIDTH, Math.max(0, Math.round((tokens / Math.max(1, contextWindow)) * BAR_WIDTH)));
	return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function row(label: string, tokens: number, contextWindow: number): string {
	const pct = `${((tokens / Math.max(1, contextWindow)) * 100).toFixed(1)}%`.padStart(6);
	const count = tokens.toLocaleString("en-US").padStart(8);
	return `  ${theme.fg("muted", label.padEnd(22))} ${bar(tokens, contextWindow)} ${theme.fg("dim", pct)}  ${theme.fg("text", count)} tok`;
}

/** Build the `/context` output lines (already theme-colored). */
export function buildContextBreakdownLines(input: ContextBreakdownInput): string[] {
	const { modelId, contextWindow, systemPrompt, toolsJson, historyTokens } = input;

	const systemTokens = roughTextTokens(systemPrompt);
	const toolTokens = roughJsonTokens(toolsJson);
	const used = systemTokens + toolTokens + historyTokens;
	const free = Math.max(0, contextWindow - used);

	const fmt = (n: number): string => n.toLocaleString("en-US");
	const lines = [
		`${theme.bold(`Context usage (${modelId})`)}`,
		"",
		`${theme.fg("muted", `Context window: ${fmt(contextWindow)} tokens`)}`,
		"",
		row("System prompt", systemTokens, contextWindow),
		row("Tool definitions", toolTokens, contextWindow),
		row("Conversation history", historyTokens, contextWindow),
		row("Free space", free, contextWindow),
		"",
		`${theme.fg("dim", `Estimated used: ${fmt(used)} / ${fmt(contextWindow)} (${((used / Math.max(1, contextWindow)) * 100).toFixed(1)}%)`)}`,
	];

	// Auto-compaction kicks in well before the window is exhausted; surface the
	// ballpark so /compact stays discoverable.
	if (contextWindow > 0 && used >= contextWindow * 0.8) {
		lines.push("", theme.fg("warning", "⚠ Approaching the auto-compact threshold — consider /compact."));
	}
	return lines;
}

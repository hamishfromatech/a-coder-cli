/**
 * Format a millisecond duration as a compact, escalating string used across
 * the TUI (bash timing, background processes/sub-agents, the working spinner).
 *
 * Escalates through whole units rather than a flat seconds count or a
 * composite like "1m30s", so long durations read cleanly:
 *   < 1s      → "820ms"
 *   < 1min    → "4.2s" / "42s"
 *   < 1h      → "12m"
 *   < 1d      → "3h"
 *   otherwise → "2d"
 *
 * Whole units only — once a duration crosses a boundary it shows the next
 * unit, never a mix (e.g. 90s is "1m", not "1m30s").
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatDuration(ms: number): string {
	const totalMs = Math.max(0, Math.round(ms));
	if (totalMs < 1000) return `${totalMs}ms`;
	if (totalMs < MIN) {
		const sec = totalMs / 1000;
		return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
	}
	if (totalMs < HOUR) return `${Math.floor(totalMs / MIN)}m`;
	if (totalMs < DAY) return `${Math.floor(totalMs / HOUR)}h`;
	return `${Math.floor(totalMs / DAY)}d`;
}

import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { InProcessSubAgentRecord } from "../../../core/extensions/types.ts";
import { theme } from "../theme/theme.ts";

/**
 * Live progress card for an in-process (background) sub-agent.
 *
 * Mounted by InteractiveMode (once per sub-agent id) and refreshed on every
 * {@link SubAgentProgressEvent} via {@link AgentSession.subscribeSubAgents}.
 * Rendered in the CLI as a compact, single-line status that updates in place
 * while the sub-agent runs:
 *
 *   ⚡ Agent[Explore] · running · 3 tool uses · last: Read · 3.2s
 *
 * and freezes to a terminal glyph on completion:
 *
 *   ✓ Done · 7 tool uses · 12.3s
 *
 * Failure / kill variants swap the leading glyph and tag. Cards are kept after
 * completion (grayed via their terminal glyph) so the user can see what ran;
 * the set is cleared on session_start / rebind.
 */
export class SubAgentCardComponent extends Container {
	private record: InProcessSubAgentRecord;
	private readonly label: Text;

	constructor(record: InProcessSubAgentRecord) {
		super();
		this.record = record;
		this.addChild(new Spacer(1));
		this.label = new Text(this.formatLine(), 2, 0);
		this.addChild(this.label);
	}

	/** Refresh the card with a new record snapshot. */
	update(record: InProcessSubAgentRecord): void {
		this.record = record;
		this.label.setText(this.formatLine());
		this.label.invalidate();
	}

	private formatLine(): string {
		const r = this.record;
		const elapsed = formatDuration(Date.now() - r.startedAt);
		const label = `Agent[${r.agentType}]`;
		const count = formatCount(r.toolUseCount);
		const trail = ` · ${elapsed}`;

		if (r.status === "running") {
			const last = r.lastToolName ? ` · last: ${r.lastToolName}` : "";
			const uses = r.toolUseCount > 0 ? `${count} · running${last}` : "starting…";
			return theme.fg("accent", "⚡ ") + theme.bold(label) + theme.fg("dim", ` · ${uses}${trail}`);
		}
		if (r.status === "completed") {
			return theme.fg("success", "✓ ") + theme.bold(label) + theme.fg("dim", ` · Done · ${count}${trail}`);
		}
		if (r.status === "killed") {
			const err = r.error ? theme.fg("error", ` · ${r.error}`) : "";
			return theme.fg("warning", "⊘ ") + theme.bold(label) + theme.fg("dim", ` · Killed · ${count}${trail}`) + err;
		}
		// failed
		const err = r.error ? theme.fg("error", ` · ${r.error}`) : "";
		return theme.fg("error", "✗ ") + theme.bold(label) + theme.fg("dim", ` · Failed · ${count}${trail}`) + err;
	}

	override invalidate(): void {
		super.invalidate();
		this.label.invalidate();
	}
}

function formatCount(n: number): string {
	return `${n} tool use${n === 1 ? "" : "s"}`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(1)}s`;
	const min = Math.floor(sec / 60);
	const rem = Math.round(sec - min * 60);
	return `${min}m${rem}s`;
}

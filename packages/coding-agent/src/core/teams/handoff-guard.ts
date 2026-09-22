/**
 * Repetitive-handoff detection for Agent Teams (ported from strand-agent-tools'
 * swarm guardrails).
 *
 * Teams coordinate through send_message; nothing structurally prevents two
 * members from bouncing the same request back and forth indefinitely. The
 * guard keeps a rolling window of the most recent directed handoffs
 * (sender -> recipient) and flags when the window collapses onto fewer unique
 * pairs than a healthy collaboration needs — the same signal upstream's Swarm
 * uses to stop ping-pong loops (`repetitive_handoff_detection_window` /
 * `repetitive_handoff_min_unique_agents`).
 *
 * Detection is advisory: the caller (send_message) appends the warning to the
 * tool result so the model can change course. It fires once when the loop
 * condition is first met and again only after the pattern has broken.
 */

/** Rolling window size (handoffs examined). */
export const HANDOFF_WINDOW = 8;

/** Minimum distinct sender->recipient pairs expected across the window. */
export const HANDOFF_MIN_UNIQUE = 3;

export interface HandoffRecord {
	from: string;
	to: string;
	at: number;
}

export class HandoffGuard {
	private recent: HandoffRecord[] = [];
	private repetitive = false;

	/**
	 * Record one handoff. Returns an advisory string when the recent window
	 * has become repetitive (only on entering that state, not on every call).
	 */
	record(from: string, to: string): string | undefined {
		this.recent.push({ from, to, at: Date.now() });
		if (this.recent.length > HANDOFF_WINDOW) {
			this.recent.splice(0, this.recent.length - HANDOFF_WINDOW);
		}

		if (this.recent.length < HANDOFF_WINDOW) {
			return undefined;
		}

		const uniquePairs = new Set(this.recent.map((r) => `${r.from}->${r.to}`));
		if (uniquePairs.size >= HANDOFF_MIN_UNIQUE) {
			this.repetitive = false;
			return undefined;
		}
		if (this.repetitive) {
			return undefined;
		}
		this.repetitive = true;

		return (
			`Repetitive handoff detected: only ${uniquePairs.size} distinct sender->recipient pair(s) across the last ${HANDOFF_WINDOW} messages ` +
			`(${[...uniquePairs].join(", ")}). Loops between the same agents burn tokens without progress — ` +
			`break the cycle: consolidate the work with one owner, add a new teammate, or escalate to the user.`
		);
	}

	/** Clear all history (used when a team is disbanded/recreated). */
	reset(): void {
		this.recent = [];
		this.repetitive = false;
	}

	/** Current rolling window (for diagnostics/tests). */
	snapshot(): readonly HandoffRecord[] {
		return this.recent;
	}
}

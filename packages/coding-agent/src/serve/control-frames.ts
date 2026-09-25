/**
 * Bridge-owned control frames.
 *
 * The bridge forwards the engine's NDJSON protocol verbatim (doc: mobile-app/plan/03).
 * The ONLY envelope the bridge itself injects is `{"type":"bridge", ...}` so
 * clients can route transport-level notices separately from engine events.
 */

export type BridgeEvent =
	| { type: "bridge"; event: "server_version"; version: string }
	| { type: "bridge"; event: "connected"; clients: number }
	| { type: "bridge"; event: "engine_exited"; code: number | null }
	| { type: "bridge"; event: "engine_failed"; attempts: number }
	| { type: "bridge"; event: "shutting_down" };

export function bridgeFrame(event: BridgeEvent): string {
	// Control frames carry a schema version so mobile clients can evolve safely.
	return `${JSON.stringify({ v: 1, ...event })}\n`;
}

/** True when a parsed inbound message is a bridge control frame (never forwarded to the engine). */
export function isBridgeFrame(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const frame = value as { type?: unknown; event?: unknown };
	return frame.type === "bridge" && typeof frame.event === "string";
}

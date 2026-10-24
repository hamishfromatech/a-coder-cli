/**
 * Bridge-owned control frames.
 *
 * The bridge forwards the engine's NDJSON protocol verbatim (doc: mobile-app/plan/03).
 * The ONLY envelope the bridge itself injects is `{"type":"bridge", ...}` so
 * clients can route transport-level notices separately from engine events.
 */

/**
 * Bridge protocol contract version. Bump when the bridge frame vocabulary or
 * delivery semantics change incompatibly; clients compare it against the range
 * they support after the server_version handshake.
 */
export const BRIDGE_CONTRACT = 1;

export type BridgeEvent =
	| { type: "bridge"; event: "server_version"; version: string; contract: number }
	| { type: "bridge"; event: "connected"; clients: number }
	| { type: "bridge"; event: "engine_exited"; code: number | null }
	| { type: "bridge"; event: "engine_failed"; attempts: number }
	/**
	 * A client command was not delivered. `starting` = no running engine yet
	 * (spawning or restarting); `backlog` = engine alive but its stdin queue is
	 * full, so the command should be retried once it drains. `id` is the dropped
	 * command's correlation id when its line parsed, letting the client fail
	 * that waiting request immediately instead of timing out.
	 */
	| { type: "bridge"; event: "engine_unavailable"; reason: "starting" | "backlog"; id?: string }
	| { type: "bridge"; event: "shutting_down" }
	/** The client's socket could not keep up; it is about to be closed (doc 04 §4). */
	| { type: "bridge"; event: "slow_client"; ip: string };

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

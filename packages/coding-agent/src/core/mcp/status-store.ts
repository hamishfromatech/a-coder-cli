/**
 * Process-wide store of MCP server connection statuses.
 *
 * The MCP inline extension updates this as background (eager) and lazy
 * connects resolve; the footer status chip and the `/mcp` command read it.
 * It lives outside the extension closure so the TUI can reach it without
 * holding an extension reference, and so a failed/verbose connect error
 * never has to be written to stderr (which would interleave with the TUI).
 */

export type McpServerStatus = "connecting" | "ok" | "error" | "disabled";

export interface McpServerState {
	name: string;
	status: McpServerStatus;
	/** Error message when status === "error" (may be long, e.g. a Cloudflare 502 body). */
	error?: string;
}

const servers = new Map<string, McpServerState>();

export function setMcpServerState(name: string, state: Omit<McpServerState, "name">): void {
	servers.set(name, { name, ...state });
}

/** Snapshot of all known MCP server states, sorted by name. */
export function getMcpServerStates(): McpServerState[] {
	return Array.from(servers.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Number of servers currently in the "error" state (the footer chip shows this). */
export function countMcpServerErrors(): number {
	let count = 0;
	for (const state of servers.values()) {
		if (state.status === "error") count++;
	}
	return count;
}

export function clearMcpServerStates(): void {
	servers.clear();
}

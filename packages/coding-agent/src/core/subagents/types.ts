import type { AgentEvent } from "@earendil-works/pi-agent-core";

export type SubagentStatus = "pending" | "running" | "completed" | "failed" | "killed";

export interface SubagentConfig {
	/** Unique id for the subagent task. */
	id: string;
	/** Human-readable task description. */
	task: string;
	/** Optional system prompt override. */
	systemPrompt?: string;
	/** Provider to use (default: inherited from parent session or settings). */
	provider?: string;
	/** Model to use (default: inherited). */
	model?: string;
	/** Maximum runtime in milliseconds (default: 10 minutes). */
	timeoutMs?: number;
	/** When true, start detached and do not block. */
	detached?: boolean;
}

export interface SubagentRecord {
	id: string;
	config: SubagentConfig;
	status: SubagentStatus;
	/** ISO timestamp when the subagent was created. */
	createdAt: string;
	/** ISO timestamp when the subagent finished or was last updated. */
	updatedAt: string;
	/** Last assistant text received from the subagent. */
	lastOutput?: string;
	/** Collected events (truncated if too large). */
	events: AgentEvent[];
	/** Error message if failed/killed. */
	error?: string;
	/** Exit code if the process has exited. */
	exitCode?: number | null;
	/** Session file path used by the subagent, if any. */
	sessionPath?: string;
}

export interface SubagentManagerState {
	agents: SubagentRecord[];
}

/**
 * Workflow run registry — a process-level store of the workflow runs this
 * a-coder process has executed, keyed by run id.
 *
 * Mirrors the background-process store: the run_workflow tool (and saved
 * workflow commands) publish live run summaries as a side-channel (the caller
 * blocks on `await` while agents run, so there is no path to yield events into
 * the agent loop), and hosts subscribe to drive progress surfaces — the TUI
 * widget and the desktop's `workflows_update` RPC stream.
 *
 * Summaries strip agent results and prompts (a fan-out's payloads can be
 * huge; hosts need status, not data). Stop and pause handlers registered by
 * the executing closure make runs stoppable and pausable from outside — the
 * RPC stop command and the /workflows view.
 */

import { createStore } from "../stores/create-store.ts";
import type { WorkflowAgentStatus, WorkflowRunState, WorkflowRunStatus } from "./types.ts";

/** One agent as hosts see it: identity + status, no prompt or result. */
export interface WorkflowAgentSummary {
	seq: number;
	label: string;
	phase: string;
	status: WorkflowAgentStatus;
	error?: string;
}

/** A workflow run as hosts see it: state without payloads. */
export interface WorkflowRunSummary {
	id: string;
	workflowName: string;
	status: WorkflowRunStatus;
	startedAt: number;
	updatedAt: number;
	agentCount: number;
	error?: string;
	phases: string[];
	/** Phase summaries (agent counts, first error) keyed by phase title. */
	steps: Record<string, { stepId: string; rounds: number; error?: string }>;
	agents: WorkflowAgentSummary[];
}

function toSummary(state: WorkflowRunState): WorkflowRunSummary {
	return {
		id: state.id,
		workflowName: state.workflowName,
		status: state.status,
		startedAt: state.startedAt,
		updatedAt: state.updatedAt,
		agentCount: state.agentCount,
		...(state.error !== undefined ? { error: state.error } : {}),
		phases: [...state.phases],
		steps: structuredClone(state.steps),
		agents: state.agents.map((agent) => ({
			seq: agent.seq,
			label: agent.label,
			phase: agent.phase,
			status: agent.status,
			...(agent.error !== undefined ? { error: agent.error } : {}),
		})),
	};
}

interface WorkflowRunEntry {
	summary: WorkflowRunSummary;
	stop?: () => void;
	pause?: (value: boolean) => void;
}

// Throttled like the background-process store: runner events arrive per agent,
// and hosts only need ~10Hz refreshes of run status.
const store = createStore<WorkflowRunEntry>({ throttleMs: 100 });

/**
 * Publish (or refresh) a run's summary. First publish and terminal-status
 * transitions notify immediately; mid-run refreshes are coalesced (hosts only
 * need ~10Hz refreshes while a run is churning through agents).
 */
export function updateWorkflowRun(state: WorkflowRunState): void {
	const existing = store.get(state.id);
	const entry = {
		summary: toSummary(state),
		...(existing?.stop ? { stop: existing.stop } : {}),
		...(existing?.pause ? { pause: existing.pause } : {}),
	};
	if (existing === undefined || state.status !== "running") {
		store.set(state.id, entry);
	} else {
		store.setThrottled(state.id, entry);
	}
}

export function getWorkflowRunSummaries(): WorkflowRunSummary[] {
	return store
		.entries()
		.map(([, entry]) => entry.summary)
		.sort((a, b) => b.startedAt - a.startedAt);
}

export function getWorkflowRunSummary(runId: string): WorkflowRunSummary | undefined {
	return store.get(runId)?.summary;
}

export function subscribeWorkflowRuns(
	listener: (id: string, value: WorkflowRunSummary | undefined) => void,
): () => void {
	return store.subscribe((id, entry) => {
		listener(id, entry?.summary);
	});
}

/** Make a run stoppable from outside the executing closure (idempotent). */
export function registerWorkflowStopHandler(runId: string, stop: () => void): void {
	const existing = store.get(runId);
	if (existing) {
		store.set(runId, { ...existing, stop });
	}
}

/** Make a run pausable from outside the executing closure (idempotent). */
export function registerWorkflowPauseHandler(runId: string, pause: (value: boolean) => void): void {
	const existing = store.get(runId);
	if (existing) {
		store.set(runId, { ...existing, pause });
	}
}

/** Drop the control handlers (run finished or was removed). */
export function clearWorkflowHandlers(runId: string): void {
	const existing = store.get(runId);
	if (existing?.stop || existing?.pause) {
		store.set(runId, { summary: existing.summary });
	}
}

/**
 * Request a stop for a running run: aborts its controller and kills its live
 * agents via the registered handler. Returns false when the run is unknown or
 * no longer stoppable (already finished).
 */
export function stopWorkflowRun(runId: string): boolean {
	const entry = store.get(runId);
	if (!entry?.stop) return false;
	const stop = entry.stop;
	store.set(runId, { summary: entry.summary });
	stop();
	return true;
}

/** Pause or resume a running run via its registered handler. */
export function pauseWorkflowRun(runId: string, value: boolean): boolean {
	const entry = store.get(runId);
	if (!entry?.pause) return false;
	entry.pause(value);
	return true;
}

/** Remove a run from the store entirely. */
export function removeWorkflowRun(runId: string): void {
	store.delete(runId);
}

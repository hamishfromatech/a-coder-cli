/**
 * Workflow run registry — a process-level store of the workflow runs this
 * a-coder process has executed, keyed by run id.
 *
 * Mirrors the background-process store: the run_workflow tool publishes live
 * run summaries as a side-channel (the tool blocks on `await` while agents
 * run, so there is no path to yield events into the agent loop), and hosts
 * subscribe to drive progress surfaces — the TUI widget and the desktop's
 * `workflows_update` RPC stream.
 *
 * Summaries strip step outputs (fan-out results can be huge; hosts need
 * status, not payloads). A stop handler registered by the tool execute
 * closure makes runs stoppable from outside the extension (RPC stop command,
 * /workflows) — it aborts the run's controller and kills its live agents.
 */

import { createStore } from "../stores/create-store.ts";
import type { WorkflowRunState } from "./types.ts";

/** A workflow run as hosts see it: state without step outputs. */
export interface WorkflowRunSummary {
	id: string;
	workflowName: string;
	status: WorkflowRunState["status"];
	startedAt: number;
	updatedAt: number;
	agentCount: number;
	error?: string;
	steps: Record<
		string,
		{
			stepId: string;
			rounds: number;
			error?: string;
		}
	>;
}

function toSummary(state: WorkflowRunState): WorkflowRunSummary {
	const steps: WorkflowRunSummary["steps"] = {};
	for (const [id, step] of Object.entries(state.steps)) {
		steps[id] = {
			stepId: step.stepId,
			rounds: step.rounds,
			...(step.error !== undefined ? { error: step.error } : {}),
		};
	}
	return {
		id: state.id,
		workflowName: state.workflowName,
		status: state.status,
		startedAt: state.startedAt,
		updatedAt: state.updatedAt,
		agentCount: state.agentCount,
		...(state.error !== undefined ? { error: state.error } : {}),
		steps,
	};
}

interface WorkflowRunEntry {
	summary: WorkflowRunSummary;
	stop?: () => void;
}

// Throttled like the background-process store: runner events arrive per step,
// and hosts only need ~10Hz refreshes of run status.
const store = createStore<WorkflowRunEntry>({ throttleMs: 100 });

/**
 * Publish (or refresh) a run's summary. First publish and terminal-status
 * transitions notify immediately; mid-run refreshes are coalesced (hosts only
 * need ~10Hz refreshes while a run is churning through steps).
 */
export function updateWorkflowRun(state: WorkflowRunState): void {
	const existing = store.get(state.id);
	const entry = {
		summary: toSummary(state),
		...(existing?.stop ? { stop: existing.stop } : {}),
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

/** Make a run stoppable from outside the extension (idempotent per run). */
export function registerWorkflowStopHandler(runId: string, stop: () => void): void {
	const existing = store.get(runId);
	if (existing) {
		store.set(runId, { ...existing, stop });
	}
}

/** Drop the stop handler (run finished or was removed). */
export function clearWorkflowStopHandler(runId: string): void {
	const existing = store.get(runId);
	if (existing?.stop) {
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

/** Remove a run from the store entirely. */
export function removeWorkflowRun(runId: string): void {
	store.delete(runId);
}

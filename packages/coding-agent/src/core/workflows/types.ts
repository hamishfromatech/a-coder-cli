/**
 * Script workflow types.
 *
 * A workflow is a plain JavaScript file (meta block + top-level-await body)
 * that orchestrates subagents through runtime primitives: `agent()`,
 * `pipeline()`, `parallel()`, `phase()`, and `log()`, reading invocation input
 * from the `args` global. The script holds the loop, the branching, and the
 * intermediate results; the model's context only sees the final answer.
 *
 * Runs are replayable: the runtime records every agent invocation in start
 * order (`WorkflowRunState.agents`) and persists the state after each agent
 * completes. A resumed run re-executes the script — deterministic because
 * `Date.now()`, `Math.random()`, and `new Date()` throw inside scripts — and
 * each `agent()` call either returns the saved result for a matching prompt or
 * reruns from that point on.
 */

/** Where a saved workflow script was loaded from; project wins collisions. */
export type WorkflowSource = "project" | "user" | "package";

/** A saved workflow script: a .js file with `export const meta = {...}`. */
export interface WorkflowSpec {
	/** Command name (from meta.name; kebab-case). */
	name: string;
	description: string;
	/** Absolute path of the .js file. */
	filePath: string;
	source: WorkflowSource;
	/** Full script source (meta block + body). */
	content: string;
	/**
	 * Optional phase titles declared in meta — advisory grouping shown in
	 * progress/approval surfaces before any phase() call runs. Titles used by
	 * the script but absent here get a group of their own.
	 */
	phases?: string[];
}

/** Lifecycle of one agent invocation inside a run. */
export type WorkflowAgentStatus = "running" | "completed" | "failed" | "stopped";

/** One recorded agent invocation. Entries are start-ordered by `seq`. */
export interface WorkflowAgentLogEntry {
	/** 0-based start order. Assigned synchronously at the `agent()` call. */
	seq: number;
	/** Rendered prompt — the resume key (a changed prompt invalidates the entry). */
	prompt: string;
	/** Progress label (defaults to the prompt's first line). */
	label: string;
	/** Phase title at call time ("main" before any phase() call). */
	phase: string;
	status: WorkflowAgentStatus;
	/** Structured output (schema match) or final text. Set when completed. */
	result?: unknown;
	/** Structured output schema, kept for the /workflows drill-down. */
	schema?: Record<string, unknown>;
	error?: string;
	/** Cumulative tokens reported by the subagent record, when available. */
	tokens?: number;
	startedAt?: number;
	finishedAt?: number;
}

export type WorkflowRunStatus = "running" | "paused" | "completed" | "failed" | "stopped";

export interface WorkflowRunState {
	/** Unique run id (kebab slug + timestamp supplied by the caller). */
	id: string;
	workflowName: string;
	/** Path of the script the run executed, when it came from a saved file. */
	scriptPath?: string;
	status: WorkflowRunStatus;
	startedAt: number;
	updatedAt: number;
	/** Total agents recorded so far (== agents.length). */
	agentCount: number;
	/** Phase titles in first-use order. */
	phases: string[];
	/**
	 * Phase summaries keyed by title — `{ stepId, rounds, error }` per phase.
	 * Kept structurally compatible with the cloud package's run-state reader
	 * (cloud/src/workflows.ts parses it as plain JSON): rounds holds the
	 * number of agents recorded in the phase.
	 */
	steps: Record<string, { stepId: string; rounds: number; error?: string }>;
	/** Start-ordered agent log — the resume/replay source of truth. */
	agents: WorkflowAgentLogEntry[];
	/** The exact script this run executed, so it can be saved as a command. */
	scriptContent: string;
	/** The script's return value, set when the run completes. */
	returnValue?: unknown;
	error?: string;
}

/** Why an agent invocation failed — decides null vs throw in the script. */
export type WorkflowAgentFailureKind = "agent-failed" | "invalid-output";

export type WorkflowAgentInvocationResult =
	| { ok: true; output: unknown }
	| { ok: false; error: string; kind: WorkflowAgentFailureKind };

/**
 * Host-wired agent executor. The runtime calls this for each fresh agent()
 * invocation; the host spawns a real background subagent, validates structured
 * output against the schema (with retries), and reports the outcome.
 */
export type WorkflowAgentInvoker = (request: {
	id: string;
	prompt: string;
	label: string;
	schema?: Record<string, unknown>;
	model?: string;
	agentType?: string;
	/**
	 * Called by the host when the subagent's response begins (its first
	 * progress event) — the signal that releases fan-out siblings held by the
	 * prompt-cache stagger.
	 */
	onResponseBegin?: () => void;
}) => Promise<WorkflowAgentInvocationResult>;

export type WorkflowRuntimeEvent =
	| { type: "run_start"; runId: string; workflow: string }
	| { type: "phase"; phase: string }
	| { type: "agent_start"; seq: number; label: string; phase: string; agents: number }
	| { type: "agent_end"; seq: number; status: WorkflowAgentStatus }
	| { type: "log"; message: string }
	| { type: "run_end"; status: Exclude<WorkflowRunStatus, "running" | "paused">; agents: number };

export interface WorkflowRuntimeOptions {
	/** Host-wired agent executor (background subagents + schema validation). */
	invoker: WorkflowAgentInvoker;
	/** Max agents running at once (user-configurable, 1-256). */
	maxConcurrent: number;
	/**
	 * Hold matching fan-out siblings until the first response begins, so their
	 * first requests read the shared prompt-cache prefix (0 disables).
	 */
	staggerMs?: number;
	/** Called with runtime events for progress surfaces. */
	onEvent?: (event: WorkflowRuntimeEvent) => void;
	/** Abort signal (session teardown / user stop). */
	signal?: AbortSignal;
	/** Called after each state mutation; omitted = in-memory only. */
	persist?: (state: WorkflowRunState) => void;
}

/** Advisory thresholds. */
export const WORKFLOW_WARN_AGENTS = 25;
export const WORKFLOW_MAX_AGENTS = 1000;
export const WORKFLOW_DEFAULT_MAX_CONCURRENT = 16;
export const WORKFLOW_MAX_CONCURRENT_LIMIT = 256;
export const WORKFLOW_STRUCTURED_OUTPUT_RETRIES = 5;
/** Hard item cap per pipeline()/parallel() call — a silent cap would drop work. */
export const WORKFLOW_MAX_ITEMS = 4096;
/** Hard wall-clock budget per run (ms). */
export const WORKFLOW_MAX_RUN_MS = 50 * 60 * 1000;

/** Default hold for matching fan-out siblings until the first response begins (ms). */
export const WORKFLOW_DEFAULT_STAGGER_MS = 5000;
/** Upper bound for the stagger hold setting (ms). */
export const WORKFLOW_MAX_STAGGER_MS = 60_000;

/** Phase title for agents spawned before any phase() call. */
export const WORKFLOW_DEFAULT_PHASE = "main";

/**
 * Kill reason that marks a user-requested agent restart (the /workflows "r"
 * action): the invoker sees it on the killed record and respawns the same
 * request instead of resolving agent() to null. Any other kill reason — a
 * stopped run, an individually stopped agent — resolves to null as usual.
 */
export const WORKFLOW_AGENT_RESTART_REASON = "workflow agent restart requested";

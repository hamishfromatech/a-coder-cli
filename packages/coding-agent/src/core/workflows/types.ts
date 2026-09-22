/**
 * Declarative SOP workflow types.
 *
 * A workflow is a `.sop.md` file whose frontmatter carries a machine-readable
 * `workflow.steps` array that the runner executes, mirroring the human-readable
 * markdown Steps (the SOP remains the source of truth for a person; the
 * frontmatter is what the runner interprets — same split as `parameters`).
 *
 * Step vocabulary (see docs/sops.md "Workflows"):
 *   run      — one agent; output = its structured result (or prose string)
 *   fan-out  — one agent per item of a previous step's array output
 *   loop     — any step may declare until/max_rounds/stop_on_no_progress to
 *              rerun itself until a declarative predicate over its output holds
 *
 * Data flows between steps as JSON: prompts interpolate `${item}` (fan-out
 * item), `${stepId}` / `${stepId.path}` (earlier outputs), and `${args.x}`.
 * There is deliberately no scripting: every transformation is itself an agent
 * step, which keeps workflows inspectable and replay-safe.
 */

export type WorkflowStepType = "run" | "fan-out";

/** A declarative condition evaluated against a step's structured output. */
export interface WorkflowPredicate {
	/** Path into the output object; omitted = the whole output. Dot-separated. */
	path?: string;
	/** Succeeds when the value at `path` deeply equals this literal. */
	equals?: unknown;
	/** Succeeds when the value at `path` does NOT deeply equal this literal. */
	notEquals?: unknown;
	/** Succeeds when the value at `path` exists (is not undefined). */
	exists?: boolean;
}

export interface WorkflowStep {
	/** Unique step id; referenced by later steps' `over` / interpolations. */
	id: string;
	type: WorkflowStepType;
	/** Agent prompt template (supports ${item}, ${stepId.path}, ${args.x}). */
	prompt: string;
	/** JSON Schema the agent's output must match; triggers structured output + validation retries. */
	schema?: Record<string, unknown>;
	/** fan-out only: "<stepId>" or "<stepId>.<path>" resolving to an array. */
	over?: string;
	/** Label template for progress display (defaults to a truncation of the prompt). */
	label?: string;
	/** Model override for this step's agents. */
	model?: string;
	/** Named subagent type (defaults to general-purpose). */
	agent_type?: string;
	/** Rerun this step until `until` holds (or budget exhausted). */
	until?: WorkflowPredicate;
	/** Max executions of this step (default 1; with `until`, default 3). */
	max_rounds?: number;
	/** Stop the loop after N consecutive rounds with identical output. */
	stop_on_no_progress?: number;
}

export interface WorkflowSpec {
	name: string;
	description: string;
	/** Absolute path of the .sop.md file. */
	filePath: string;
	/** Where the file was loaded from; project wins collisions over user. */
	source: "project" | "user";
	steps: WorkflowStep[];
}

// ============================================================================
// Run state (persisted per run for resume/replay)
// ============================================================================

export interface WorkflowRunStepResult {
	stepId: string;
	/** Executions of this step (loop rounds). */
	rounds: number;
	/** Output per round; fan-out rounds hold per-item arrays (null on failure). */
	outputs: unknown[];
	/** Prompt of the LAST round — the resume key (a prompt change invalidates the step). */
	lastPrompt?: string;
	error?: string;
}

export type WorkflowRunStatus = "running" | "completed" | "failed" | "stopped";

export interface WorkflowRunState {
	/** Unique run id (kebab slug + timestamp supplied by the caller). */
	id: string;
	workflowName: string;
	filePath: string;
	status: WorkflowRunStatus;
	startedAt: number;
	updatedAt: number;
	/** Completed step results, keyed by step id. */
	steps: Record<string, WorkflowRunStepResult>;
	/** Total agents spawned so far. */
	agentCount: number;
	error?: string;
}

/** Advisory thresholds, mirroring upstream's large-run warning. */
export const WORKFLOW_WARN_AGENTS = 25;
export const WORKFLOW_MAX_AGENTS = 1000;
export const WORKFLOW_DEFAULT_MAX_CONCURRENT = 16;
export const WORKFLOW_MAX_CONCURRENT_LIMIT = 256;
export const WORKFLOW_STRUCTURED_OUTPUT_RETRIES = 5;
/** Hard wall-clock budget per run (ms) — upstream's preview-era 50-minute bound. */
export const WORKFLOW_MAX_RUN_MS = 50 * 60 * 1000;

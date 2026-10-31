/**
 * Cron jobs — scheduled tasks for the main coding agent.
 *
 * Where office errands schedule coworker work, cron jobs schedule the main
 * agent: at the appointed time the job's prompt is delivered into the
 * project's active session (queued behind a running turn), or — when the
 * project has no open session — into a continuity side session for that
 * project, so results land in the session tree either way.
 *
 * Jobs persist in `<agentDir>/cron/jobs.json` and are scoped to the project
 * (cwd) they were created from.
 */

/** Same schedule family as office errands — the math is shared — plus
 *  event triggers fired by the host (a turn ending, a commit landing). */
export type CronEventTrigger = "turn_end" | "git_commit";

export type CronSchedule =
	| { kind: "every"; minutes: number }
	| { kind: "daily"; time: string }
	/** Weekly at local `time`; `days` uses JavaScript day numbers (0 = Sunday). */
	| { kind: "weekly"; days: number[]; time: string }
	| { kind: "once"; at: number }
	| { kind: "event"; trigger: CronEventTrigger; cooldownMinutes?: number };

export type CronJobStatus = "ok" | "error" | "timeout";

/** How overlapping triggers for one routine are handled. */
export type CronConcurrencyPolicy = "skip_if_active" | "coalesce_if_active" | "always_enqueue";

/** What to do when the process was not running for one or more scheduled windows. */
export type CronCatchUpPolicy = "run_once" | "skip_missed";

/** A non-secret input substituted into the routine prompt as `{{name}}`. */
export interface CronVariable {
	name: string;
	value: string;
}

export type CronTriageOutcome = "ok" | "no_work" | "needs_user" | "failed";
export type CronTriageAction = "notify" | "quiet" | "retry" | "pause";

/** Post-run triage from a System One decision model. This is advisory: the
 * service records the recommendation, but never silently retries or pauses a
 * user's schedule in this slice. */
export interface CronTriageDecision {
	/** Unavailable means the decision model could not be reached or failed. */
	outcome: CronTriageOutcome | "unavailable";
	recommendedAction: CronTriageAction;
	/** Probability that the user should be notified. */
	notify: number;
	/** Probability that another attempt is worth making. */
	retry: number;
	/** Probability that the recurring task should be paused. */
	pause: number;
	probabilities?: Record<string, number>;
	model?: string;
	latencyMs?: number;
	error?: string;
}

export interface CronJob {
	id: string;
	/** Display name (e.g. "Morning CI triage"). */
	name: string;
	/** The prompt delivered to the agent at fire time. */
	prompt: string;
	schedule: CronSchedule;
	enabled: boolean;
	/** Project the job runs in (delivery targets sessions with this cwd). */
	cwd: string;
	createdAt: number;
	/** Epoch ms of the last (attempted) fire. */
	lastRunAt?: number;
	/** Next scheduled fire (epoch ms); recomputed after every fire/enable. */
	nextRunAt?: number;
	lastStatus?: CronJobStatus;
	lastError?: string;
	/**
	 * Session file backing the job's background runs. Set after the first
	 * off-session fire; reused so repeat runs share context (continuity).
	 */
	sessionFile?: string;
	/** Watermark for `git_commit` event jobs: the last commit head fired on. */
	lastGitHead?: string;
	/** Most recent post-run triage, for the task list. */
	lastTriage?: CronTriageDecision;
	/** Overlap policy. Missing values use the service default. */
	concurrencyPolicy?: CronConcurrencyPolicy;
	/** Missed-window policy. Missing values use `run_once`. */
	catchUpPolicy?: CronCatchUpPolicy;
	/** Non-secret values substituted into `prompt` at fire time. */
	variables?: CronVariable[];
	/** Run each fire in an isolated background subagent (default true). */
	isolated?: boolean;
	/** Monotonic configuration revision; starts at 1. */
	revision?: number;
}

/** The user-editable part of a routine, snapshotted into revision history. */
export interface CronJobConfig {
	name: string;
	prompt: string;
	schedule: CronSchedule;
	enabled: boolean;
	concurrencyPolicy: CronConcurrencyPolicy;
	catchUpPolicy: CronCatchUpPolicy;
	variables: CronVariable[];
	isolated: boolean;
}

export type CronRevisionReason = "create" | "update" | "restore";

export interface CronJobRevision {
	id: string;
	jobId: string;
	/** Revision number after this snapshot was saved. */
	revision: number;
	createdAt: number;
	reason: CronRevisionReason;
	config: CronJobConfig;
}

export interface CronSnapshot {
	jobs: CronJob[];
}

// ── Run history ──────────────────────────────────────────────────────────────

export type CronRunStatus = "running" | "ok" | "error" | "timeout";
export type CronRunTrigger = "schedule" | "manual" | "event";
/** "session" delivered into the live conversation; "background" ran headless. */
export type CronRunDelivery = "session" | "background";

/** One execution of a cron job — the unit the activity inbox and run
 *  history render (and the future audit log extends). */
export interface CronRun {
	id: string;
	jobId: string;
	/** Snapshot of the job name at fire time, so history outlives renames/deletes. */
	jobName: string;
	trigger: CronRunTrigger;
	delivery: CronRunDelivery;
	startedAt: number;
	finishedAt?: number;
	status: CronRunStatus;
	error?: string;
	/** Session the prompt ran in — the active conversation or the job's side session. */
	sessionFile?: string;
	/** Final assistant text, truncated for run history and triage. */
	summary?: string;
	/** Advisory post-run triage, when a System One model was available. */
	triage?: CronTriageDecision;
	/** Resolved variable values for this run (manual overrides included). */
	variables?: Record<string, string>;
	/** Model used for the run, as provider/model. */
	model?: string;
	/** Where that model came from. */
	modelSource?: "cron" | "subagent" | "default" | "session";
	/** How the prompt was executed. Missing on old runs means "session". */
	execution?: "session" | "subagent" | "durable";
	/** Background subagent id, when execution is subagent. */
	subagentId?: string;
	/** Subagent JSONL progress/result log. */
	outputFile?: string;
	/** Kept worktree when isolation was used. */
	worktreePath?: string;
}

/** Run lifecycle events pushed to hosts (the desktop activity inbox). */
export type CronServiceEvent = { type: "run_started"; run: CronRun } | { type: "run_finished"; run: CronRun };

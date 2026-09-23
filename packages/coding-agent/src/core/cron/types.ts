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

/** Same three schedule kinds as office errands — the math is shared. */
export type CronSchedule =
	| { kind: "every"; minutes: number }
	| { kind: "daily"; time: string }
	| { kind: "once"; at: number };

export type CronJobStatus = "ok" | "error" | "timeout";

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
}

export interface CronSnapshot {
	jobs: CronJob[];
}

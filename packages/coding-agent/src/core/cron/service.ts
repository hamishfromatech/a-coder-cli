/**
 * Cron service — fires the main agent's scheduled tasks.
 *
 * A per-process ticker (like the office's errand ticker) checks due jobs and
 * delivers each job's prompt:
 *
 *   - active session matches the job's project (cwd): the prompt is sent via
 *     `sendUserMessage` — it starts a turn, or queues as a follow-up when one
 *     is already running. The reply lands in the live conversation.
 *   - otherwise: a continuity side session for that project (one per job,
 *     reused across fires, auto permission mode) so scheduled work runs
 *     headless and lands in the session tree.
 *
 * Schedule math is shared with office errands (every / daily / once).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { withKeyedLock } from "../../utils/async-mutex.ts";
import { noOpUIContext } from "../extensions/runner.ts";
import { describeSchedule, isDue, nextRunAt } from "../office/errands.ts";
import { getDefaultSessionDir, SessionManager } from "../session-manager.ts";
import * as store from "./store.ts";
import type {
	CronEventTrigger,
	CronJob,
	CronRun,
	CronRunTrigger,
	CronSchedule,
	CronServiceEvent,
	CronSnapshot,
} from "./types.ts";

const TICK_MS = 30_000;
/** Unattended side-session runs are bounded; stalled turns abort. */
const RUN_TIMEOUT_MS = 15 * 60_000;

/** Minimum cooldown for event jobs — protects the engine from event storms
 *  (including the job's own runs ending turns). */
const MIN_EVENT_COOLDOWN_MS = 5 * 60_000;
/** Default quiet period for turn_end jobs: the job's own fires end turns too. */
const DEFAULT_TURN_END_COOLDOWN_MINUTES = 30;

/** A host-observed event the cron service matches jobs against. `head` is the
 *  git commit head for `git_commit` events (the watermark). */
export interface CronHostEvent {
	type: CronEventTrigger;
	cwd: string;
	head?: string;
}

export interface CronServiceOptions {
	/** The runtime whose active session receives matching jobs. */
	runtime: AgentRuntimeLike;
	/** Pushed after every store mutation so hosts can refresh their UI. */
	onUpdate?: (snapshot: CronSnapshot) => void;
	/** Run lifecycle (started/finished) for activity feeds and run history. */
	onRunEvent?: (event: CronServiceEvent) => void;
	/** Git head resolver for `git_commit` jobs (overridable in tests). */
	resolveGitHead?: (cwd: string) => Promise<string | null>;
}

/** The slice of AgentSessionRuntime the cron service touches. */
export interface AgentRuntimeLike {
	readonly cwd: string;
	readonly session: import("../agent-session.ts").AgentSession;
	readonly services: { agentDir: string };
	createSideRuntime(options: {
		cwd: string;
		sessionManager: SessionManager;
	}): Promise<{ session: import("../agent-session.ts").AgentSession }>;
}

export interface CronJobInput {
	name: string;
	prompt: string;
	schedule: CronSchedule;
	enabled?: boolean;
	/** Project scope; defaults to the runtime's cwd. */
	cwd?: string;
}
/** Exported for tests. */
export function mintJobId(): string {
	return `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mintRunId(): string {
	return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Validate a schedule payload from an untrusted caller. */
export function validateSchedule(schedule: CronSchedule): string | null {
	if (!schedule || typeof schedule !== "object") return "Schedule is required";
	if (schedule.kind === "every") {
		if (typeof schedule.minutes !== "number" || !Number.isFinite(schedule.minutes)) {
			return "Interval minutes must be a number";
		}
		return null;
	}
	if (schedule.kind === "daily") {
		return typeof schedule.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
			? null
			: "Daily time must be HH:MM";
	}
	if (schedule.kind === "once") {
		return typeof schedule.at === "number" && Number.isFinite(schedule.at) ? null : "Once requires a timestamp";
	}
	if (schedule.kind === "event") {
		if (schedule.trigger !== "turn_end" && schedule.trigger !== "git_commit") {
			return "Unknown event trigger";
		}
		if (
			schedule.cooldownMinutes !== undefined &&
			(typeof schedule.cooldownMinutes !== "number" || !Number.isFinite(schedule.cooldownMinutes))
		) {
			return "Cooldown minutes must be a number";
		}
		return null;
	}
	return "Unknown schedule kind";
}

export class CronService {
	private readonly runtime: AgentRuntimeLike;
	private readonly onUpdate?: (snapshot: CronSnapshot) => void;
	private readonly onRunEvent?: (event: CronServiceEvent) => void;
	private readonly resolveGitHead: (cwd: string) => Promise<string | null>;
	private ticker: ReturnType<typeof setInterval> | undefined;
	private disposed = false;
	/** Live continuity sessions for off-session delivery, keyed by job id. */
	private readonly sideSessions = new Map<string, import("../agent-session.ts").AgentSession>();
	constructor(options: CronServiceOptions) {
		this.runtime = options.runtime;
		this.onUpdate = options.onUpdate;
		this.onRunEvent = options.onRunEvent;
		this.resolveGitHead = options.resolveGitHead ?? defaultGitHead;
	}

	start(): void {
		if (this.ticker) return;
		this.ticker = setInterval(() => {
			void this.tick();
		}, TICK_MS);
		this.ticker.unref?.();
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		if (this.ticker) {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
		for (const session of this.sideSessions.values()) {
			if (session.isStreaming) {
				await session.abort().catch(() => {});
			}
			session.dispose();
		}
		this.sideSessions.clear();
	}

	async snapshot(): Promise<CronSnapshot> {
		return { jobs: await store.listJobs() };
	}

	/** List jobs for a project, next fire first. */
	async listForCwd(cwd: string): Promise<CronJob[]> {
		const jobs = (await store.listJobs()).filter((j) => j.cwd === cwd);
		return jobs.sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
	}

	async create(input: CronJobInput): Promise<CronJob> {
		const name = input.name?.trim();
		if (!name) throw new Error("Cron job needs a name");
		if (!input.prompt?.trim()) throw new Error("Cron job needs a prompt");
		const scheduleError = validateSchedule(input.schedule);
		if (scheduleError) throw new Error(scheduleError);

		const now = Date.now();
		const job: CronJob = {
			id: mintJobId(),
			name,
			prompt: input.prompt.trim(),
			schedule: input.schedule,
			enabled: input.enabled ?? true,
			cwd: input.cwd?.trim() || this.runtime.cwd,
			createdAt: now,
			nextRunAt: input.enabled === false ? undefined : nextRunAt(input.schedule, now),
		};
		await store.saveJob(job);
		await this.emitUpdate();
		return job;
	}

	/** Update name/prompt/schedule/enabled. Re-arms the timer when relevant. */
	async update(
		id: string,
		patch: Partial<Pick<CronJob, "name" | "prompt" | "schedule" | "enabled">>,
	): Promise<CronJob> {
		const updated = await store.updateJob(id, (job) => {
			if (patch.name !== undefined) {
				const name = patch.name.trim();
				if (!name) throw new Error("Cron job name cannot be empty");
				job.name = name;
			}
			if (patch.prompt !== undefined) {
				const prompt = patch.prompt.trim();
				if (!prompt) throw new Error("Cron job prompt cannot be empty");
				job.prompt = prompt;
			}
			if (patch.schedule !== undefined) {
				const scheduleError = validateSchedule(patch.schedule);
				if (scheduleError) throw new Error(scheduleError);
				job.schedule = patch.schedule;
			}
			if (patch.enabled !== undefined) {
				job.enabled = patch.enabled;
				job.nextRunAt = undefined;
				if (patch.enabled) {
					const next = nextRunAt(job.schedule, Date.now());
					job.nextRunAt = next;
					// A once-job whose moment already passed stays paused. Event
					// jobs legitimately have no nextRunAt — they stay armed.
					if (next === undefined && job.schedule.kind === "once") job.enabled = false;
				}
			}
		});
		if (!updated) throw new Error("Cron job not found");
		await this.emitUpdate();
		return updated;
	}

	async remove(id: string): Promise<void> {
		await store.deleteJob(id);
		const side = this.sideSessions.get(id);
		if (side) {
			this.sideSessions.delete(id);
			if (side.isStreaming) await side.abort().catch(() => {});
			side.dispose();
		}
		await this.emitUpdate();
	}

	/** List runs for a job (newest first), or every job's runs when omitted. */
	async listRuns(jobId?: string): Promise<CronRun[]> {
		return store.listRuns(jobId);
	}

	/** Fire one job immediately (the client "run now" action). */
	async runNow(id: string): Promise<void> {
		const job = (await store.listJobs()).find((j) => j.id === id);
		if (!job) throw new Error("Cron job not found");
		await this.fireJob(job, "manual");
	}

	// ── internals ───────────────────────────────────────────────────────────

	private async tick(): Promise<void> {
		if (this.disposed) return;
		const jobs = await store.listJobs();
		const now = Date.now();
		for (const job of jobs) {
			if (!isDue(job, now)) continue;
			try {
				await this.fireJob(job);
			} catch (error) {
				await store
					.updateJob(job.id, (j) => {
						j.lastRunAt = now;
						j.lastStatus = "error";
						j.lastError = error instanceof Error ? error.message : String(error);
						j.nextRunAt = nextRunAt(j.schedule, Date.now());
						if (j.schedule.kind === "once") j.enabled = false;
					})
					.catch(() => {});
				await this.emitUpdate();
			}
		}
		await this.pollGitJobs(jobs);
	}

	/** Poll git heads for enabled `git_commit` jobs; fire on a new head. */
	private async pollGitJobs(jobs: CronJob[]): Promise<void> {
		const gitJobs = jobs.filter(
			(j) => j.enabled && j.schedule.kind === "event" && j.schedule.trigger === "git_commit",
		);
		if (gitJobs.length === 0) return;
		const heads = await Promise.all(
			gitJobs.map(async (job) => ({ job, head: await this.resolveGitHead(job.cwd).catch(() => null) })),
		);
		for (const { job, head } of heads) {
			if (!head || head === job.lastGitHead) continue;
			await this.handleEvent({ type: "git_commit", cwd: job.cwd, head });
		}
	}

	/** Entry point for hosts: session/git events matching jobs by cwd + trigger.
	 *  Awaiting is optional; hosts may fire-and-forget. */
	notifyEvent(event: CronHostEvent): Promise<void> {
		return this.handleEvent(event);
	}

	private async handleEvent(event: CronHostEvent): Promise<void> {
		if (this.disposed) return;
		const jobs = await store.listJobs();
		for (const job of jobs) {
			if (!job.enabled) continue;
			if (job.schedule.kind !== "event" || job.schedule.trigger !== event.type) continue;
			if (job.cwd !== event.cwd) continue;
			if (event.type === "git_commit") {
				// Watermark dedupes: one fire per new head, however many commits.
				if (!event.head || event.head === job.lastGitHead) continue;
				await store.updateJob(job.id, (j) => {
					j.lastGitHead = event.head;
				});
			} else {
				// Coalesce: one fire per cooldown window, no matter how many
				// turns ended — including the job's own.
				const cooldown = eventCooldownMs(job.schedule);
				if (job.lastRunAt !== undefined && Date.now() - job.lastRunAt < cooldown) continue;
			}
			try {
				await this.fireJob(job, "event");
			} catch {
				// fireJob records its own failures
			}
		}
	}

	private async fireJob(job: CronJob, trigger: CronRunTrigger = "schedule"): Promise<void> {
		// One fire at a time per job.
		await withKeyedLock(`cron-fire:${job.id}`, async () => {
			const fresh = (await store.listJobs()).find((j) => j.id === job.id);
			if (!fresh || !fresh.enabled) return;

			const head = `[Cron: ${fresh.name}] ${fresh.schedule.kind === "event" ? "Event-triggered task" : "Scheduled task"} (${describeSchedule(fresh.schedule)}) from the user's cron schedule. Work in the current project context and report the result plainly.`;
			const prompt = `${head}\n\n${fresh.prompt}`;

			const run: CronRun = {
				id: mintRunId(),
				jobId: fresh.id,
				jobName: fresh.name,
				trigger,
				delivery: this.runtime.cwd === fresh.cwd && Boolean(this.runtime.session) ? "session" : "background",
				startedAt: Date.now(),
				status: "running",
			};
			await store.appendRun(run);
			this.emitRunEvent({ type: "run_started", run: { ...run } });

			let status: "ok" | "error" | "timeout" = "ok";
			let lastError: string | undefined;
			try {
				const target = await this.resolveDelivery(fresh);
				run.sessionFile = target.sessionFile;
				if (run.sessionFile) {
					await store.updateRun(run.jobId, run.id, (r) => {
						r.sessionFile = run.sessionFile;
					});
				}
				await this.runPrompt(target.session, prompt);
			} catch (error_) {
				status = error_ instanceof CronTimeoutError ? "timeout" : "error";
				lastError = error_ instanceof Error ? error_.message : String(error_);
			}

			run.finishedAt = Date.now();
			run.status = status;
			run.error = lastError;
			await store.updateRun(run.jobId, run.id, (r) => {
				r.finishedAt = run.finishedAt;
				r.status = status;
				r.error = lastError;
			});
			this.emitRunEvent({ type: "run_finished", run: { ...run } });

			await store.updateJob(fresh.id, (j) => {
				j.lastRunAt = Date.now();
				j.lastStatus = status;
				j.lastError = lastError;
				if (j.schedule.kind === "once") {
					// One-shot done: no next fire, stays off.
					j.enabled = false;
					j.nextRunAt = undefined;
				} else {
					j.nextRunAt = nextRunAt(j.schedule, Date.now());
				}
			});
			await this.emitUpdate();
		});
	}

	/**
	 * Where the prompt goes: the active session when it belongs to the job's
	 * project (the reply lands in the live conversation), else the job's
	 * continuity side session. Returns the session file either way so the run
	 * record can link to it ("continue any run").
	 */
	private async resolveDelivery(
		job: CronJob,
	): Promise<{ session: import("../agent-session.ts").AgentSession; sessionFile?: string }> {
		if (this.runtime.cwd === job.cwd && this.runtime.session) {
			return { session: this.runtime.session, sessionFile: this.runtime.session.sessionFile };
		}
		const session = await this.ensureSideSession(job);
		return { session, sessionFile: session.sessionFile };
	}

	/** Continuity side session for off-hours delivery, one per job. */
	private async ensureSideSession(job: CronJob): Promise<import("../agent-session.ts").AgentSession> {
		const live = this.sideSessions.get(job.id);
		if (live) return live;

		const cwd = job.cwd;
		let sessionManager: SessionManager;
		if (job.sessionFile && existsSync(job.sessionFile)) {
			sessionManager = SessionManager.open(job.sessionFile);
		} else {
			sessionManager = SessionManager.create(cwd, getDefaultSessionDir(cwd, this.runtime.services.agentDir));
		}

		const result = await this.runtime.createSideRuntime({ cwd, sessionManager });
		const session = result.session;
		await session.bindExtensions({
			uiContext: noOpUIContext,
			mode: "rpc",
		});
		// Unattended: the job was scheduled deliberately; permission prompts
		// would hang a run nobody is watching.
		session.setPermissionMode("auto");

		// Persist the session pointer so future fires share context.
		if (session.sessionFile && session.sessionFile !== job.sessionFile) {
			await store.updateJob(job.id, (j) => {
				j.sessionFile = session.sessionFile;
			});
		}

		this.sideSessions.set(job.id, session);
		return session;
	}

	/** Run one prompt with the unattended timeout; aborts a stalled turn. */
	private async runPrompt(session: import("../agent-session.ts").AgentSession, prompt: string): Promise<void> {
		const turn = session.sendUserMessage(prompt, { deliverAs: "followUp" });
		let timedOut = false;
		await Promise.race([
			turn,
			new Promise<void>((resolve) => {
				setTimeout(() => {
					timedOut = true;
					void session.abort().catch(() => {});
					resolve();
				}, RUN_TIMEOUT_MS);
			}),
		]);
		if (timedOut) throw new CronTimeoutError();
	}

	private async emitUpdate(): Promise<void> {
		if (!this.onUpdate) return;
		try {
			this.onUpdate(await this.snapshot());
		} catch {
			// UI push is best-effort
		}
	}

	private emitRunEvent(event: CronServiceEvent): void {
		if (!this.onRunEvent) return;
		try {
			this.onRunEvent(event);
		} catch {
			// UI push is best-effort
		}
	}
}

class CronTimeoutError extends Error {
	constructor() {
		super("Cron run timed out");
		this.name = "CronTimeoutError";
	}
}

/** Cooldown window for an event job (clamped to the minimum). */
function eventCooldownMs(schedule: Extract<CronSchedule, { kind: "event" }>): number {
	const minutes =
		schedule.cooldownMinutes ?? (schedule.trigger === "turn_end" ? DEFAULT_TURN_END_COOLDOWN_MINUTES : 0);
	return Math.max(MIN_EVENT_COOLDOWN_MS, minutes * 60_000);
}

/** Resolve the current git HEAD of a project; null when not a repo. */
function defaultGitHead(cwd: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("git", ["rev-parse", "HEAD"], { cwd, timeout: 5_000 }, (error, stdout) => {
			resolve(error ? null : stdout.trim() || null);
		});
	});
}

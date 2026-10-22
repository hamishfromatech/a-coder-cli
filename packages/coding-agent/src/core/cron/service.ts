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
import type { AgentSession } from "../agent-session.ts";
import { noOpUIContext } from "../extensions/runner.ts";
import { describeSchedule, isDue, isValidDailyTime, isValidWeekdays, nextRunAt } from "../office/errands.ts";
import { getDefaultSessionDir, SessionManager } from "../session-manager.ts";
import * as revisions from "./revisions.ts";
import * as store from "./store.ts";
import type { CronTriageInput } from "./triage.ts";
import type {
	CronCatchUpPolicy,
	CronConcurrencyPolicy,
	CronEventTrigger,
	CronJob,
	CronJobConfig,
	CronJobRevision,
	CronRevisionReason,
	CronRun,
	CronRunTrigger,
	CronSchedule,
	CronServiceEvent,
	CronSnapshot,
	CronTriageDecision,
	CronVariable,
} from "./types.ts";

export const DEFAULT_CRON_CONCURRENCY: CronConcurrencyPolicy = "coalesce_if_active";
export const DEFAULT_CRON_CATCH_UP: CronCatchUpPolicy = "run_once";

const TICK_MS = 30_000;
/** A scheduled window missed by more than this is skipped when the routine
 *  uses `skip_missed`; a slightly late tick still runs normally. */
export const CRON_MISSED_GRACE_MS = 5 * 60_000;
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
	/** Optional post-run triage. Defaults to the active session's
	 *  triageScheduledRun method when it exists. */
	triage?: (input: CronTriageInput) => Promise<CronTriageDecision | undefined>;
}

/** The slice of AgentSessionRuntime the cron service touches. */
export interface AgentRuntimeLike {
	readonly cwd: string;
	readonly session: AgentSession;
	readonly services: { agentDir: string };
	createSideRuntime(options: { cwd: string; sessionManager: SessionManager }): Promise<{ session: AgentSession }>;
}

export interface CronJobInput {
	name: string;
	prompt: string;
	schedule: CronSchedule;
	enabled?: boolean;
	/** Project scope; defaults to the runtime's cwd. */
	cwd?: string;
	concurrencyPolicy?: CronConcurrencyPolicy;
	catchUpPolicy?: CronCatchUpPolicy;
	variables?: CronVariable[];
}

/** The slice of CronService the schedule tool needs. CronService implements it. */
export interface CronToolService {
	snapshot(): Promise<CronSnapshot>;
	listForCwd(cwd: string): Promise<CronJob[]>;
	create(input: CronJobInput): Promise<CronJob>;
	update(
		id: string,
		patch: Partial<
			Pick<CronJob, "name" | "prompt" | "schedule" | "enabled" | "concurrencyPolicy" | "catchUpPolicy" | "variables">
		>,
	): Promise<CronJob>;
	remove(id: string): Promise<void>;
	runNow(id: string, variables?: Record<string, string>): Promise<void>;
	listRevisions(id: string): Promise<CronJobRevision[]>;
	restoreRevision(id: string, revisionId: string): Promise<CronJob>;
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
	if (schedule.kind === "weekly") {
		if (typeof schedule.time !== "string" || !isValidDailyTime(schedule.time)) return "Weekly time must be HH:MM";
		return isValidWeekdays(schedule.days) ? null : "Weekly days must be 0-6 (Sunday-Saturday)";
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

/** Validate routine variables; `undefined` means "leave unchanged". */
export function validateCronVariables(variables: CronVariable[] | undefined): string | null {
	if (variables === undefined) return null;
	if (!Array.isArray(variables)) return "Variables must be an array";
	if (variables.length > 32) return "A routine can have at most 32 variables";
	const names = new Set<string>();
	for (const variable of variables) {
		if (!variable || typeof variable.name !== "string" || typeof variable.value !== "string") {
			return "Each variable needs a name and a string value";
		}
		const name = variable.name.trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
			return `Invalid variable name "${variable.name}"`;
		}
		if (name.length > 64) return `Variable name "${name}" is too long`;
		if (variable.value.length > 4_000) return `Variable "${name}" is too long`;
		if (names.has(name)) return `Duplicate variable "${name}"`;
		names.add(name);
	}
	return null;
}

function normalizeCronVariables(variables: CronVariable[] | undefined): CronVariable[] {
	return (variables ?? []).map((variable) => ({ name: variable.name.trim(), value: variable.value }));
}

function validateConcurrencyPolicy(policy: CronConcurrencyPolicy | undefined): string | null {
	if (policy !== undefined && !["skip_if_active", "coalesce_if_active", "always_enqueue"].includes(policy)) {
		return "Unknown concurrency policy";
	}
	return null;
}

function validateCatchUpPolicy(policy: CronCatchUpPolicy | undefined): string | null {
	if (policy !== undefined && policy !== "run_once" && policy !== "skip_missed") {
		return "Unknown catch-up policy";
	}
	return null;
}

/** The user-editable snapshot stored in revision history. */
export function cronJobConfig(job: CronJob): CronJobConfig {
	return {
		name: job.name,
		prompt: job.prompt,
		schedule: job.schedule,
		enabled: job.enabled,
		concurrencyPolicy: job.concurrencyPolicy ?? DEFAULT_CRON_CONCURRENCY,
		catchUpPolicy: job.catchUpPolicy ?? DEFAULT_CRON_CATCH_UP,
		variables: job.variables ?? [],
	};
}

/** Merge stored defaults with a manual run's overrides. */
export function resolveCronVariables(job: CronJob, overrides?: Record<string, string>): Record<string, string> {
	const values: Record<string, string> = {};
	for (const variable of job.variables ?? []) values[variable.name] = variable.value;
	if (overrides) {
		for (const [name, value] of Object.entries(overrides)) {
			if (typeof value === "string") values[name] = value;
		}
	}
	return values;
}

/** Replace `{{name}}` (whitespace tolerated) with routine variable values. */
export function interpolateCronPrompt(prompt: string, variables: Record<string, string>): string {
	return prompt.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name: string) =>
		Object.hasOwn(variables, name) ? variables[name]! : match,
	);
}

async function recordRevision(job: CronJob, reason: CronRevisionReason): Promise<void> {
	await revisions.appendRevision({
		id: revisions.mintRevisionId(),
		jobId: job.id,
		revision: job.revision ?? 1,
		createdAt: Date.now(),
		reason,
		config: cronJobConfig(job),
	});
}

export class CronService {
	private readonly runtime: AgentRuntimeLike;
	private readonly onUpdate?: (snapshot: CronSnapshot) => void;
	private readonly onRunEvent?: (event: CronServiceEvent) => void;
	private readonly resolveGitHead: (cwd: string) => Promise<string | null>;
	private readonly triage?: (input: CronTriageInput) => Promise<CronTriageDecision | undefined>;
	private ticker: ReturnType<typeof setInterval> | undefined;
	private disposed = false;
	/** Live continuity sessions for off-session delivery, keyed by job id. */
	private readonly sideSessions = new Map<string, AgentSession>();
	/** Jobs currently executing or reserved by a non-queueing trigger. */
	private readonly runningJobs = new Set<string>();
	/** At most one follow-up trigger per routine for `coalesce_if_active`. */
	private readonly coalescedJobs = new Map<string, { trigger: CronRunTrigger; variables?: Record<string, string> }>();
	constructor(options: CronServiceOptions) {
		this.runtime = options.runtime;
		this.onUpdate = options.onUpdate;
		this.onRunEvent = options.onRunEvent;
		this.resolveGitHead = options.resolveGitHead ?? defaultGitHead;
		this.triage =
			options.triage ?? ((input) => this.runtime.session.triageScheduledRun?.(input) ?? Promise.resolve(undefined));
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
		this.runningJobs.clear();
		this.coalescedJobs.clear();
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
		const variablesError = validateCronVariables(input.variables);
		if (variablesError) throw new Error(variablesError);
		const concurrencyError = validateConcurrencyPolicy(input.concurrencyPolicy);
		if (concurrencyError) throw new Error(concurrencyError);
		const catchUpError = validateCatchUpPolicy(input.catchUpPolicy);
		if (catchUpError) throw new Error(catchUpError);

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
			concurrencyPolicy: input.concurrencyPolicy ?? DEFAULT_CRON_CONCURRENCY,
			catchUpPolicy: input.catchUpPolicy ?? DEFAULT_CRON_CATCH_UP,
			variables: normalizeCronVariables(input.variables),
			revision: 1,
		};
		await store.saveJob(job);
		await recordRevision(job, "create").catch(() => {});
		await this.emitUpdate();
		return job;
	}

	/** Update editable routine config. Re-arms the timer when relevant. */
	async update(
		id: string,
		patch: Partial<
			Pick<CronJob, "name" | "prompt" | "schedule" | "enabled" | "concurrencyPolicy" | "catchUpPolicy" | "variables">
		>,
	): Promise<CronJob> {
		const variablesError = validateCronVariables(patch.variables);
		if (variablesError) throw new Error(variablesError);
		const concurrencyError = validateConcurrencyPolicy(patch.concurrencyPolicy);
		if (concurrencyError) throw new Error(concurrencyError);
		const catchUpError = validateCatchUpPolicy(patch.catchUpPolicy);
		if (catchUpError) throw new Error(catchUpError);
		const changed =
			patch.name !== undefined ||
			patch.prompt !== undefined ||
			patch.schedule !== undefined ||
			patch.enabled !== undefined ||
			patch.concurrencyPolicy !== undefined ||
			patch.catchUpPolicy !== undefined ||
			patch.variables !== undefined;
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
				if (job.enabled) {
					const next = nextRunAt(job.schedule, Date.now());
					job.nextRunAt = next;
					if (next === undefined && job.schedule.kind === "once") job.enabled = false;
				}
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
			if (patch.concurrencyPolicy !== undefined) job.concurrencyPolicy = patch.concurrencyPolicy;
			if (patch.catchUpPolicy !== undefined) job.catchUpPolicy = patch.catchUpPolicy;
			if (patch.variables !== undefined) job.variables = normalizeCronVariables(patch.variables);
			if (changed) job.revision = (job.revision ?? 1) + 1;
		});
		if (!updated) throw new Error("Cron job not found");
		if (changed) await recordRevision(updated, "update").catch(() => {});
		await this.emitUpdate();
		return updated;
	}

	async listRevisions(id: string): Promise<CronJobRevision[]> {
		return revisions.listRevisions(id);
	}

	/** Restore the editable config from a history snapshot. Runtime state
	 *  (cwd, session pointer, run times) is intentionally left untouched. */
	async restoreRevision(id: string, revisionId: string): Promise<CronJob> {
		const revision = await revisions.getRevision(id, revisionId);
		if (!revision) throw new Error("Cron revision not found");
		const updated = await store.updateJob(id, (job) => {
			job.name = revision.config.name;
			job.prompt = revision.config.prompt;
			job.schedule = revision.config.schedule;
			job.enabled = revision.config.enabled;
			job.concurrencyPolicy = revision.config.concurrencyPolicy;
			job.catchUpPolicy = revision.config.catchUpPolicy;
			job.variables = normalizeCronVariables(revision.config.variables);
			job.revision = (job.revision ?? 1) + 1;
			job.nextRunAt = undefined;
			if (job.enabled) {
				const next = nextRunAt(job.schedule, Date.now());
				job.nextRunAt = next;
				if (next === undefined && job.schedule.kind === "once") job.enabled = false;
			}
		});
		if (!updated) throw new Error("Cron job not found");
		await recordRevision(updated, "restore").catch(() => {});
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
	async runNow(id: string, variables?: Record<string, string>): Promise<void> {
		const job = (await store.listJobs()).find((j) => j.id === id);
		if (!job) throw new Error("Cron job not found");
		await this.fireJob(job, "manual", { variables });
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

	private queueCoalesced(id: string, trigger: CronRunTrigger, variables?: Record<string, string>): void {
		const existing = this.coalescedJobs.get(id);
		if (!existing || (existing.trigger === "schedule" && trigger === "manual")) {
			this.coalescedJobs.set(id, { trigger, ...(variables ? { variables } : {}) });
		} else if (variables && existing.trigger === trigger) {
			existing.variables = { ...(existing.variables ?? {}), ...variables };
		}
	}

	private async fireJob(
		job: CronJob,
		trigger: CronRunTrigger = "schedule",
		options?: { variables?: Record<string, string> },
	): Promise<void> {
		const policy = job.concurrencyPolicy ?? DEFAULT_CRON_CONCURRENCY;

		// Reserve the job before waiting on the lock so a racing trigger cannot
		// slip past `skip_if_active` while the first turn is starting.
		if (policy !== "always_enqueue") {
			if (this.runningJobs.has(job.id)) {
				if (policy === "coalesce_if_active") this.queueCoalesced(job.id, trigger, options?.variables);
				return;
			}
			this.runningJobs.add(job.id);
		}

		try {
			await withKeyedLock(`cron-fire:${job.id}`, async () => {
				const fresh = (await store.listJobs()).find((j) => j.id === job.id);
				if (!fresh || !fresh.enabled) return;
				if (policy === "always_enqueue") this.runningJobs.add(fresh.id);

				try {
					if (trigger === "schedule") {
						const now = Date.now();
						// A prior fire may have advanced the window while this trigger
						// waited on the lock. Never run the same window twice.
						if (!isDue(fresh, now)) return;
						if (
							(fresh.catchUpPolicy ?? DEFAULT_CRON_CATCH_UP) === "skip_missed" &&
							fresh.nextRunAt !== undefined &&
							now - fresh.nextRunAt > CRON_MISSED_GRACE_MS
						) {
							await store.updateJob(fresh.id, (j) => {
								j.nextRunAt = nextRunAt(j.schedule, now);
								if (j.nextRunAt === undefined && j.schedule.kind === "once") j.enabled = false;
							});
							await this.emitUpdate();
							return;
						}
					}

					await this.executeJob(fresh, trigger, options);
				} finally {
					if (policy === "always_enqueue") this.runningJobs.delete(fresh.id);
				}
			});
		} finally {
			if (policy !== "always_enqueue") {
				this.runningJobs.delete(job.id);
				const queued = this.coalescedJobs.get(job.id);
				if (queued) {
					this.coalescedJobs.delete(job.id);
					const latest = (await store.listJobs()).find((j) => j.id === job.id);
					if (latest?.enabled) void this.fireJob(latest, queued.trigger, { variables: queued.variables });
				}
			}
		}
	}

	private async executeJob(
		fresh: CronJob,
		trigger: CronRunTrigger,
		options?: { variables?: Record<string, string> },
	): Promise<void> {
		const variables = resolveCronVariables(fresh, options?.variables);
		const head = `[Scheduled task: ${fresh.name}] This work was scheduled by the user (${describeSchedule(fresh.schedule)}). Execute the task below now in the current project context. Do not ask the user to confirm or to restate the schedule; make reasonable assumptions and carry it through. Report what you did and found plainly.`;
		const prompt = `${head}\n\n${interpolateCronPrompt(fresh.prompt, variables)}`;

		const run: CronRun = {
			id: mintRunId(),
			jobId: fresh.id,
			jobName: fresh.name,
			trigger,
			delivery: this.runtime.cwd === fresh.cwd && Boolean(this.runtime.session) ? "session" : "background",
			startedAt: Date.now(),
			status: "running",
			...(Object.keys(variables).length > 0 ? { variables } : {}),
		};
		await store.appendRun(run);
		this.emitRunEvent({ type: "run_started", run: { ...run } });

		let status: "ok" | "error" | "timeout" = "ok";
		let lastError: string | undefined;
		let summary: string | undefined;
		try {
			const target = await this.resolveDelivery(fresh);
			run.sessionFile = target.sessionFile;
			const messageStart = messageCount(target.session);
			if (run.sessionFile) {
				await store.updateRun(run.jobId, run.id, (r) => {
					r.sessionFile = run.sessionFile;
				});
			}
			await this.runPrompt(target.session, prompt);
			summary = summarizeAssistantOutput(target.session, messageStart);
		} catch (error_) {
			status = error_ instanceof CronTimeoutError ? "timeout" : "error";
			lastError = error_ instanceof Error ? error_.message : String(error_);
		}

		run.finishedAt = Date.now();
		run.status = status;
		run.error = lastError;
		run.summary = summary;

		const priorRuns = (await store.listRuns(fresh.id)).filter((prior) => prior.id !== run.id);
		const triage = await this.triageRun(fresh, run, priorRuns);
		if (triage) run.triage = triage;

		await store.updateRun(run.jobId, run.id, (r) => {
			r.finishedAt = run.finishedAt;
			r.status = status;
			r.error = lastError;
			r.summary = summary;
			if (triage) r.triage = triage;
		});
		this.emitRunEvent({ type: "run_finished", run: { ...run } });

		await store.updateJob(fresh.id, (j) => {
			j.lastRunAt = Date.now();
			j.lastStatus = status;
			j.lastError = lastError;
			j.lastTriage = triage;
			if (j.schedule.kind === "once") {
				// One-shot done: no next fire, stays off.
				j.enabled = false;
				j.nextRunAt = undefined;
			} else {
				j.nextRunAt = nextRunAt(j.schedule, Date.now());
			}
		});
		await this.emitUpdate();
	}

	/** Persist an advisory post-run recommendation; failures become an
	 *  `unavailable` decision so the UI can show that triage did not run. */
	private async triageRun(job: CronJob, run: CronRun, priorRuns: CronRun[]): Promise<CronTriageDecision | undefined> {
		if (!this.triage) return undefined;
		try {
			return await this.triage({ job, run, priorRuns });
		} catch (error) {
			return {
				outcome: "unavailable",
				recommendedAction: "quiet",
				notify: 0,
				retry: 0,
				pause: 0,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Where the prompt goes: the active session when it belongs to the job's
	 * project (the reply lands in the live conversation), else the job's
	 * continuity side session. Returns the session file either way so the run
	 * record can link to it ("continue any run").
	 */
	private async resolveDelivery(job: CronJob): Promise<{ session: AgentSession; sessionFile?: string }> {
		if (this.runtime.cwd === job.cwd && this.runtime.session) {
			return { session: this.runtime.session, sessionFile: this.runtime.session.sessionFile };
		}
		const session = await this.ensureSideSession(job);
		return { session, sessionFile: session.sessionFile };
	}

	/** Continuity side session for off-hours delivery, one per job. */
	private async ensureSideSession(job: CronJob): Promise<AgentSession> {
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
	private async runPrompt(session: AgentSession, prompt: string): Promise<void> {
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

const MAX_RUN_SUMMARY_CHARS = 4_000;

function messageCount(session: AgentSession): number {
	const messages = (session as { messages?: unknown }).messages;
	return Array.isArray(messages) ? messages.length : 0;
}

/** Final assistant text added during this run, capped for history/triage. */
function summarizeAssistantOutput(session: AgentSession, fromIndex: number): string | undefined {
	const messages = (session as { messages?: unknown }).messages;
	if (!Array.isArray(messages)) return undefined;
	const parts: string[] = [];
	for (const message of messages.slice(fromIndex)) {
		if (!message || typeof message !== "object") continue;
		if ((message as { role?: unknown }).role !== "assistant") continue;
		const content = (message as { content?: unknown }).content;
		if (typeof content === "string") {
			parts.push(content);
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			if ((block as { type?: unknown }).type !== "text") continue;
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	const joined = parts.join("\n\n").trim();
	if (!joined) return undefined;
	return joined.length > MAX_RUN_SUMMARY_CHARS ? `${joined.slice(0, MAX_RUN_SUMMARY_CHARS)}\n[truncated]` : joined;
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

/**
 * Cron (scheduled tasks) — store persistence, schedule validation, and
 * service behavior with a fake runtime: due-job firing into the active
 * session, side-session continuity for other projects, and once-jobs
 * disabling after a fire.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CronTriageInput } from "../src/core/cron/triage.ts";

const originalAgentDir = process.env.A_CODER_CLI_CODING_AGENT_DIR;

async function makeAgentDir(): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "cron-test-"));
	process.env.A_CODER_CLI_CODING_AGENT_DIR = dir;
	return dir;
}

beforeEach(async () => {
	await makeAgentDir();
});

// The store/service read the agent dir at call time via config, so env must
// be set before the dynamic imports below.
const store = await import("../src/core/cron/store.ts");
const { CronService, validateSchedule, mintJobId } = await import("../src/core/cron/service.ts");
const { nextRunAt, describeSchedule, isDue } = await import("../src/core/office/errands.ts");
type AgentSession = import("../src/core/agent-session.ts").AgentSession;
type SessionManagerRef = import("../src/core/session-manager.ts").SessionManager;

function makeFakeSession(overrides?: Partial<Record<string, unknown>>, reply?: string): AgentSession {
	const sent: Array<{ text: string; deliverAs?: string }> = [];
	const messages: unknown[] = [];
	const session = {
		isStreaming: false,
		sessionFile: "/tmp/fake-session.jsonl",
		messages,
		prompt: vi.fn(async () => {}),
		sendUserMessage: vi.fn(async (text: string, options?: { deliverAs?: string }) => {
			sent.push({ text, deliverAs: options?.deliverAs });
			if (reply) messages.push({ role: "assistant", content: [{ type: "text", text: reply }] });
		}),
		bindExtensions: vi.fn(async () => {}),
		setPermissionMode: vi.fn(),
		abort: vi.fn(async () => {}),
		dispose: vi.fn(),
		...overrides,
	} as unknown as AgentSession & {
		__sent: Array<{ text: string; deliverAs?: string }>;
	};
	// Expose the log for assertions.
	(session as unknown as { __sent: Array<{ text: string; deliverAs?: string }> }).__sent = sent;
	return session;
}

function makeRuntime(cwd: string, session: AgentSession) {
	return {
		cwd,
		session,
		services: { agentDir: process.env.A_CODER_CLI_CODING_AGENT_DIR ?? "" },
		createSideRuntime: vi.fn(async ({ sessionManager }: { cwd: string; sessionManager: SessionManagerRef }) => {
			const session = makeFakeSession();
			// Mirror the real runtime: bind the passed session manager so the
			// session file pointer persists for continuity.
			Object.defineProperty(session, "sessionFile", {
				value: sessionManager.getSessionFile?.() ?? `${cwd}/fake.jsonl`,
				configurable: true,
			});
			return { session };
		}),
	};
}

afterEach(() => {
	if (originalAgentDir === undefined) {
		delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	} else {
		process.env.A_CODER_CLI_CODING_AGENT_DIR = originalAgentDir;
	}
});

describe("cron store", () => {
	it("persists jobs atomically across save/update/delete", async () => {
		const job = {
			id: "cron_a",
			name: "Sweep",
			prompt: "check tests",
			schedule: { kind: "every" as const, minutes: 30 },
			enabled: true,
			cwd: "/proj",
			createdAt: 1,
			nextRunAt: 100,
		};
		await store.saveJob(job);
		expect((await store.listJobs()).map((j) => j.id)).toEqual(["cron_a"]);

		const updated = await store.updateJob("cron_a", (j) => {
			j.lastRunAt = 5;
			j.lastStatus = "ok";
		});
		expect(updated?.lastStatus).toBe("ok");
		expect((await store.listJobs())[0]?.lastRunAt).toBe(5);

		await store.deleteJob("cron_a");
		expect(await store.listJobs()).toEqual([]);
	});

	it("updateJob returns undefined for missing ids", async () => {
		expect(await store.updateJob("cron_missing", () => {})).toBeUndefined();
	});
});

describe("cron schedules", () => {
	it("validates schedule payloads", () => {
		expect(validateSchedule({ kind: "every", minutes: 30 })).toBeNull();
		expect(validateSchedule({ kind: "every", minutes: Number.NaN })).toMatch(/minutes/);
		expect(validateSchedule({ kind: "daily", time: "09:00" })).toBeNull();
		expect(validateSchedule({ kind: "daily", time: "25:00" })).toMatch(/HH:MM/);
		expect(validateSchedule({ kind: "weekly", days: [1, 3, 5], time: "09:00" })).toBeNull();
		expect(validateSchedule({ kind: "weekly", days: [], time: "09:00" })).toMatch(/days/);
		expect(validateSchedule({ kind: "weekly", days: [1, 7], time: "09:00" })).toMatch(/days/);
		expect(validateSchedule({ kind: "once", at: Date.now() + 1 })).toBeNull();
		expect(validateSchedule({ kind: "bogus" } as never)).toMatch(/Unknown/);
	});

	it("computes daily next fires strictly in the future", () => {
		const morning = new Date();
		morning.setHours(8, 0, 0, 0);
		const next = nextRunAt({ kind: "daily", time: "09:00" }, morning.getTime());
		expect(next).toBeGreaterThan(morning.getTime());
		const nextDate = new Date(next!);
		expect(nextDate.getHours()).toBe(9);
		expect(nextDate.getMinutes()).toBe(0);
	});

	it("computes weekly next fires on selected local days", () => {
		const wednesday = new Date(2026, 9, 21, 8, 0, 0, 0).getTime();
		const next = nextRunAt({ kind: "weekly", days: [1, 3, 5], time: "09:00" }, wednesday);
		expect(next).toBe(new Date(2026, 9, 21, 9, 0, 0, 0).getTime());
		const after = nextRunAt({ kind: "weekly", days: [1], time: "10:00" }, wednesday);
		expect(new Date(after!).getDay()).toBe(1);
		expect(after).toBeGreaterThan(wednesday);
	});

	it("describes schedules compactly", () => {
		expect(describeSchedule({ kind: "every", minutes: 60 })).toBe("every 1h");
		expect(describeSchedule({ kind: "daily", time: "09:00" })).toBe("daily at 09:00");
		expect(describeSchedule({ kind: "weekly", days: [1, 3, 5], time: "09:00" })).toBe(
			"weekly on Mon, Wed, Fri at 09:00",
		);
		expect(describeSchedule({ kind: "once", at: 1_700_000_000_000 })).toContain(
			new Date(1_700_000_000_000).getFullYear().toString(),
		);
	});
});

describe("CronService", () => {
	it("creates jobs scoped to the runtime cwd with an armed timer", async () => {
		const session = makeFakeSession();
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const job = await service.create({
			name: "Sweep",
			prompt: "do the thing",
			schedule: { kind: "every", minutes: 30 },
		});
		expect(job.cwd).toBe("/proj");
		expect(job.enabled).toBe(true);
		expect(job.nextRunAt).toBeGreaterThan(Date.now() - 1000);
		expect(job.id).toMatch(/^cron_/);
		await service.dispose();
	});

	it("rejects invalid input", async () => {
		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		await expect(service.create({ name: "", prompt: "x", schedule: { kind: "every", minutes: 5 } })).rejects.toThrow(
			/name/i,
		);
		await expect(
			service.create({ name: "x", prompt: "y", schedule: { kind: "daily", time: "99:99" } }),
		).rejects.toThrow(/HH:MM/);
		await service.dispose();
	});

	it("re-arms nextRunAt when only the schedule changes", async () => {
		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		const job = await service.create({
			name: "Reschedule me",
			prompt: "check",
			schedule: { kind: "every", minutes: 30 },
		});
		const updated = await service.update(job.id, { schedule: { kind: "weekly", days: [1, 3, 5], time: "09:00" } });
		expect(updated.schedule).toEqual({ kind: "weekly", days: [1, 3, 5], time: "09:00" });
		expect(updated.nextRunAt).toBeDefined();
		expect(new Date(updated.nextRunAt!).getHours()).toBe(9);
		await service.dispose();
	});

	it("delivers due jobs into the active session via sendUserMessage", async () => {
		const session = makeFakeSession();
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const job = await service.create({
			name: "Sweep",
			prompt: "check the build",
			schedule: { kind: "every", minutes: 5 },
		});
		// Force due.
		await store.updateJob(job.id, (j) => {
			j.nextRunAt = Date.now() - 1000;
		});
		// Drive the private tick through runNow (same delivery path).
		await service.runNow(job.id);

		const sent = (session as unknown as { __sent: Array<{ text: string; deliverAs?: string }> }).__sent;
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("check the build");
		expect(sent[0]?.text).toContain("[Scheduled task: Sweep]");
		expect(sent[0]?.text).toContain("Execute the task below now");
		expect(sent[0]?.deliverAs).toBe("followUp");

		const fresh = (await store.listJobs()).find((j) => j.id === job.id);
		expect(fresh?.lastStatus).toBe("ok");
		expect(fresh?.lastRunAt).toBeGreaterThan(0);
		await service.dispose();
	});

	it("runs due jobs in an isolated subagent when the session supports it", async () => {
		const record = {
			id: "cron-run-isolated",
			agentType: "general-purpose",
			status: "completed",
			createdAt: Date.now(),
			startedAt: Date.now(),
			updatedAt: Date.now(),
			finalText: "isolated result",
			toolUseCount: 2,
			turnCount: 1,
			timeline: [],
			detached: true,
			outputFile: "/tmp/subagent.output",
		};
		const session = makeFakeSession({
			runSubAgentBackground: vi.fn(() => ({ id: "cron-run-isolated" })),
			waitSubAgent: vi.fn(async () => record),
			killSubAgent: vi.fn(),
		});
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const job = await service.create({
			name: "Isolated",
			prompt: "do isolated work",
			schedule: { kind: "every", minutes: 30 },
		});
		await service.runNow(job.id);
		const runs = await service.listRuns(job.id);
		expect(runs[0]).toMatchObject({
			execution: "subagent",
			subagentId: `cron-${runs[0]?.id}`,
			status: "ok",
			summary: "isolated result",
			outputFile: "/tmp/subagent.output",
		});
		const sent = (session as unknown as { __sent: unknown[] }).__sent;
		expect(sent).toHaveLength(0);
		await service.dispose();
	});

	it("records run history with lifecycle events and continue handles", async () => {
		const events: Array<{ type: string; run: { id: string; status: string; sessionFile?: string } }> = [];
		const service = new CronService({
			runtime: makeRuntime("/other", makeFakeSession()),
			onRunEvent: (event) => events.push(event),
		});
		const job = await service.create({
			name: "Nightly",
			prompt: "summarize",
			schedule: { kind: "daily", time: "23:59" },
			cwd: "/proj",
		});

		await service.runNow(job.id);

		// Lifecycle: started (running) then finished (ok), same run id.
		expect(events.map((e) => e.type)).toEqual(["run_started", "run_finished"]);
		expect(events[0]?.run.status).toBe("running");
		expect(events[1]?.run.status).toBe("ok");
		expect(events[0]?.run.id).toBe(events[1]?.run.id);
		expect(events[1]?.run.sessionFile).toBeTruthy();

		// Persisted history mirrors the events and is queryable per job.
		const runs = await service.listRuns(job.id);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.jobName).toBe("Nightly");
		expect(runs[0]?.trigger).toBe("manual");
		expect(runs[0]?.delivery).toBe("background");
		expect(runs[0]?.finishedAt).toBeGreaterThan(runs[0]?.startedAt ?? 0);

		// History survives job deletion (names are snapshotted on the run).
		await service.remove(job.id);
		expect(await service.listRuns(job.id)).toHaveLength(1);
		await service.dispose();
	});

	it("interpolates routine variables and applies manual run overrides", async () => {
		const session = makeFakeSession();
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const job = await service.create({
			name: "Deploy",
			prompt: "Deploy {{target}} from {{ branch }}; unknown {{missing}}",
			schedule: { kind: "every", minutes: 30 },
			variables: [
				{ name: "target", value: "staging" },
				{ name: "branch", value: "main" },
			],
		});
		await service.runNow(job.id, { target: "prod" });
		const sent = (session as unknown as { __sent: Array<{ text: string }> }).__sent;
		expect(sent[0]?.text).toContain("Deploy prod from main; unknown {{missing}}");
		const run = (await service.listRuns(job.id))[0];
		expect(run?.variables).toEqual({ target: "prod", branch: "main" });

		await service.runNow(job.id);
		expect(sent[1]?.text).toContain("Deploy staging from main");
		await service.dispose();
	});

	it("captures a result summary and persists advisory triage", async () => {
		const session = makeFakeSession(undefined, "CI is green; nothing to do.");
		const triage = vi.fn(async (_input: CronTriageInput) => ({
			outcome: "no_work" as const,
			recommendedAction: "quiet" as const,
			notify: 0.12,
			retry: 0.04,
			pause: 0.08,
			model: "clef-flash",
			latencyMs: 180,
		}));
		const service = new CronService({ runtime: makeRuntime("/proj", session), triage });
		const job = await service.create({
			name: "CI triage",
			prompt: "Review CI",
			schedule: { kind: "every", minutes: 30 },
		});

		await service.runNow(job.id);

		expect(triage).toHaveBeenCalledTimes(1);
		expect(triage.mock.calls[0]?.[0]).toMatchObject({
			job: { id: job.id, name: "CI triage" },
			run: { status: "ok", summary: "CI is green; nothing to do." },
		});
		const runs = await service.listRuns(job.id);
		expect(runs[0]?.summary).toBe("CI is green; nothing to do.");
		expect(runs[0]?.triage).toMatchObject({
			outcome: "no_work",
			recommendedAction: "quiet",
			notify: 0.12,
			model: "clef-flash",
		});
		const fresh = (await store.listJobs()).find((entry) => entry.id === job.id);
		expect(fresh?.lastTriage?.recommendedAction).toBe("quiet");
		await service.dispose();
	});

	it("turns a throwing triage callback into an unavailable decision", async () => {
		const service = new CronService({
			runtime: makeRuntime("/proj", makeFakeSession()),
			triage: vi.fn(async () => {
				throw new Error("decision model offline");
			}),
		});
		const job = await service.create({
			name: "Triage failure",
			prompt: "x",
			schedule: { kind: "every", minutes: 30 },
		});
		await service.runNow(job.id);
		const run = (await service.listRuns(job.id))[0];
		expect(run?.triage?.outcome).toBe("unavailable");
		expect(run?.triage?.error).toContain("offline");
		await service.dispose();
	});

	it("runs other-project jobs in a continuity side session with auto permissions", async () => {
		const activeSession = makeFakeSession();
		const service = new CronService({ runtime: makeRuntime("/other", activeSession) });
		const job = await service.create({
			name: "Nightly report",
			prompt: "summarize commits",
			schedule: { kind: "daily", time: "23:59" },
			cwd: "/proj",
		});

		await service.runNow(job.id);

		// The active session (different project) was NOT used.
		const sent = (activeSession as unknown as { __sent: Array<unknown> }).__sent;
		expect(sent).toHaveLength(0);

		const runtime = (service as unknown as { runtime: { createSideRuntime: ReturnType<typeof vi.fn> } }).runtime;
		expect(runtime.createSideRuntime).toHaveBeenCalledTimes(1);
		const call = (runtime.createSideRuntime as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
			cwd: string;
		};
		expect(call.cwd).toBe("/proj");

		const fresh = (await store.listJobs()).find((j) => j.id === job.id);
		expect(fresh?.lastStatus).toBe("ok");
		expect(fresh?.sessionFile).toBeTruthy();
		await service.dispose();
	});

	it("disables once-jobs after a fire and re-arms on resume", async () => {
		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		const job = await service.create({
			name: "One-shot",
			prompt: "single run",
			schedule: { kind: "once", at: Date.now() + 60_000 },
		});
		await service.runNow(job.id);
		let fresh = (await store.listJobs()).find((j) => j.id === job.id);
		expect(fresh?.enabled).toBe(false);
		expect(fresh?.nextRunAt).toBeUndefined();

		// Resuming a once-job whose moment already passed keeps it off.
		await store.updateJob(job.id, (j) => {
			j.schedule = { kind: "once", at: Date.now() - 1000 };
		});
		const resumed = await service.update(job.id, { enabled: true });
		fresh = (await store.listJobs()).find((j) => j.id === job.id);
		expect(resumed.enabled).toBe(false);
		expect(fresh?.enabled).toBe(false);
		expect(fresh?.nextRunAt).toBeUndefined();

		// Interval jobs resume with a fresh timer.
		const interval = await service.create({
			name: "Loop",
			prompt: "x",
			schedule: { kind: "every", minutes: 10 },
			enabled: false,
		});
		const resumedInterval = await service.update(interval.id, { enabled: true });
		expect(resumedInterval.enabled).toBe(true);
		expect(resumedInterval.nextRunAt).toBeGreaterThan(Date.now());
		await service.dispose();
	});

	it("removing a job stops its side session", async () => {
		const service = new CronService({ runtime: makeRuntime("/other", makeFakeSession()) });
		const job = await service.create({
			name: "Side",
			prompt: "x",
			schedule: { kind: "every", minutes: 10 },
			cwd: "/proj",
		});
		await service.runNow(job.id);
		const side = (service as unknown as { sideSessions: Map<string, AgentSession> }).sideSessions.get(job.id);
		expect(side).toBeDefined();
		await service.remove(job.id);
		expect((side as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled();
	});
});

describe("cron concurrency and catch-up", () => {
	function makeBlockingSession() {
		const sent: string[] = [];
		const releases: Array<() => void> = [];
		const session = {
			isStreaming: false,
			sessionFile: "/tmp/blocking-session.jsonl",
			messages: [],
			prompt: vi.fn(async () => {}),
			sendUserMessage: vi.fn((text: string) => {
				sent.push(text);
				return new Promise<void>((resolve) => releases.push(resolve));
			}),
			bindExtensions: vi.fn(async () => {}),
			setPermissionMode: vi.fn(),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(),
		} as unknown as AgentSession;
		return { session, sent, releases };
	}

	async function createPolicyJob(
		service: InstanceType<typeof CronService>,
		concurrencyPolicy: "skip_if_active" | "coalesce_if_active" | "always_enqueue",
	) {
		return service.create({
			name: `${concurrencyPolicy} job`,
			prompt: "do work",
			schedule: { kind: "every", minutes: 30 },
			concurrencyPolicy,
		});
	}

	it("skips overlapping triggers with skip_if_active", async () => {
		const { session, sent, releases } = makeBlockingSession();
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const job = await createPolicyJob(service, "skip_if_active");
		const first = service.runNow(job.id);
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		await service.runNow(job.id);
		releases.shift()?.();
		await first;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(sent).toHaveLength(1);
		await service.dispose();
	});

	it("coalesces overlapping triggers into one follow-up", async () => {
		const { session, sent, releases } = makeBlockingSession();
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const job = await createPolicyJob(service, "coalesce_if_active");
		const first = service.runNow(job.id);
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		await service.runNow(job.id);
		releases.shift()?.();
		await first;
		await vi.waitFor(() => expect(sent).toHaveLength(2));
		releases.shift()?.();
		await vi.waitFor(async () => expect((await service.listRuns(job.id)).length).toBe(2));
		await service.dispose();
	});

	it("queues every trigger with always_enqueue", async () => {
		const { session, sent, releases } = makeBlockingSession();
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const job = await createPolicyJob(service, "always_enqueue");
		const first = service.runNow(job.id);
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		const second = service.runNow(job.id);
		releases.shift()?.();
		await first;
		await vi.waitFor(() => expect(sent).toHaveLength(2));
		releases.shift()?.();
		await second;
		expect((await service.listRuns(job.id)).length).toBe(2);
		await service.dispose();
	});

	it("skips a missed window with skip_missed and runs once otherwise", async () => {
		const session = makeFakeSession(undefined, "ran");
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const skipJob = await service.create({
			name: "Skip missed",
			prompt: "check",
			schedule: { kind: "every", minutes: 30 },
			catchUpPolicy: "skip_missed",
		});
		await store.updateJob(skipJob.id, (job) => {
			job.nextRunAt = Date.now() - 10 * 60_000;
		});
		const fire = (
			service as unknown as { fireJob: (job: typeof skipJob, trigger: "schedule") => Promise<void> }
		).fireJob.bind(service);
		await fire(skipJob, "schedule");
		expect(await service.listRuns(skipJob.id)).toHaveLength(0);
		const skipped = (await store.listJobs()).find((job) => job.id === skipJob.id);
		expect(skipped?.nextRunAt).toBeGreaterThan(Date.now());

		const runJob = await service.create({
			name: "Run once",
			prompt: "check",
			schedule: { kind: "every", minutes: 30 },
			catchUpPolicy: "run_once",
		});
		await store.updateJob(runJob.id, (job) => {
			job.nextRunAt = Date.now() - 10 * 60_000;
		});
		await fire(runJob, "schedule");
		expect(await service.listRuns(runJob.id)).toHaveLength(1);
		await service.dispose();
	});
});

describe("cron scheduler lease", () => {
	type TickableService = { tick: () => Promise<void> };

	it("fires a due window once across two scheduler instances", async () => {
		const firstSession = makeFakeSession(undefined, "ran once");
		const secondSession = makeFakeSession(undefined, "should not run");
		const first = new CronService({ runtime: makeRuntime("/proj", firstSession) });
		const second = new CronService({ runtime: makeRuntime("/proj", secondSession) });
		first.start();
		second.start();

		const job = await first.create({
			name: "08:00 job",
			prompt: "run the morning routine",
			schedule: { kind: "every", minutes: 30 },
		});
		await store.updateJob(job.id, (j) => {
			j.nextRunAt = Date.now() - 1_000;
		});

		await (first as unknown as TickableService).tick();
		await (second as unknown as TickableService).tick();

		expect(await first.listRuns(job.id)).toHaveLength(1);
		expect((firstSession as unknown as { __sent: unknown[] }).__sent).toHaveLength(1);
		expect((secondSession as unknown as { __sent: unknown[] }).__sent).toHaveLength(0);
		await first.dispose();
		await second.dispose();
	});

	it("spools a follower event for the leader to drain", async () => {
		const firstSession = makeFakeSession(undefined, "reviewed");
		const secondSession = makeFakeSession(undefined, "should not run");
		const first = new CronService({ runtime: makeRuntime("/proj", firstSession) });
		const second = new CronService({ runtime: makeRuntime("/proj", secondSession) });
		first.start();
		second.start();

		const job = await first.create({
			name: "Reviewer",
			prompt: "review the latest diff",
			schedule: { kind: "event", trigger: "turn_end" },
		});
		await second.notifyEvent({ type: "turn_end", cwd: "/proj" });
		await (first as unknown as TickableService).tick();

		expect(await first.listRuns(job.id)).toHaveLength(1);
		expect((firstSession as unknown as { __sent: unknown[] }).__sent).toHaveLength(1);
		expect((secondSession as unknown as { __sent: unknown[] }).__sent).toHaveLength(0);
		await first.dispose();
		await second.dispose();
	});
});

describe("cron event triggers", () => {
	it("validates event schedules", () => {
		expect(validateSchedule({ kind: "event", trigger: "turn_end" })).toBeNull();
		expect(validateSchedule({ kind: "event", trigger: "git_commit", cooldownMinutes: 15 })).toBeNull();
		expect(validateSchedule({ kind: "event", trigger: "bogus" as never })).toMatch(/Unknown event trigger/);
		expect(validateSchedule({ kind: "event", trigger: "turn_end", cooldownMinutes: Number.NaN })).toMatch(/Cooldown/);
	});

	it("event jobs are never time-due and have no next fire", () => {
		const schedule = { kind: "event" as const, trigger: "turn_end" as const };
		expect(nextRunAt(schedule, Date.now())).toBeUndefined();
		expect(isDue({ enabled: true, schedule }, Date.now())).toBe(false);
		expect(describeSchedule(schedule)).toBe("on turn end");
		expect(describeSchedule({ kind: "event", trigger: "git_commit" })).toBe("on commit");
	});

	it("fires turn_end jobs for the matching project, coalesced by cooldown", async () => {
		const session = makeFakeSession();
		const service = new CronService({ runtime: makeRuntime("/proj", session) });
		const job = await service.create({
			name: "Reviewer",
			prompt: "review the latest diff",
			schedule: { kind: "event", trigger: "turn_end", cooldownMinutes: 30 },
		});

		await service.notifyEvent({ type: "turn_end", cwd: "/proj" });
		const sent = (session as unknown as { __sent: Array<{ text: string; deliverAs?: string }> }).__sent;
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("review the latest diff");

		// Coalesced: another turn inside the cooldown window fires nothing.
		await service.notifyEvent({ type: "turn_end", cwd: "/proj" });
		expect(sent).toHaveLength(1);

		// Other projects never fire this job.
		await service.notifyEvent({ type: "turn_end", cwd: "/elsewhere" });
		expect(sent).toHaveLength(1);

		const runs = await service.listRuns(job.id);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.trigger).toBe("event");
		await service.dispose();
	});

	it("fires git_commit jobs once per new head via the watermark", async () => {
		let head = "aaa111";
		const service = new CronService({
			runtime: makeRuntime("/other", makeFakeSession()),
			resolveGitHead: async () => head,
		});
		const job = await service.create({
			name: "Release notes",
			prompt: "draft release notes",
			schedule: { kind: "event", trigger: "git_commit" },
			cwd: "/proj",
		});

		// First head → fires. Same head again → nothing. New head → fires.
		await service.notifyEvent({ type: "git_commit", cwd: "/proj", head });
		expect((await service.listRuns(job.id)).length).toBe(1);
		await service.notifyEvent({ type: "git_commit", cwd: "/proj", head });
		expect((await service.listRuns(job.id)).length).toBe(1);
		head = "bbb222";
		await service.notifyEvent({ type: "git_commit", cwd: "/proj", head });
		expect((await service.listRuns(job.id)).length).toBe(2);

		const fresh = (await store.listJobs()).find((j) => j.id === job.id);
		expect(fresh?.lastGitHead).toBe("bbb222");
		await service.dispose();
	});

	it("paused event jobs resume armed (no nextRunAt needed)", async () => {
		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		const job = await service.create({
			name: "Watcher",
			prompt: "x",
			schedule: { kind: "event", trigger: "git_commit" },
		});
		await service.update(job.id, { enabled: false });
		const resumed = await service.update(job.id, { enabled: true });
		expect(resumed.enabled).toBe(true);
		expect(resumed.nextRunAt).toBeUndefined();
		await service.dispose();
	});
});

describe("cron ids", () => {
	it("mints unique prefixed ids", () => {
		const a = mintJobId();
		const b = mintJobId();
		expect(a).toMatch(/^cron_/);
		expect(a).not.toBe(b);
	});
});

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
const { nextRunAt, describeSchedule } = await import("../src/core/office/errands.ts");
type AgentSession = import("../src/core/agent-session.ts").AgentSession;
type SessionManagerRef = import("../src/core/session-manager.ts").SessionManager;

function makeFakeSession(overrides?: Partial<Record<string, unknown>>): AgentSession {
	const sent: Array<{ text: string; deliverAs?: string }> = [];
	const session = {
		isStreaming: false,
		sessionFile: "/tmp/fake-session.jsonl",
		prompt: vi.fn(async () => {}),
		sendUserMessage: vi.fn(async (text: string, options?: { deliverAs?: string }) => {
			sent.push({ text, deliverAs: options?.deliverAs });
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

	it("describes schedules compactly", () => {
		expect(describeSchedule({ kind: "every", minutes: 60 })).toBe("every 1h");
		expect(describeSchedule({ kind: "daily", time: "09:00" })).toBe("daily at 09:00");
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
		expect(sent[0]?.text).toContain("[Cron: Sweep]");
		expect(sent[0]?.deliverAs).toBe("followUp");

		const fresh = (await store.listJobs()).find((j) => j.id === job.id);
		expect(fresh?.lastStatus).toBe("ok");
		expect(fresh?.lastRunAt).toBeGreaterThan(0);
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

describe("cron ids", () => {
	it("mints unique prefixed ids", () => {
		const a = mintJobId();
		const b = mintJobId();
		expect(a).toMatch(/^cron_/);
		expect(a).not.toBe(b);
	});
});

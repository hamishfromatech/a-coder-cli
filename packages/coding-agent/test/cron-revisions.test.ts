/**
 * Routine configuration history — defaults, version increments, and restore
 * semantics that leave project/session/runtime state untouched.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { CronService, validateCronVariables } from "../src/core/cron/service.ts";

const originalAgentDir = process.env.A_CODER_CLI_CODING_AGENT_DIR;

function makeFakeSession(): AgentSession {
	return {
		isStreaming: false,
		sessionFile: "/tmp/revision-session.jsonl",
		sendUserMessage: vi.fn(async () => {}),
		bindExtensions: vi.fn(async () => {}),
		setPermissionMode: vi.fn(),
		abort: vi.fn(async () => {}),
		dispose: vi.fn(),
	} as unknown as AgentSession;
}

function makeRuntime(cwd: string, session: AgentSession) {
	return {
		cwd,
		session,
		services: { agentDir: process.env.A_CODER_CLI_CODING_AGENT_DIR ?? "" },
		createSideRuntime: vi.fn(async () => ({ session })),
	};
}

beforeEach(() => {
	process.env.A_CODER_CLI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "cron-revisions-test-"));
});

afterEach(() => {
	if (originalAgentDir === undefined) {
		delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	} else {
		process.env.A_CODER_CLI_CODING_AGENT_DIR = originalAgentDir;
	}
});

describe("routine revisions", () => {
	it("records create/update/restore revisions and restores config only", async () => {
		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		const job = await service.create({
			name: "CI triage",
			prompt: "Review CI",
			schedule: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" },
		});
		expect(job.revision).toBe(1);
		expect(job.concurrencyPolicy).toBe("coalesce_if_active");
		expect(job.catchUpPolicy).toBe("run_once");
		expect(job.variables).toEqual([]);

		let history = await service.listRevisions(job.id);
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({ revision: 1, reason: "create", jobId: job.id });
		expect(history[0]?.config.name).toBe("CI triage");

		const updated = await service.update(job.id, {
			name: "CI triage v2",
			prompt: "Review CI and flaky tests",
			concurrencyPolicy: "skip_if_active",
			catchUpPolicy: "skip_missed",
			variables: [{ name: "target", value: "main" }],
		});
		expect(updated.revision).toBe(2);
		history = await service.listRevisions(job.id);
		expect(history.map((entry) => entry.revision)).toEqual([2, 1]);
		expect(history[0]).toMatchObject({
			reason: "update",
			config: {
				name: "CI triage v2",
				concurrencyPolicy: "skip_if_active",
				catchUpPolicy: "skip_missed",
				variables: [{ name: "target", value: "main" }],
			},
		});
		expect(history[1]?.config.name).toBe("CI triage");

		// Runtime state is not part of a revision and must survive a restore.
		const sessionFile = "/tmp/kept-session.jsonl";
		const { updateJob } = await import("../src/core/cron/store.ts");
		await updateJob(job.id, (current) => {
			current.sessionFile = sessionFile;
		});

		const restored = await service.restoreRevision(job.id, history[1]!.id);
		expect(restored.name).toBe("CI triage");
		expect(restored.prompt).toBe("Review CI");
		expect(restored.revision).toBe(3);
		expect(restored.cwd).toBe("/proj");
		expect(restored.sessionFile).toBe(sessionFile);
		expect(restored.concurrencyPolicy).toBe("coalesce_if_active");
		expect(restored.catchUpPolicy).toBe("run_once");
		expect(restored.variables).toEqual([]);

		history = await service.listRevisions(job.id);
		expect(history[0]).toMatchObject({ revision: 3, reason: "restore" });
		await service.dispose();
	});

	it("validates variables and policy values", async () => {
		expect(validateCronVariables([{ name: "target", value: "main" }])).toBeNull();
		expect(validateCronVariables([{ name: "1bad", value: "x" }])).toMatch(/Invalid variable/);
		expect(
			validateCronVariables([
				{ name: "x", value: "1" },
				{ name: "x", value: "2" },
			]),
		).toMatch(/Duplicate/);
		expect(validateCronVariables(Array.from({ length: 33 }, (_, i) => ({ name: `v${i}`, value: "" })))).toMatch(
			/at most 32/,
		);

		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		await expect(
			service.create({
				name: "Bad policy",
				prompt: "x",
				schedule: { kind: "every", minutes: 30 },
				concurrencyPolicy: "nope" as never,
			}),
		).rejects.toThrow(/concurrency/);
		await expect(
			service.create({
				name: "Bad catch-up",
				prompt: "x",
				schedule: { kind: "every", minutes: 30 },
				catchUpPolicy: "nope" as never,
			}),
		).rejects.toThrow(/catch-up/);
		await service.dispose();
	});
});

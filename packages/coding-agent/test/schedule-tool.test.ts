/**
 * schedule_task tool — model-facing create/list/update/pause/delete flow on top
 * of the real CronService store.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { CronService } from "../src/core/cron/service.ts";
import { createScheduleTaskToolDefinition } from "../src/core/tools/schedule.ts";

const originalAgentDir = process.env.A_CODER_CLI_CODING_AGENT_DIR;

function makeFakeSession(): AgentSession {
	return {
		isStreaming: false,
		sessionFile: "/tmp/schedule-tool-session.jsonl",
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
	process.env.A_CODER_CLI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "schedule-tool-test-"));
});

afterEach(() => {
	if (originalAgentDir === undefined) {
		delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	} else {
		process.env.A_CODER_CLI_CODING_AGENT_DIR = originalAgentDir;
	}
});

describe("schedule_task tool", () => {
	it("creates a natural-language weekly task and lists it", async () => {
		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		const definition = createScheduleTaskToolDefinition({ getService: () => service });
		const context = { cwd: "/proj" } as never;

		const created = await definition.execute(
			"call-1",
			{
				action: "create",
				name: "Schedule smoke",
				task: "Review the open CI failures and post a summary.",
				when: "every weekday at 9am",
				concurrencyPolicy: "skip_if_active",
				catchUpPolicy: "skip_missed",
				variables: { target: "main" },
			},
			undefined,
			undefined,
			context,
		);
		expect(created.content[0]?.type).toBe("text");
		const text = created.content[0]?.type === "text" ? created.content[0].text : "";
		expect(text).toContain("Created scheduled task");
		expect(text).toContain("weekly on weekdays at 09:00");
		expect(text).toContain("Next run:");
		expect(created.details?.job?.cwd).toBe("/proj");
		expect(created.details?.job?.prompt).toContain("Review the open CI");
		expect(created.details?.job?.concurrencyPolicy).toBe("skip_if_active");
		expect(created.details?.job?.catchUpPolicy).toBe("skip_missed");
		expect(created.details?.job?.variables).toEqual([{ name: "target", value: "main" }]);

		const listed = await definition.execute("call-2", { action: "list" }, undefined, undefined, context);
		const listText = listed.content[0]?.type === "text" ? listed.content[0].text : "";
		expect(listText).toContain("Scheduled tasks in /proj");
		expect(listText).toContain("weekly on weekdays at 09:00");
		expect(listed.details?.jobs).toHaveLength(1);

		const revisions = await definition.execute(
			"call-3",
			{ action: "revisions", id: "Schedule smoke" },
			undefined,
			undefined,
			context,
		);
		expect(revisions.details?.revisions).toHaveLength(1);

		await service.dispose();
	});

	it("updates, pauses, resumes, and deletes by name", async () => {
		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		const definition = createScheduleTaskToolDefinition({ getService: () => service });
		const context = { cwd: "/proj" } as never;
		await definition.execute(
			"create",
			{ action: "create", name: "CI triage", task: "Check CI", when: "every 30 minutes" },
			undefined,
			undefined,
			context,
		);

		const updated = await definition.execute(
			"update",
			{ action: "update", id: "CI triage", task: "Check CI and flaky tests", when: "daily at 6pm" },
			undefined,
			undefined,
			context,
		);
		expect(updated.details?.job?.prompt).toBe("Check CI and flaky tests");
		expect(updated.details?.job?.schedule).toEqual({ kind: "daily", time: "18:00" });

		const paused = await definition.execute(
			"pause",
			{ action: "pause", id: "CI triage" },
			undefined,
			undefined,
			context,
		);
		expect(paused.details?.job?.enabled).toBe(false);

		const resumed = await definition.execute(
			"resume",
			{ action: "resume", id: "CI triage" },
			undefined,
			undefined,
			context,
		);
		expect(resumed.details?.job?.enabled).toBe(true);

		const removed = await definition.execute(
			"delete",
			{ action: "delete", id: "CI triage" },
			undefined,
			undefined,
			context,
		);
		expect(removed.content[0]?.type).toBe("text");
		expect(removed.content[0]?.type === "text" ? removed.content[0].text : "").toContain("Deleted scheduled task");
		expect(await service.listForCwd("/proj")).toHaveLength(0);

		await service.dispose();
	});

	it("rejects ambiguous timing and missing services", async () => {
		const service = new CronService({ runtime: makeRuntime("/proj", makeFakeSession()) });
		const definition = createScheduleTaskToolDefinition({ getService: () => service });
		const context = { cwd: "/proj" } as never;

		await expect(
			definition.execute(
				"bad",
				{ action: "create", task: "Check CI", when: "regularly" },
				undefined,
				undefined,
				context,
			),
		).rejects.toThrow(/Could not read/);
		await expect(
			definition.execute(
				"bad2",
				{ action: "create", task: "Check CI", when: "at 9am" },
				undefined,
				undefined,
				context,
			),
		).rejects.toThrow(/daily\/weekly or a one-off/);

		const unavailable = createScheduleTaskToolDefinition({ getService: () => undefined });
		await expect(unavailable.execute("none", { action: "list" }, undefined, undefined, context)).rejects.toThrow(
			/not available in this session/,
		);

		await service.dispose();
	});
});

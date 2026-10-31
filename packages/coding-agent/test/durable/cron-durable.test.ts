/**
 * Durable scheduled runs: with `cron.durable` on, a fire executes on the durable
 * harness through the engine registry, and the run history records it.
 */

import { mkdtempSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, type Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalAgentDir = process.env.A_CODER_CLI_CODING_AGENT_DIR;

beforeEach(() => {
	process.env.A_CODER_CLI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "cron-durable-"));
});

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	else process.env.A_CODER_CLI_CODING_AGENT_DIR = originalAgentDir;
});

const store = await import("../../src/core/cron/store.ts");
const { CronService } = await import("../../src/core/cron/service.ts");

const model = { id: "faux-1", provider: "faux", api: "faux", name: "Faux" } as unknown as Model<"faux">;

function answerStream(text: string) {
	const message = fauxAssistantMessage(text);
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({ type: "start", partial: message });
		stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}

function fakeSession(cwd: string, durable: boolean) {
	const settingsManager = {
		getCronDurableRuns: () => durable,
		getCronModel: () => undefined,
		getSubagentModel: () => undefined,
		getDefaultProvider: () => "faux",
		getDefaultModel: () => "faux-1",
	};
	const modelRegistry = {
		find: (provider: string, id: string) => (provider === "faux" && id === "faux-1" ? model : undefined),
		getAll: () => [model],
		getAvailable: () => [model],
		hasConfiguredAuth: () => true,
		getProviderAuthStatus: () => ({ configured: true }),
		refresh: () => {},
		authStorage: { get: () => undefined },
		streamSimple: async () => answerStream("durable ran the sweep"),
	};
	return {
		isStreaming: false,
		sessionFile: join(cwd, "fake.jsonl"),
		messages: [],
		prompt: vi.fn(async () => {}),
		sendUserMessage: vi.fn(async () => {}),
		bindTurnPermissionMode: vi.fn(() => () => {}),
		bindUnattendedRun: vi.fn(() => () => {}),
		bindTurnModel: vi.fn(() => () => {}),
		bindExtensions: vi.fn(async () => {}),
		setPermissionMode: vi.fn(),
		abort: vi.fn(async () => {}),
		dispose: vi.fn(),
		settingsManager,
		modelRegistry,
	};
}

describe("durable scheduled runs", () => {
	it("executes a fire on the durable harness and records it", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "cron-durable-cwd-"));
		const session = fakeSession(cwd, true);
		const service = new CronService({
			runtime: {
				cwd,
				session: session as never,
				services: { agentDir: process.env.A_CODER_CLI_CODING_AGENT_DIR ?? "" },
				createSideRuntime: vi.fn(),
			},
		});
		const job = await service.create({
			name: "Durable sweep",
			prompt: "check the repo",
			schedule: { kind: "every", minutes: 30 },
			cwd,
		});
		// A due window: fireJob runs it as a scheduled fire, not a manual one.
		await store.updateJob(job.id, (j) => {
			j.nextRunAt = Date.now() - 10 * 60_000;
		});
		const fire = (
			service as unknown as { fireJob: (job: { id: string }, trigger: "schedule") => Promise<void> }
		).fireJob.bind(service);
		await fire(job, "schedule");

		const runs = await service.listRuns(job.id);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			execution: "durable",
			status: "ok",
			model: "faux/faux-1",
			summary: "durable ran the sweep",
		});
		// Storage is real: the run left a JSONL checkpoint directory behind.
		const storage = await readdir(join(process.env.A_CODER_CLI_CODING_AGENT_DIR ?? "", "durable", "cron"));
		expect(storage.some((entry) => entry.startsWith("cron-"))).toBe(true);
		await service.dispose();
	});

	it("keeps the session path when durable is off", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "cron-durable-off-"));
		const session = fakeSession(cwd, false);
		const service = new CronService({
			runtime: {
				cwd,
				session: session as never,
				services: { agentDir: process.env.A_CODER_CLI_CODING_AGENT_DIR ?? "" },
				createSideRuntime: vi.fn(async () => ({ session: fakeSession(cwd, false) as never })),
			},
		});
		const job = await service.create({
			name: "Session sweep",
			prompt: "check the repo",
			schedule: { kind: "every", minutes: 30 },
			cwd,
			isolated: false,
		});
		await store.updateJob(job.id, (j) => {
			j.nextRunAt = Date.now() - 10 * 60_000;
		});
		const fire = (
			service as unknown as { fireJob: (job: { id: string }, trigger: "schedule") => Promise<void> }
		).fireJob.bind(service);
		await fire(job, "schedule");

		const runs = await service.listRuns(job.id);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.execution).not.toBe("durable");
		expect(store.listRuns).toBeTypeOf("function");
		await service.dispose();
	});
});

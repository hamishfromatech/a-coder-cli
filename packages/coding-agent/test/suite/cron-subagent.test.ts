import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CronService } from "../../src/core/cron/service.ts";
import { createHarness, type Harness } from "./harness.ts";

const originalAgentDir = process.env.A_CODER_CLI_CODING_AGENT_DIR;

describe("scheduled-task isolated subagents", () => {
	let harness: Harness | undefined;

	beforeEach(async () => {
		harness = await createHarness();
		process.env.A_CODER_CLI_CODING_AGENT_DIR = harness.tempDir;
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
		if (originalAgentDir === undefined) delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
		else process.env.A_CODER_CLI_CODING_AGENT_DIR = originalAgentDir;
	});

	it("executes a run in a real background subagent and records its result", async () => {
		const h = harness;
		if (!h) throw new Error("harness missing");
		h.setResponses([fauxAssistantMessage("scheduled subagent result"), fauxAssistantMessage("notification ack")]);
		const service = new CronService({
			triage: async () => undefined,
			runtime: {
				cwd: h.tempDir,
				session: h.session,
				services: { agentDir: h.tempDir },
				createSideRuntime: async () => {
					throw new Error("unused in this test");
				},
			},
		});
		const job = await service.create({
			name: "Subagent routine",
			prompt: "do scheduled work",
			schedule: { kind: "every", minutes: 30 },
			cwd: h.tempDir,
		});
		await service.runNow(job.id);
		const runs = await service.listRuns(job.id);
		expect(runs[0]).toMatchObject({
			execution: "subagent",
			status: "ok",
			summary: "scheduled subagent result",
		});
		expect(runs[0]?.subagentId).toBeTruthy();
		await service.dispose();
	});
});

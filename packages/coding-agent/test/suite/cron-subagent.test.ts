import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CronService } from "../../src/core/cron/service.ts";
import { createHarness, type Harness } from "./harness.ts";

const originalAgentDir = process.env.A_CODER_CLI_CODING_AGENT_DIR;

describe("scheduled-task isolated subagents", () => {
	let harness: Harness | undefined;

	beforeEach(async () => {
		harness = await createHarness();
		const model = harness.getModel();
		harness.settingsManager.setCronModel(`${model.provider}/${model.id}`);
		process.env.A_CODER_CLI_CODING_AGENT_DIR = harness.tempDir;
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
		if (originalAgentDir === undefined) delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
		else process.env.A_CODER_CLI_CODING_AGENT_DIR = originalAgentDir;
	});

	it("lets an unattended run use mutating tools instead of soft-denying them", async () => {
		const h = harness;
		if (!h) throw new Error("harness missing");
		// The resting mode a headless session runs in: auto soft-denies bash /
		// write / edit, and with no TTY the prompt becomes a hard deny.
		h.session.setPermissionMode("auto");
		h.settingsManager.setPermissionPolicies({ softDeny: ["$defaults"] });
		const userMode = h.settingsManager.getPermissionMode();
		const target = join(h.tempDir, "scheduled-write.txt");
		h.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: target, content: "scheduled ok" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("wrote the file"),
			fauxAssistantMessage("notification ack"),
		]);
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
			name: "Writes a file",
			prompt: "write the file",
			schedule: { kind: "every", minutes: 30 },
			cwd: h.tempDir,
		});
		await service.runNow(job.id);
		const runs = await service.listRuns(job.id);
		expect(runs[0]).toMatchObject({ execution: "subagent", status: "ok" });
		expect(existsSync(target)).toBe(true);
		expect(readFileSync(target, "utf-8")).toBe("scheduled ok");
		// The run-scoped allow must never leak into the user's global mode.
		expect(h.settingsManager.getPermissionMode()).toBe(userMode);
		await service.dispose();
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

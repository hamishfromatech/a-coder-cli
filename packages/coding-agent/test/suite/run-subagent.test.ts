import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_TEAMS_DIR } from "../../src/config.ts";
import type { InProcessSubAgentRecord } from "../../src/core/extensions/types.ts";
import { readTeamFile, TEAM_LEAD_NAME, writeTeamFile } from "../../src/core/teams/team-file.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession.runSubAgent (in-process)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("runs a foreground sub-agent and returns its final text", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("sub-agent reply: ok")]);

		const result = await harness.session.runSubAgent({ prompt: "say ok", maxTurns: 5 });

		expect(result.agentType).toBe("general-purpose");
		expect(result.finalText).toContain("ok");
		expect(result.turnCount).toBe(1);
		expect(result.toolUseCount).toBe(0);
	});

	it("reports an unknown subagent_type without throwing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const result = await harness.session.runSubAgent({ agentType: "no-such-agent", prompt: "x" });

		expect(result.warnings?.[0]).toContain("unknown subagent_type");
		expect(result.finalText).toContain("Unknown subagent_type");
		expect(result.turnCount).toBe(0);
	});

	it("streams progress events for the run", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("done")]);
		const events: { type: string }[] = [];

		await harness.session.runSubAgent({
			prompt: "say done",
			maxTurns: 5,
			onProgress: (e) => events.push({ type: e.type }),
		});

		expect(events.map((e) => e.type)).toContain("turn_complete");
		expect(events.some((e) => e.type === "completed")).toBe(true);
	});
});

describe("AgentSession background sub-agents (in-process store)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("runs a background sub-agent and exposes it via get/list/wait", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("background reply")]);

		const { id } = harness.session.runSubAgentBackground({
			id: "bg-1",
			prompt: "say ok",
			maxTurns: 5,
		});
		expect(id).toBe("bg-1");

		// Listed immediately while running.
		expect(harness.session.listSubAgents().some((r) => r.id === id)).toBe(true);

		const record = await harness.session.waitSubAgent(id);
		expect(record?.status).toBe("completed");
		expect(record?.finalText).toContain("background reply");
		expect(record?.turnCount).toBe(1);

		const after = harness.session.getSubAgent(id);
		expect(after?.status).toBe("completed");
		expect(after?.finalText).toContain("background reply");
	});

	it("records a failed background sub-agent for an unknown subagent_type", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const { id } = harness.session.runSubAgentBackground({
			id: "bg-bad",
			agentType: "no-such-agent",
			prompt: "x",
		});
		expect(id).toBe("bg-bad");

		const record = harness.session.getSubAgent(id);
		expect(record?.status).toBe("failed");
		expect(record?.error).toContain("Unknown subagent_type");
	});

	it("kill_subagent aborts a running background sub-agent", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("never")]);

		const { id } = harness.session.runSubAgentBackground({
			id: "bg-kill",
			prompt: "say ok",
			maxTurns: 5,
		});
		const killed = harness.session.killSubAgent(id, "test");
		expect(killed?.status).toBe("killed");

		const record = await harness.session.waitSubAgent(id);
		expect(record?.status).toBe("killed");
	});

	it("streams live progress via subscribeSubAgents with a populated timeline", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("live reply")]);

		const snapshots: InProcessSubAgentRecord[] = [];
		const unsub = harness.session.subscribeSubAgents((records) => {
			snapshots.push(...records);
		});

		const { id } = harness.session.runSubAgentBackground({
			id: "bg-stream",
			prompt: "say ok",
			maxTurns: 5,
		});

		await harness.session.waitSubAgent(id);
		unsub();

		const running = snapshots.find((s) => s.id === id && s.status === "running");
		const done = snapshots.find((s) => s.id === id && s.status === "completed");
		expect(running).toBeDefined();
		expect(done).toBeDefined();
		expect(done?.finalText).toContain("live reply");
		expect(done?.timeline.map((e) => e.type)).toEqual(expect.arrayContaining(["text", "turn_complete", "completed"]));
	});

	it("enqueues a completion notification for a background sub-agent", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("bg done")]);
		const { id } = harness.session.runSubAgentBackground({
			id: "bg-notif",
			prompt: "x",
			maxTurns: 5,
		});
		await harness.session.waitSubAgent(id);

		const notes = harness.session.drainPendingNotifications();
		expect(notes.some((n) => n.includes("bg-notif") && n.includes("completed"))).toBe(true);
	});

	it("falls back to no isolation when a worktree is requested outside a git repo", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("wt reply")]);
		const { id } = harness.session.runSubAgentBackground({
			id: "bg-wt",
			prompt: "x",
			maxTurns: 5,
			isolation: "worktree",
		});
		const record = await harness.session.waitSubAgent(id);
		expect(record?.status).toBe("completed");
		expect(record?.finalText).toContain("wt reply");
		// Harness cwd is a plain temp dir, so the worktree path must be absent and a warning recorded.
		expect(record?.worktreePath).toBeUndefined();
		expect(record?.error).toContain("worktree isolation failed");
	});

	it("accumulates token usage from turn_end onto the record", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([
			{
				...fauxAssistantMessage("token reply"),
				usage: {
					input: 100,
					output: 50,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 150,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		]);
		const { id } = harness.session.runSubAgentBackground({ id: "bg-tok", prompt: "x", maxTurns: 5 });
		const record = await harness.session.waitSubAgent(id);
		// The faux provider computes usage from the serialized context (it ignores
		// the injected usage), so assert accumulation happened rather than a fixed number.
		expect(record?.totalTokens).toBeGreaterThan(0);
		expect(record?.inputTokens).toBeGreaterThan(0);
		expect(record?.outputTokens).toBeGreaterThan(0);
	});

	it("registers a named teammate and flips isActive on completion", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const teamsDir = await mkdtemp(join(tmpdir(), "a-coder-teams-suite-"));
		process.env[ENV_TEAMS_DIR] = teamsDir;
		try {
			await writeTeamFile("t", {
				name: "t",
				createdAt: 1,
				leadAgentId: `${TEAM_LEAD_NAME}@t`,
				members: [{ agentId: `${TEAM_LEAD_NAME}@t`, name: TEAM_LEAD_NAME, joinedAt: 1, isActive: true }],
			});
			harness.setResponses([fauxAssistantMessage("team reply")]);
			const { id } = harness.session.runSubAgentBackground({
				id: "bg-team",
				prompt: "x",
				maxTurns: 5,
				name: "backend",
				teamName: "t",
			});
			const record = await harness.session.waitSubAgent(id);
			expect(record?.teammateName).toBe("backend");
			const file = await readTeamFile("t");
			const member = file?.members.find((m) => m.name === "backend");
			expect(member).toBeDefined();
			expect(member?.isActive).toBe(false);
		} finally {
			delete process.env[ENV_TEAMS_DIR];
			await rm(teamsDir, { recursive: true, force: true });
		}
	});
});

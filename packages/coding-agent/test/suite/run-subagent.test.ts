import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { InProcessSubAgentRecord } from "../../src/core/extensions/types.ts";
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
});

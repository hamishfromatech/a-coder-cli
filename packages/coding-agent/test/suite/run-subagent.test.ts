import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
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

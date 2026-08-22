import { beforeAll, describe, expect, it } from "vitest";
import type { InProcessSubAgentRecord } from "../src/core/extensions/types.ts";
import { SubAgentCardComponent } from "../src/modes/interactive/components/subagent-card.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => {
	initTheme("dark", false);
});

function makeRecord(over: Partial<InProcessSubAgentRecord>): InProcessSubAgentRecord {
	return {
		id: "r1",
		agentType: "general-purpose",
		status: "running",
		createdAt: 0,
		startedAt: 0,
		updatedAt: 0,
		toolUseCount: 0,
		turnCount: 0,
		timeline: [],
		detached: false,
		...over,
	};
}

describe("SubAgentCardComponent", () => {
	it("renders a running card with agent type and live tool usage", () => {
		const card = new SubAgentCardComponent(
			makeRecord({ status: "running", toolUseCount: 3, lastToolName: "Read", startedAt: Date.now() - 3200 }),
		);
		const line = card.render(120).join("\n");
		expect(line).toContain("Agent[general-purpose]");
		expect(line).toContain("running");
		expect(line).toContain("3 tool uses");
		expect(line).toContain("last: Read");
	});

	it("renders a completed card with summary", () => {
		const card = new SubAgentCardComponent(
			makeRecord({ status: "completed", toolUseCount: 7, finalText: "done", startedAt: Date.now() - 12345 }),
		);
		const line = card.render(120).join("\n");
		expect(line).toContain("Done");
		expect(line).toContain("7 tool uses");
	});

	it("renders a failed card with the error", () => {
		const card = new SubAgentCardComponent(
			makeRecord({ status: "failed", toolUseCount: 1, error: "boom", startedAt: Date.now() - 500 }),
		);
		const line = card.render(120).join("\n");
		expect(line).toContain("Failed");
		expect(line).toContain("boom");
	});

	it("updates live when the record advances to completed", () => {
		const startedAt = Date.now() - 3000;
		const card = new SubAgentCardComponent(
			makeRecord({ status: "running", toolUseCount: 1, lastToolName: "Read", startedAt }),
		);
		expect(card.render(120).join("\n")).toContain("running");
		card.update(makeRecord({ status: "completed", toolUseCount: 2, startedAt }));
		expect(card.render(120).join("\n")).toContain("Done");
		expect(card.render(120).join("\n")).toContain("2 tool uses");
	});
});

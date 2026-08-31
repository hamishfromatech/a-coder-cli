import { beforeAll, describe, expect, it } from "vitest";
import type { InProcessSubAgentRecord } from "../src/core/extensions/types.ts";
import type { BackgroundProcessRecord } from "../src/core/stores/background-process-store.ts";
import { AgentsPanelComponent } from "../src/modes/interactive/components/agents-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => {
	initTheme("dark", false);
});

function makeRecord(over: Partial<InProcessSubAgentRecord>): InProcessSubAgentRecord {
	const now = Date.now();
	return {
		id: "r1",
		agentType: "general-purpose",
		status: "running",
		createdAt: now,
		startedAt: now,
		updatedAt: now,
		toolUseCount: 0,
		turnCount: 0,
		timeline: [],
		detached: false,
		...over,
	};
}

function makeProcess(over: Partial<BackgroundProcessRecord>): BackgroundProcessRecord {
	return {
		id: "p1",
		command: "npm run dev",
		pid: 4242,
		startedAt: Date.now() - 12_000,
		endedAt: undefined,
		status: "running",
		exitCode: undefined,
		output: "",
		totalLines: 0,
		totalBytes: 1200,
		fullOutputPath: undefined,
		...over,
	};
}

function renderPanel(subs: InProcessSubAgentRecord[], procs: BackgroundProcessRecord[] = []): string {
	const panel = new AgentsPanelComponent();
	panel.update(subs, procs);
	return panel.render(120).join("\n");
}

describe("AgentsPanelComponent", () => {
	it("renders a running sub-agent with type, goal, tool count and last tool", () => {
		const line = renderPanel([
			makeRecord({
				status: "running",
				toolUseCount: 3,
				lastToolName: "Read",
				goal: "map the auth flow",
			}),
		]);
		expect(line).toContain("AGENTS");
		expect(line).toContain("Agent[general-purpose]");
		expect(line).toContain("map the auth flow");
		expect(line).toContain("3 tool uses");
		expect(line).toContain("last: Read");
	});

	it("renders a completed detached sub-agent with its summary", () => {
		const now = Date.now();
		const line = renderPanel([
			makeRecord({
				status: "completed",
				detached: true,
				toolUseCount: 7,
				startedAt: now - 12_345,
				updatedAt: now - 2_000,
			}),
		]);
		expect(line).toContain("done");
		expect(line).toContain("7 tool uses");
	});

	it("drops finished foreground sub-agents (the tool result covers them)", () => {
		const now = Date.now();
		const line = renderPanel([
			makeRecord({
				status: "completed",
				detached: false,
				toolUseCount: 7,
				startedAt: now - 12_345,
				updatedAt: now - 1_000,
			}),
		]);
		expect(line).not.toContain("Agent[general-purpose]");
		expect(line, "empty panel renders no header").not.toContain("AGENTS");
	});

	it("renders a failed sub-agent with the error", () => {
		const line = renderPanel([makeRecord({ status: "failed", toolUseCount: 1, error: "boom", detached: true })]);
		expect(line).toContain("Failed");
		expect(line).toContain("boom");
	});

	it("renders a running background process with command and duration", () => {
		const line = renderPanel([], [makeProcess({})]);
		expect(line).toContain("npm run dev");
		expect(line).toContain("1.2KB");
	});

	it("keeps a finished background process with its terminal glyph and exit code", () => {
		const now = Date.now();
		const line = renderPanel(
			[],
			[makeProcess({ status: "error", endedAt: now - 1_000, exitCode: 1, totalBytes: 0 })],
		);
		expect(line).toContain("failed");
		expect(line).toContain("exit 1");
	});

	it("updates to done when a sub-agent record advances to completed", () => {
		const panel = new AgentsPanelComponent();
		const now = Date.now();
		const running = makeRecord({ status: "running", toolUseCount: 1, startedAt: now - 3000, detached: true });
		panel.update([running], []);
		const before = panel.render(120).join("\n");
		expect(before).toContain("running");

		panel.update([{ ...running, status: "completed", toolUseCount: 2, updatedAt: now }], []);
		const after = panel.render(120).join("\n");
		expect(after).toContain("done");
		expect(after).toContain("2 tool uses");
	});

	it("renders nothing when there is nothing to show", () => {
		const panel = new AgentsPanelComponent();
		panel.update([], []);
		expect(panel.render(120)).toEqual([]);
	});
});

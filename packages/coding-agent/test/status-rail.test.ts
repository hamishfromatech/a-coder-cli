import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { InProcessSubAgentRecord } from "../src/core/extensions/types.ts";
import type { BackgroundProcessRecord } from "../src/core/stores/background-process-store.ts";
import { deriveSubAgentGoal } from "../src/core/subagents/goal.ts";
import { StatusRailComponent } from "../src/modes/interactive/components/status-rail.ts";
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

function renderRail(subs: InProcessSubAgentRecord[], procs: BackgroundProcessRecord[] = []): string {
	const rail = new StatusRailComponent();
	rail.update(subs, procs);
	return rail.render(120).join("\n");
}

describe("StatusRailComponent", () => {
	it("renders a running sub-agent with type, tool count and tokens", () => {
		const line = renderRail([makeRecord({ status: "running", toolUseCount: 3, totalTokens: 1200 })]);
		expect(line).toContain("1 running");
		expect(line).toContain("general-purpose");
		expect(line).not.toContain("Agent[");
		expect(line).toContain("3 tools");
		expect(line).toContain("1.2k tok");
	});

	it("renders a teammate label as an @mention", () => {
		const line = renderRail([makeRecord({ status: "running", teammateName: "backend" })]);
		expect(line).toContain("@backend");
		expect(line).not.toContain("general-purpose");
	});

	it("renders a running background process with command and duration", () => {
		const line = renderRail([], [makeProcess({})]);
		expect(line).toContain("npm run dev");
		expect(line).toContain("1.2KB");
	});

	it("combines sub-agents and processes into one running count", () => {
		const line = renderRail([makeRecord({}), makeRecord({ id: "r2", teammateName: "reviewer" })], [makeProcess({})]);
		expect(line).toContain("3 running");
		expect(line).toContain("@reviewer");
		expect(line).toContain("npm run dev");
	});

	it("renders a single item without the count prefix pluralization issues", () => {
		const line = renderRail([], [makeProcess({})]);
		expect(line).toContain("1 running");
	});

	it("renders nothing when nothing is running", () => {
		const rail = new StatusRailComponent();
		rail.update([], []);
		expect(rail.render(120)).toEqual([]);
	});

	it("drops finished sub-agents and processes", () => {
		const now = Date.now();
		const line = renderRail(
			[makeRecord({ status: "completed", detached: true, startedAt: now - 5000, updatedAt: now - 1000 })],
			[makeProcess({ status: "done", endedAt: now - 1000 })],
		);
		expect(line).toBe("");
		expect(renderRail([], [])).toBe("");
	});

	it("updates to empty when the only running item settles", () => {
		const rail = new StatusRailComponent();
		const running = makeRecord({ status: "running", toolUseCount: 1, detached: true });
		rail.update([running], []);
		expect(rail.render(120).join("\n")).toContain("running");

		rail.update([{ ...running, status: "completed", updatedAt: Date.now() }], []);
		expect(rail.render(120)).toEqual([]);
	});

	it("stays within the terminal width", () => {
		const longCommand = "node script-with-a-very-long-name-that-keeps-going.js --flag value";
		const line = renderRail(
			[makeRecord({ teammateName: "a-very-long-teammate-name-here", toolUseCount: 12, totalTokens: 240000 })],
			[makeProcess({ command: longCommand })],
		);
		for (const row of line.split("\n")) {
			expect(visibleWidth(row)).toBeLessThanOrEqual(120);
		}
	});
});

describe("deriveSubAgentGoal", () => {
	it("skips persona preambles and surfaces the task line", () => {
		const goal = deriveSubAgentGoal(
			"You are a HyperFrames framework expert.\nYou're working inside a video repo.\n\nScaffold the highlights project",
		);
		expect(goal).toBe("Scaffold the highlights project");
	});

	it("returns the first line when there is no preamble", () => {
		expect(deriveSubAgentGoal("map the auth flow\nsecond line")).toBe("map the auth flow");
	});

	it("returns undefined for empty or all-preamble prompts", () => {
		expect(deriveSubAgentGoal(undefined)).toBeUndefined();
		expect(deriveSubAgentGoal("You are an expert.\n\nYou are thorough.")).toBeUndefined();
	});
});

import { describe, expect, it } from "vitest";
import type { InProcessSubAgentRecord } from "../src/core/extensions/types.ts";
import type { BackgroundProcessRecord } from "../src/core/stores/background-process-store.ts";
import { RunningTasksViewerComponent } from "../src/modes/interactive/components/running-tasks-viewer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

let themeReady = false;

function ensureTheme(): void {
	if (!themeReady) {
		initTheme("dark");
		themeReady = true;
	}
}

function renderComponent(component: RunningTasksViewerComponent): string[] {
	// Strip ANSI so assertions match on visible text.
	return component.render(120).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
}

function makeAgent(overrides: Partial<InProcessSubAgentRecord> = {}): InProcessSubAgentRecord {
	const now = Date.now();
	return {
		id: "agent-1",
		agentType: "general-purpose",
		status: "running",
		createdAt: now,
		startedAt: now - 30_000,
		updatedAt: now,
		goal: "fix the bug",
		toolUseCount: 3,
		turnCount: 2,
		totalTokens: 5000,
		timeline: [],
		detached: true,
		...overrides,
	};
}

function makeBash(overrides: Partial<BackgroundProcessRecord> = {}): BackgroundProcessRecord {
	const now = Date.now();
	return {
		id: "bash-1",
		command: "npm test",
		pid: 123,
		startedAt: now - 10_000,
		endedAt: undefined,
		status: "running",
		exitCode: undefined,
		output: "",
		totalLines: 0,
		totalBytes: 0,
		fullOutputPath: undefined,
		...overrides,
	};
}

describe("RunningTasksViewerComponent", () => {
	it("renders the turn usage and tool result preview in the agent view", () => {
		ensureTheme();
		const component = new RunningTasksViewerComponent(
			[
				makeAgent({
					timeline: [
						{ type: "tool_use_start", toolName: "read" },
						{
							type: "tool_use_done",
							toolName: "read",
							isError: false,
							resultChars: 1245,
							resultPreview: "export async function login() {",
						},
						{
							type: "turn_complete",
							turnCount: 2,
							usage: { inputTokens: 1310, outputTokens: 532, totalTokens: 1842 },
						},
					],
				}),
			],
			[],
			() => {},
			() => {},
		);
		// Drill into the agent view.
		component.handleInput("\r");
		const lines = renderComponent(component).join("\n");

		expect(lines).toContain("✓ read");
		expect(lines).toContain("⎿ ok (1.2k chars): export async function login() {");
		expect(lines).toContain("— turn 2 · 1,842 tok (in 1,310, out 532)");
	});

	it("shows the earlier-events-hidden indicator when the timeline is long", () => {
		ensureTheme();
		const timeline = Array.from({ length: 20 }, (_, i) => ({ type: "tool_use_start" as const, toolName: `t${i}` }));
		const component = new RunningTasksViewerComponent(
			[makeAgent({ timeline })],
			[],
			() => {},
			() => {},
		);
		component.handleInput("\r");
		const lines = renderComponent(component).join("\n");
		expect(lines).toContain("… 8 earlier events hidden");
	});

	it("shows the earlier-lines-hidden indicator for long bash output", () => {
		ensureTheme();
		const output = Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\n");
		const component = new RunningTasksViewerComponent(
			[],
			[makeBash({ output, totalLines: 30 })],
			() => {},
			() => {},
		);
		component.handleInput("\r");
		const lines = renderComponent(component).join("\n");
		expect(lines).toContain("… 15 earlier lines hidden");
		expect(lines).toContain("line-29");
		expect(lines).not.toContain("line-14");
	});

	it("toggles finished tasks with h and remembers the choice", () => {
		const finishedAgent = makeAgent({
			id: "agent-done",
			status: "completed",
			goal: "finished goal",
		});
		const runningAgent = makeAgent({ id: "agent-1", startedAt: Date.now() + 5, goal: "running goal" });
		const component = new RunningTasksViewerComponent(
			[finishedAgent, runningAgent],
			[makeBash({ id: "bash-done", status: "done" as never, command: "echo done-task" })],
			() => {},
			() => {},
		);
		ensureTheme();

		// All three visible by default.
		let lines = renderComponent(component).join("\n");
		expect(lines).toContain("finished goal");
		expect(lines).toContain("echo done-task");

		// Toggle: hide finished → only the running agent remains.
		component.handleInput("h");
		lines = renderComponent(component).join("\n");
		expect(lines).toContain("running goal");
		expect(lines).not.toContain("finished goal");
		expect(lines).not.toContain("echo done-task");
		expect(lines).toContain("show finished");

		// Toggle back.
		component.handleInput("h");
		lines = renderComponent(component).join("\n");
		expect(lines).toContain("finished goal");
		expect(lines).toContain("echo done-task");
		expect(lines).toContain("hide finished");
	});

	it("hides finished tasks when everything is done, with a hint to toggle", () => {
		const component = new RunningTasksViewerComponent(
			[makeAgent({ id: "agent-done", status: "completed" })],
			[],
			() => {},
			() => {},
		);
		ensureTheme();
		component.handleInput("h");
		const lines = renderComponent(component).join("\n");
		expect(lines).toContain("No running tasks — press h to show finished runs.");
		component.handleInput("h");
	});

	it("leaves viewing mode unaffected by the h toggle", () => {
		const finishedAgent = makeAgent({
			id: "agent-done",
			status: "completed",
			goal: "finished goal",
		});
		const runningAgent = makeAgent({ id: "agent-1", startedAt: Date.now() + 5, goal: "running goal" });
		const component = new RunningTasksViewerComponent(
			[finishedAgent, runningAgent],
			[],
			() => {},
			() => {},
		);
		ensureTheme();
		// Running tasks sort first; move down to the finished agent and drill in.
		component.handleInput("\u001b[B");
		component.handleInput("\r");
		expect(renderComponent(component).join("\n")).toContain("finished goal");
		// 'h' in viewing mode does nothing: the open transcript stays readable.
		component.handleInput("h");
		expect(renderComponent(component).join("\n")).toContain("finished goal");
		// Back to the picker — the finished agent is still listed (default on).
		component.handleInput("\u001b");
		expect(renderComponent(component).join("\n")).toContain("finished goal");
	});

	it("reflows rows to the render width without wrapping metadata", () => {
		ensureTheme();
		const component = new RunningTasksViewerComponent(
			[
				makeAgent({
					goal: "A very long goal that should be truncated instead of pushing metadata onto its own line",
					toolUseCount: 12,
					turnCount: 4,
				}),
			],
			[],
			() => {},
			() => {},
		);
		const lines = component.render(80).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
		expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(80);
		expect(lines.join("\n")).toContain("12 tools");
		expect(lines.join("\n")).toContain("4t");
	});

	it("groups active above finished, shows counts, and previews the selection", () => {
		ensureTheme();
		const component = new RunningTasksViewerComponent(
			[
				makeAgent({ id: "agent-done", status: "completed", goal: "finished goal" }),
				makeAgent({ id: "agent-run", goal: "running goal", toolUseCount: 1, turnCount: 1 }),
			],
			[],
			() => {},
			() => {},
		);
		const lines = renderComponent(component).join("\n");
		expect(lines).toContain("Background tasks");
		expect(lines).toContain("1 active · 1 finished");
		expect(lines).toContain("ACTIVE 1");
		expect(lines).toContain("FINISHED 1");
		expect(lines).toContain("running goal");
		expect(lines.indexOf("ACTIVE 1")).toBeLessThan(lines.indexOf("FINISHED 1"));

		component.handleInput("\r");
		const detail = renderComponent(component).join("\n");
		expect(detail).toContain("1 tool · 1 turn");
		expect(detail).toContain("Timeline");
	});

	it("renders the picker with both kinds and honors kill routing", () => {
		ensureTheme();
		const killed: string[] = [];
		const component = new RunningTasksViewerComponent(
			[makeAgent({ id: "agent-1", startedAt: Date.now() - 5_000 })],
			[makeBash({ id: "bash-1" })],
			() => {},
			(item) => killed.push(`${item.kind}:${item.record.id}`),
		);
		const lines = renderComponent(component).join("\n");
		expect(lines).toContain("Background tasks");
		expect(lines).toContain("agent");
		expect(lines).toContain("bash");
		expect(lines).toContain("fix the bug");
		expect(lines).toContain("$ npm test");

		// Kill the selected item (active tasks sort newest first).
		component.handleInput("k");
		expect(killed).toEqual(["agent:agent-1"]);
	});
});

import { describe, expect, it } from "vitest";
import type { InProcessSubAgentRecord } from "../src/core/extensions/types.ts";
import { RunningTasksViewerComponent } from "../src/modes/interactive/components/running-tasks-viewer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

function record(overrides: Partial<InProcessSubAgentRecord>): InProcessSubAgentRecord {
	return {
		id: "agent-1",
		agentType: "general-purpose",
		status: "completed",
		createdAt: 1,
		startedAt: 1,
		updatedAt: 2,
		goal: "Audit the routes",
		prompt: "Audit the routes and report",
		model: "test-model",
		finalText: "All routes audited.\n\n- fixed /a\n- flagged /b",
		toolUseCount: 3,
		turnCount: 2,
		timeline: [],
		detached: true,
		outputFile: "/tmp/agent-1.jsonl",
		worktreePath: "/tmp/worktree-1",
		...overrides,
	};
}

describe("RunningTasksViewer outcome + actions", () => {
	it("renders the final answer and copies it with c", () => {
		const copied: string[] = [];
		const viewer = new RunningTasksViewerComponent(
			[record({})],
			[],
			() => {},
			() => {},
			undefined,
			{ copyText: (text) => void copied.push(text) },
		);
		viewer.handleInput("\r");
		const output = viewer.render(100).join("\n");
		expect(output).toContain("Result");
		expect(output).toContain("All routes audited.");
		expect(output).toContain("copy result");
		viewer.handleInput("c");
		expect(copied.at(-1)).toContain("All routes audited.");
	});

	it("leads a failure with its error", () => {
		const viewer = new RunningTasksViewerComponent(
			[record({ status: "failed", error: "stream ended early", finalText: undefined })],
			[],
			() => {},
			() => {},
		);
		viewer.handleInput("\r");
		const output = viewer.render(100).join("\n");
		expect(output).toContain("Failure");
		expect(output).toContain("stream ended early");
	});

	it("opens the log, copies the path, shows a diff, and reruns", () => {
		const opened: string[] = [];
		const copied: string[] = [];
		const diffs: string[] = [];
		const reruns: InProcessSubAgentRecord[] = [];
		const viewer = new RunningTasksViewerComponent(
			[record({})],
			[],
			() => {},
			() => {},
			undefined,
			{
				openPath: (path) => void opened.push(path),
				copyText: (text) => void copied.push(text),
				diffStat: (path) => {
					diffs.push(path);
					return " M src/a.ts";
				},
				rerunAgent: (rec) => {
					reruns.push(rec);
					return { id: "agent-rerun-1" };
				},
			},
		);
		viewer.handleInput("\r");
		viewer.handleInput("o");
		expect(opened.at(-1)).toBe("/tmp/agent-1.jsonl");
		viewer.handleInput("y");
		expect(copied.at(-1)).toBe("/tmp/agent-1.jsonl");
		viewer.handleInput("d");
		expect(diffs.at(-1)).toBe("/tmp/worktree-1");
		expect(viewer.render(100).join("\n")).toContain(" M src/a.ts");
		viewer.handleInput("r");
		expect(reruns).toHaveLength(1);
		expect(viewer.render(100).join("\n")).toContain("agent-rerun-1");
	});

	it("refuses to rerun a running agent", () => {
		const reruns: InProcessSubAgentRecord[] = [];
		const viewer = new RunningTasksViewerComponent(
			[record({ status: "running", finalText: undefined })],
			[],
			() => {},
			() => {},
			undefined,
			{
				rerunAgent: (rec) => {
					reruns.push(rec);
					return { id: "nope" };
				},
			},
		);
		viewer.handleInput("\r");
		viewer.handleInput("r");
		expect(reruns).toHaveLength(0);
		expect(viewer.render(100).join("\n")).toContain("Stop the sub-agent before rerunning");
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearWorkflowHandlers,
	getWorkflowRunSummaries,
	pauseWorkflowRun,
	registerWorkflowPauseHandler,
	registerWorkflowStopHandler,
	removeWorkflowRun,
	stopWorkflowRun,
	subscribeWorkflowRuns,
	updateWorkflowRun,
} from "../src/core/workflows/registry.ts";
import type { WorkflowRunState } from "../src/core/workflows/types.ts";

function makeState(id: string, overrides?: Partial<WorkflowRunState>): WorkflowRunState {
	return {
		id,
		workflowName: "sweep",
		status: "running",
		startedAt: 1000,
		updatedAt: 1000,
		agentCount: 0,
		phases: [],
		steps: {},
		agents: [],
		scriptContent: "export const meta = { name: 'sweep', description: '' }",
		...overrides,
	};
}

afterEach(() => {
	removeWorkflowRun("r1");
	removeWorkflowRun("r2");
});

describe("workflow run registry", () => {
	it("publishes summaries that strip agent prompts and results", () => {
		updateWorkflowRun(
			makeState("r1", {
				agentCount: 2,
				phases: ["discover", "verify"],
				steps: {
					discover: { stepId: "discover", rounds: 1 },
					verify: { stepId: "verify", rounds: 1, error: "agent 1 failed" },
				},
				agents: [
					{
						seq: 0,
						prompt: "list every file",
						label: "list",
						phase: "discover",
						status: "completed",
						result: { files: ["a", "b"] },
					},
					{
						seq: 1,
						prompt: "verify a",
						label: "verify",
						phase: "verify",
						status: "failed",
						error: "agent 1 failed",
					},
				],
			}),
		);
		const runs = getWorkflowRunSummaries();
		expect(runs.map((r) => r.id)).toEqual(["r1"]);
		const run = runs[0]!;
		expect(run.agentCount).toBe(2);
		expect(run.phases).toEqual(["discover", "verify"]);
		expect(run.steps.discover).toEqual({ stepId: "discover", rounds: 1 });
		expect(run.steps.verify).toEqual({ stepId: "verify", rounds: 1, error: "agent 1 failed" });
		// Prompts and results are stripped; labels and statuses are kept.
		const summary = JSON.stringify(run);
		expect(summary).not.toContain("list every file");
		expect(summary).not.toContain('"result"');
		expect(run.agents[0]).toMatchObject({ seq: 0, label: "list", phase: "discover", status: "completed" });
	});

	it("notifies subscribers with the summary and stops on unsubscribe", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeWorkflowRuns(listener);
		updateWorkflowRun(makeState("r2", { status: "running" }));
		expect(listener).toHaveBeenCalledTimes(1);
		const [id, value] = listener.mock.calls[0] as [string, { id: string } | undefined];
		expect(id).toBe("r2");
		expect(value?.id).toBe("r2");
		unsubscribe();
		updateWorkflowRun(makeState("r2", { status: "completed" }));
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("routes stop and pause requests through the registered handlers and clears them", () => {
		const stop = vi.fn();
		const pause = vi.fn();
		updateWorkflowRun(makeState("r1"));
		registerWorkflowStopHandler("r1", stop);
		registerWorkflowPauseHandler("r1", pause);
		expect(stopWorkflowRun("r1")).toBe(true);
		expect(stop).toHaveBeenCalledTimes(1);
		// The handler is consumed: a second stop is a no-op.
		expect(stopWorkflowRun("r1")).toBe(false);

		registerWorkflowStopHandler("r1", stop);
		registerWorkflowPauseHandler("r1", pause);
		expect(pauseWorkflowRun("r1", true)).toBe(true);
		expect(pause).toHaveBeenCalledWith(true);
		clearWorkflowHandlers("r1");
		expect(stopWorkflowRun("r1")).toBe(false);
		expect(pauseWorkflowRun("r1", false)).toBe(false);
		expect(stopWorkflowRun("ghost")).toBe(false);
	});

	it("keeps the summary's terminal status after the run ends", () => {
		updateWorkflowRun(makeState("r1"));
		registerWorkflowStopHandler("r1", () => {});
		updateWorkflowRun(
			makeState("r1", { status: "failed", error: 'agent "audit" failed schema validation', agentCount: 3 }),
		);
		const run = getWorkflowRunSummaries()[0]!;
		expect(run.status).toBe("failed");
		expect(run.error).toBe('agent "audit" failed schema validation');
		removeWorkflowRun("r1");
		expect(getWorkflowRunSummaries()).toHaveLength(0);
	});
});

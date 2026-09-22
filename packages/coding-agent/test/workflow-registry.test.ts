import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearWorkflowStopHandler,
	getWorkflowRunSummaries,
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
		filePath: "/tmp/sweep.sop.md",
		status: "running",
		startedAt: 1000,
		updatedAt: 1000,
		steps: {},
		agentCount: 0,
		...overrides,
	};
}

afterEach(() => {
	removeWorkflowRun("r1");
	removeWorkflowRun("r2");
});

describe("workflow run registry", () => {
	it("publishes summaries that strip step outputs", () => {
		updateWorkflowRun(
			makeState("r1", {
				agentCount: 4,
				steps: {
					discover: { stepId: "discover", rounds: 1, outputs: [{ files: ["a", "b"] }], lastPrompt: "list" },
					audit: { stepId: "audit", rounds: 2, outputs: [null, null], error: "boom" },
				},
			}),
		);
		const runs = getWorkflowRunSummaries();
		expect(runs.map((r) => r.id)).toEqual(["r1"]);
		const run = runs[0]!;
		expect(run.agentCount).toBe(4);
		expect(run.steps.discover).toEqual({ stepId: "discover", rounds: 1 });
		expect(run.steps.audit).toEqual({ stepId: "audit", rounds: 2, error: "boom" });
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

	it("routes stop requests through the registered handler and clears it", () => {
		const stop = vi.fn();
		updateWorkflowRun(makeState("r1"));
		registerWorkflowStopHandler("r1", stop);
		expect(stopWorkflowRun("r1")).toBe(true);
		expect(stop).toHaveBeenCalledTimes(1);
		// The handler is consumed: a second stop is a no-op.
		expect(stopWorkflowRun("r1")).toBe(false);

		registerWorkflowStopHandler("r1", stop);
		clearWorkflowStopHandler("r1");
		expect(stopWorkflowRun("r1")).toBe(false);
		expect(stopWorkflowRun("ghost")).toBe(false);
	});

	it("keeps the summary's terminal status after the run ends", () => {
		updateWorkflowRun(makeState("r1"));
		registerWorkflowStopHandler("r1", () => {});
		updateWorkflowRun(makeState("r1", { status: "failed", error: "step audit failed", agentCount: 3 }));
		const run = getWorkflowRunSummaries()[0]!;
		expect(run.status).toBe("failed");
		expect(run.error).toBe("step audit failed");
		removeWorkflowRun("r1");
		expect(getWorkflowRunSummaries()).toHaveLength(0);
	});
});

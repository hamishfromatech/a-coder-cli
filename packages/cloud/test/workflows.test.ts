import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectWorkflowRuns, copyWorkflowArtifacts } from "../src/workflows.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "a-coder-cloud-workflows-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function writeRunState(id: string, body: unknown): void {
	const workflowsDir = join(dir, "workflows");
	mkdirSync(workflowsDir, { recursive: true });
	writeFileSync(join(workflowsDir, `${id}.json`), JSON.stringify(body), "utf-8");
}

describe("collectWorkflowRuns", () => {
	it("parses valid run states newest first", () => {
		writeRunState("sweep-1", {
			id: "sweep-1",
			workflowName: "sweep",
			filePath: "/tmp/sweep.sop.md",
			status: "completed",
			startedAt: 1,
			updatedAt: 2,
			steps: {},
			agentCount: 4,
		});
		writeRunState("sweep-2", {
			id: "sweep-2",
			workflowName: "sweep",
			status: "failed",
			agentCount: 3,
			error: "step audit failed",
			steps: {
				discover: { stepId: "discover", rounds: 1, outputs: [] },
				audit: { stepId: "audit", rounds: 2, error: "boom" },
			},
		});
		const runs = collectWorkflowRuns(dir);
		expect(runs.map((r) => r.id)).toEqual(["sweep-2", "sweep-1"]);
		expect(runs[0]?.steps).toHaveLength(2);
		expect(runs[0]?.steps[1]?.error).toBe("boom");
		expect(runs[1]?.agentCount).toBe(4);
	});

	it("skips corrupt or structurally invalid states without failing", () => {
		writeRunState("junk-1", { id: "junk-1", workflowName: "sweep" }); // missing status
		writeFileSync(join(dir, "junk-2.json"), "{ not json", "utf-8");
		writeFileSync(join(dir, "notes.txt"), "x", "utf-8");
		expect(collectWorkflowRuns(dir)).toEqual([]);
	});

	it("returns empty for a missing or undefined session directory", () => {
		expect(collectWorkflowRuns(join(dir, "absent"))).toEqual([]);
		expect(collectWorkflowRuns(undefined)).toEqual([]);
	});
});

describe("copyWorkflowArtifacts", () => {
	it("copies run states into artifacts and counts them", () => {
		writeRunState("sweep-1", { id: "sweep-1", workflowName: "sweep", status: "completed" });
		const artifacts = join(dir, "artifacts");
		expect(copyWorkflowArtifacts(dir, artifacts)).toBe(1);
		expect(copyWorkflowArtifacts(dir, artifacts)).toBe(1); // overwrite ok
	});

	it("returns 0 for absent sessions", () => {
		expect(copyWorkflowArtifacts(undefined, join(dir, "artifacts"))).toBe(0);
		expect(copyWorkflowArtifacts(join(dir, "absent"), join(dir, "artifacts"))).toBe(0);
	});
});

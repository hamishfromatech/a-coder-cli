/**
 * Workflow run-state collection for cloud tasks.
 *
 * A task's RPC worker executes workflows through the run_workflow tool; each
 * run persists state to `<sessionDir>/workflows/<runId>.json`. At finalize the
 * runner copies those files into the task artifacts (session continuity) and
 * summarizes them into the structured report.
 *
 * Deliberately structural: cloud must not import the coding-agent package
 * (type-level dependency cycle), so run states are parsed as plain JSON
 * against a local structural type — same doctrine as rpc-process.ts.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunSummary, WorkflowStepSummary } from "./types.ts";

interface WorkflowRunStateLike {
	id?: unknown;
	workflowName?: unknown;
	status?: unknown;
	agentCount?: unknown;
	error?: unknown;
	steps?: unknown;
}

/** Directory holding workflow run states for a worker session. */
export function workflowStateDir(sessionDir: string | undefined): string | undefined {
	return sessionDir ? join(sessionDir, "workflows") : undefined;
}

function parseSteps(value: unknown): WorkflowStepSummary[] {
	if (typeof value !== "object" || value === null) return [];
	const steps: WorkflowStepSummary[] = [];
	for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw !== "object" || raw === null) continue;
		const record = raw as { stepId?: unknown; rounds?: unknown; error?: unknown };
		const stepId = typeof record.stepId === "string" ? record.stepId : id;
		const rounds = typeof record.rounds === "number" && record.rounds > 0 ? Math.floor(record.rounds) : 1;
		steps.push({
			id: stepId,
			rounds,
			...(typeof record.error === "string" ? { error: record.error } : {}),
		});
	}
	return steps;
}

/**
 * Summarize a session's workflow runs, newest first. Corrupt or unreadable
 * states are skipped — the run-state files themselves land in the task
 * artifacts for inspection.
 */
export function collectWorkflowRuns(sessionDir: string | undefined): WorkflowRunSummary[] {
	const dir = workflowStateDir(sessionDir);
	if (!dir || !existsSync(dir)) return [];
	let files: string[];
	try {
		files = readdirSync(dir)
			.filter((f) => f.endsWith(".json"))
			.sort()
			.reverse();
	} catch {
		return [];
	}
	const runs: WorkflowRunSummary[] = [];
	for (const file of files) {
		try {
			const raw = JSON.parse(readFileSync(join(dir, file), "utf-8")) as WorkflowRunStateLike;
			if (typeof raw.id !== "string" || typeof raw.workflowName !== "string" || typeof raw.status !== "string") {
				continue;
			}
			runs.push({
				id: raw.id,
				workflow: raw.workflowName,
				status: raw.status,
				agentCount: typeof raw.agentCount === "number" && raw.agentCount > 0 ? Math.floor(raw.agentCount) : 0,
				...(typeof raw.error === "string" ? { error: raw.error } : {}),
				steps: parseSteps(raw.steps),
			});
		} catch {
			// unreadable run state: skip, the raw file is copied to artifacts
		}
	}
	return runs;
}

/** Copy workflow run states into the task artifacts directory. Returns the count copied. */
export function copyWorkflowArtifacts(sessionDir: string | undefined, artifactsDir: string): number {
	const dir = workflowStateDir(sessionDir);
	if (!dir || !existsSync(dir)) return 0;
	const dest = join(artifactsDir, "workflows");
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	} catch {
		return 0;
	}
	if (files.length === 0) return 0;
	mkdirSync(dest, { recursive: true });
	let copied = 0;
	for (const file of files) {
		try {
			copyFileSync(join(dir, file), join(dest, file));
			copied += 1;
		} catch {
			// best-effort
		}
	}
	return copied;
}

/**
 * Workflow run-state persistence helpers and the workflow authoring trigger.
 *
 * Run state lives as `<sessionDir>/workflows/<runId>.json` (written by the
 * runner's persist()). Resume reads those files back — a completed step whose
 * fingerprint is unchanged returns its saved result, everything after a
 * changed step reruns (see runner.ts).
 *
 * The authoring trigger is the opt-in keyword in a typed prompt that makes the
 * model author and run a workflow for the task instead of working turn by
 * turn (upstream's "ultracode" equivalent). Detection and prompt rewriting are
 * pure functions here; the input event handler applies the source guard.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { WorkflowRunState } from "./types.ts";

/** Opt-in keyword that turns a typed prompt into workflow authoring. */
export const WORKFLOW_TRIGGER_KEYWORD = "ultracode";

const KEYWORD_RE = new RegExp(`\\b${WORKFLOW_TRIGGER_KEYWORD}\\b`, "i");

/** Does the text contain the authoring keyword as a standalone word? */
export function matchesWorkflowTrigger(text: string): boolean {
	return KEYWORD_RE.test(text);
}

/**
 * Strip the keyword from the text and return the remaining task. Undefined
 * when nothing meaningful remains (the keyword was the whole input).
 */
export function stripWorkflowTrigger(text: string): string | undefined {
	const stripped = text
		.replace(new RegExp(`\\s*\\b${WORKFLOW_TRIGGER_KEYWORD}\\b\\s*:?\\s*`, "gi"), " ")
		.replace(/ {2,}/g, " ")
		.trim();
	return stripped.length > 0 ? stripped : undefined;
}

/** Build the model-facing prompt that authors + runs a workflow for the task. */
export function buildWorkflowAuthoringPrompt(task: string): string {
	return [
		"Handle this task as a dynamic workflow, not turn by turn: the work happens in background subagents, your context only orchestrates.",
		"",
		"1. Author a declarative workflow SOP for the task: a `.sop.md` file whose frontmatter declares `workflow.steps` — ordered `run` steps, `fan-out` steps over a previous step's array output, optional `until`/`max_rounds` loops, and a JSON Schema per step for structured outputs. Give it the full SOP structure (`## Overview`, `## Parameters`, `## Steps`) with the human-readable Steps section mirroring the frontmatter.",
		"2. Save it to `.a-coder-cli/workflows/<kebab-case-name>.sop.md` (create the directory if needed).",
		"3. Execute it with the run_workflow tool, passing collected inputs through `args`. Monitor progress with /workflows.",
		"4. Report the workflow's final output to the user. Do not do the task's work yourself.",
		"",
		`Task: ${task}`,
	].join("\n");
}

/**
 * Load a persisted run state for resume. Returns a discriminated result —
 * a missing or unreadable state is an error naming the run id (the caller
 * lists available runs so the failure is actionable).
 */
export function loadRunState(stateDir: string, runId: string): { state: WorkflowRunState } | { error: string } {
	const file = join(stateDir, `${runId}.json`);
	if (!existsSync(file)) {
		return { error: `nothing to resume: no run "${runId}" in this session (${file} not found)` };
	}
	try {
		const state = JSON.parse(readFileSync(file, "utf-8")) as WorkflowRunState;
		if (typeof state !== "object" || state === null || state.id !== runId || typeof state.workflowName !== "string") {
			return { error: `run state file for "${runId}" is not a valid workflow run state` };
		}
		return { state };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { error: `run state file for "${runId}" is unreadable: ${message}` };
	}
}

/** List run ids in a state directory, newest first. Empty when absent. */
export function listRunIds(stateDir: string | undefined): string[] {
	if (!stateDir || !existsSync(stateDir)) return [];
	try {
		return readdirSync(stateDir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.replace(/\.json$/, ""))
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

/** Read one run state; undefined when missing or corrupt (display paths). */
export function readRunState(stateDir: string, runId: string): WorkflowRunState | undefined {
	const loaded = loadRunState(stateDir, runId);
	return "state" in loaded ? loaded.state : undefined;
}

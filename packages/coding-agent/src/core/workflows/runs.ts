/**
 * Workflow run-state persistence helpers and the workflow authoring trigger.
 *
 * Run state lives as `<sessionDir>/workflows/<runId>.json` (written via the
 * runtime's persist callback after every agent completes). Resume reads those
 * files back — a completed agent whose prompt is unchanged returns its saved
 * result, and everything from the first changed agent onward reruns (see
 * runtime.ts).
 *
 * The authoring trigger is the opt-in keyword in a typed prompt that makes the
 * model author and run a workflow for the task instead of working turn by
 * turn. Detection and prompt rewriting are pure functions here; the input
 * event handler applies the source guard.
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

/**
 * The runtime API contract, shared by the authoring prompt and the authoring
 * skill — the model must write scripts against exactly this surface.
 */
export const WORKFLOW_SCRIPT_API_REFERENCE = [
	"Runtime API (injected as globals — plain JavaScript, top-level await):",
	"- agent(prompt, opts?) -> result | null. Spawns one subagent. Resolves to null when the agent is stopped mid-run or fails unrecoverably. opts: { schema?: JSONSchema, label?: string, model?: string }. With a schema, the agent returns JSON matching it (validated, retried up to 5 times, then the call throws).",
	"- pipeline(list, fn) -> results[]. Calls fn(item, index) for every item concurrently; each fn usually calls agent(). Failed/stopped slots stay null in the array (.filter(Boolean) to drop them). Max 4096 items per call.",
	"- parallel([tasks]) -> results[]. Awaits a set of agent calls (promises or thunks) together. Max 4096 entries.",
	"- phase('title') groups the agent calls that follow under a title in the progress view. log('message') prints a progress line. console.log also works.",
	"- args is the invocation input passed to run_workflow { args } (undefined when omitted).",
	"Script rules:",
	"- First statement: `export const meta = { name: 'kebab-case-name', description: 'What it does' }` — a plain object literal.",
	"- No import()/require, no filesystem or shell access — agents do the work; the script coordinates them.",
	"- No Date.now(), Math.random(), or new Date() without arguments — they throw so runs replay deterministically; pass timestamps through args.",
	"- Control flow is yours: conditionals, loops, filtering, comparing agent outputs against each other (adversarial verify, vote, dedupe) are plain JavaScript.",
].join("\n");

/**
 * Build the model-facing prompt that authors + runs a workflow for the task.
 */
export function buildWorkflowAuthoringPrompt(task: string): string {
	return [
		"Handle this task as a dynamic workflow, not turn by turn: the work happens in background subagents, your context only orchestrates.",
		"",
		"1. Author a workflow script for the task: a JavaScript file whose meta block names it and whose body orchestrates subagents.",
		WORKFLOW_SCRIPT_API_REFERENCE,
		"2. Save it to `.a-coder-cli/workflows/<name>.js` (create the directory if needed).",
		"3. Execute it with the run_workflow tool, passing collected inputs through `args`. Monitor progress with /workflows.",
		"4. Report the workflow's final output to the user. Do not do the task's work yourself.",
		"",
		`Task: ${task}`,
	].join("\n");
}

/**
 * Build the session prompt for auto-orchestration mode (/ultracode): every
 * typed prompt carries guidance to prefer workflow authoring for substantive
 * tasks; the model judges and keeps trivial tasks inline.
 */
export function buildAutoOrchestrationPrompt(task: string): string {
	return [
		"Auto-orchestration is on for this session. Assess this task first: if it is substantive — larger than one context window, or the same step across many items (audits, batch migrations, cross-checked research) — handle it as a dynamic workflow: author a workflow script (a .js file with `export const meta` whose body orchestrates agent()/pipeline()/parallel() over background subagents; full API reference below), save it to `.a-coder-cli/workflows/<kebab-name>.js`, and execute it with the run_workflow tool. If the task is trivial or conversational, just handle it inline as usual. Either way, proceed without asking which mode to use.",
		"",
		WORKFLOW_SCRIPT_API_REFERENCE,
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
		if (
			typeof state !== "object" ||
			state === null ||
			state.id !== runId ||
			typeof state.workflowName !== "string" ||
			!Array.isArray(state.agents) ||
			typeof state.scriptContent !== "string"
		) {
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

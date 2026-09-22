/**
 * Built-in workflow extension: the `run_workflow` tool and the `/workflows`
 * command.
 *
 * run_workflow resolves a saved workflow SOP (project dir wins over user),
 * statically pre-checks its schemas, and executes it on the declarative
 * runner — each step's agents are in-process background subagents whose
 * outputs are validated against the step's JSON Schema (with retries). The
 * launch flows through the session's normal permission evaluation, so
 * permission modes / allow rules / desktop approval cards apply unchanged.
 *
 * Run state persists under the session directory (workflows/<runId>.json),
 * which is what `/workflows` lists; a `resume` parameter replays a stopped,
 * failed, or completed run from that state (completed steps with unchanged
 * fingerprints return their saved results, everything after a changed step
 * reruns). Active runs can be stopped from `/workflows` — a per-run
 * AbortController plus killing the run's live agents.
 *
 * The extension also owns the authoring trigger: when the session's typed
 * prompt contains the trigger keyword (settings-gated), the input is
 * transformed so the model authors + runs a workflow for the task instead of
 * working turn by turn.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { join } from "path";
import { Type } from "typebox";
import type { ExtensionContext, ExtensionFactory } from "../extensions/types.ts";
import { findWorkflow, loadWorkflows } from "./loader.ts";
import { type WorkflowAgentInvoker, WorkflowRunner } from "./runner.ts";
import {
	buildWorkflowAuthoringPrompt,
	listRunIds,
	loadRunState,
	matchesWorkflowTrigger,
	readRunState,
	stripWorkflowTrigger,
} from "./runs.ts";
import { extractJson, findSchemaContradictions, validateAgainstSchema } from "./structured-output.ts";
import {
	WORKFLOW_MAX_AGENTS,
	WORKFLOW_STRUCTURED_OUTPUT_RETRIES,
	WORKFLOW_WARN_AGENTS,
	type WorkflowRunState,
} from "./types.ts";

export interface WorkflowExtensionOptions {
	/** Max agents running at once (from user settings). */
	getMaxConcurrent: () => number;
	/** Agent config dir (user workflows live under <agentDir>/workflows). */
	getAgentDir: () => string;
	/** Whether the authoring trigger keyword is enabled (settings-gated). */
	getKeywordTrigger: () => boolean;
}

const RUN_WORKFLOW_SCHEMA = Type.Object({
	workflow: Type.String({
		description:
			"Saved workflow name (from .a-coder-cli/workflows/ or ~/.a-coder/cli/agent/workflows/) or an absolute .sop.md path. Run /workflows to list saved workflows and runs.",
	}),
	args: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Invocation input for the workflow's args template references.",
		}),
	),
	resume: Type.Optional(
		Type.String({
			description:
				"Run id to resume (from /workflows) instead of starting fresh. Completed steps whose inputs are unchanged return their saved results; steps after a changed input rerun.",
		}),
	),
});

const RUN_GLYPHS: Record<WorkflowRunState["status"], string> = {
	running: "▶",
	completed: "●",
	failed: "✗",
	stopped: "■",
};

export function createWorkflowExtensionFactory(options: WorkflowExtensionOptions): ExtensionFactory {
	// Per-run abort controllers: the stop path for /workflows, and the merge
	// point for the session's own abort signal (either aborts the runner).
	const activeControllers = new Map<string, AbortController>();

	return async (pi) => {
		pi.registerTool({
			name: "run_workflow",
			label: "Run workflow",
			description:
				"Execute a saved declarative workflow: a .sop.md file whose frontmatter declares ordered steps (run / fan-out over a previous step's array, optional loop-until with structured outputs). Runs many background subagents; intermediate data stays inside the run, the final report returns to you. Use for work larger than one context window (codebase audits, batch migrations, cross-checked research). Launching requires the user's permission; agents inherit this session's permission rules. Monitor with /workflows; pass resume to continue an earlier run.",
			promptSnippet: "Execute a saved multi-agent workflow",
			parameters: RUN_WORKFLOW_SCHEMA,
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				const { workflow } = findWorkflow(params.workflow, {
					cwd: ctx.cwd,
					agentDir: options.getAgentDir(),
				});
				if (!workflow) {
					const saved = loadWorkflows({ cwd: ctx.cwd, agentDir: options.getAgentDir() })
						.workflows.map((w) => w.name)
						.join(", ");
					return {
						content: [
							{
								type: "text",
								text: `Workflow "${params.workflow}" not found. Saved workflows: ${saved || "(none)"}.`,
							},
						],
						details: null,
					};
				}

				// Static schema pre-check: provable contradictions fail before any
				// agent spawns (mirrors upstream's schema check).
				const contradictions = workflow.steps.flatMap((step) =>
					step.schema ? findSchemaContradictions(step.schema).map((c) => `step "${step.id}": ${c}`) : [],
				);
				if (contradictions.length > 0) {
					return {
						content: [{ type: "text", text: `Workflow schema errors:\n${contradictions.join("\n")}` }],
						details: null,
					};
				}

				if (workflow.steps.length > WORKFLOW_WARN_AGENTS) {
					onUpdate?.(
						textResult(
							`Large workflow: ${workflow.steps.length} steps projected (cap ${WORKFLOW_MAX_AGENTS} agents) — confirm the scale is intended.`,
						),
					);
				}

				const sessionDir = ctx.sessionManager.getSessionDir();
				const stateDir = sessionDir ? join(sessionDir, "workflows") : undefined;

				// Resume: load the persisted state; refuse while its agents run.
				let resumeState: WorkflowRunState | undefined;
				if (params.resume !== undefined) {
					if (!stateDir) {
						return {
							content: [{ type: "text", text: "Cannot resume: this session has no state directory." }],
							details: null,
						};
					}
					const loaded = loadRunState(stateDir, params.resume);
					if ("error" in loaded) {
						const available = listRunIds(stateDir).join(", ") || "(none)";
						return {
							content: [{ type: "text", text: `${loaded.error}. Runs in this session: ${available}.` }],
							details: null,
						};
					}
					const stillRunning = ctx
						.listSubAgents()
						.filter((a) => a.id.startsWith(`${loaded.state.id}-`) && a.status === "running");
					if (stillRunning.length > 0) {
						return {
							content: [
								{
									type: "text",
									text: `Refusing to resume "${params.resume}": ${stillRunning.length} of its agents are still running. Stop them first (/workflows) or wait for them to exit.`,
								},
							],
							details: null,
						};
					}
					resumeState = loaded.state;
				}

				// The run id is stable across resumes so state continues in the
				// same file; fresh runs take a fresh id.
				const runId = resumeState?.id ?? `${workflow.name}-${Date.now()}`;

				const controller = new AbortController();
				const forwardAbort = () => controller.abort();
				signal?.addEventListener("abort", forwardAbort, { once: true });
				activeControllers.set(runId, controller);

				// Live progress block: per-step state rendered below the editor in the
				// TUI and mirrored by the desktop's extension-widget surface. Cleared
				// when the run ends (the result itself returns inline).
				const widgetKey = `workflow-${runId}`;
				const stepStates = new Map<string, "running" | "done">(
					resumeState ? Object.keys(resumeState.steps).map((id) => [id, "done" as const]) : [],
				);
				let agentsSpawned = resumeState?.agentCount ?? 0;
				const renderWidget = () => {
					const lines = [`▶ ${workflow.name} — running  ${agentsSpawned} agent(s)`];
					for (const step of workflow.steps) {
						const state = stepStates.get(step.id);
						const mark = state === "done" ? "●" : state === "running" ? "▶" : "○";
						lines.push(`  ${mark} ${step.id}${step.type === "fan-out" ? " (fan-out)" : ""}`);
					}
					ctx.ui.setWidget(widgetKey, lines, { placement: "belowEditor" });
				};

				const runner = new WorkflowRunner(
					workflow,
					{
						invoker: makeInvoker(ctx),
						maxConcurrent: options.getMaxConcurrent(),
						onEvent: (event) => {
							const push = (text: string) => onUpdate?.(textResult(text));
							if (event.type === "step_start") {
								push(`▶ ${event.stepId}: ${event.label} (×${event.agents} agents)`);
								ctx.ui.setStatus("workflows", `▶ ${workflow.name}: ${event.stepId} (×${event.agents} agents)`);
								stepStates.set(event.stepId, "running");
								agentsSpawned += event.agents;
								renderWidget();
							}
							if (event.type === "log") push(event.message);
							if (event.type === "step_end") {
								stepStates.set(event.stepId, "done");
								renderWidget();
							}
							if (event.type === "run_end") {
								push(`run ${event.status} after ${event.agents} agents`);
								ctx.ui.setStatus("workflows", undefined);
							}
						},
						signal: controller.signal,
						...(stateDir !== undefined ? { stateDir } : {}),
					},
					runId,
					resumeState,
				);

				try {
					const state = await runner.run(params.args);
					return { content: [{ type: "text", text: renderRunResult(state) }], details: state };
				} finally {
					activeControllers.delete(runId);
					signal?.removeEventListener("abort", forwardAbort);
					ctx.ui.setStatus("workflows", undefined);
					ctx.ui.setWidget(widgetKey, undefined);
				}
			},
		});

		pi.registerCommand("workflows", {
			description: "List saved workflows and workflow runs; drill into a run, stop running ones",
			handler: async (_args, ctx) => {
				const sessionDir = ctx.sessionManager.getSessionDir();
				const stateDir = sessionDir ? join(sessionDir, "workflows") : undefined;
				const runIds = listRunIds(stateDir);
				const saved = loadWorkflows({ cwd: ctx.cwd, agentDir: options.getAgentDir() })
					.workflows.map((w) => w.name)
					.join(", ");
				const savedNote = saved
					? `Saved workflows: ${saved}.`
					: "No saved workflows (.a-coder-cli/workflows/*.sop.md).";

				if (runIds.length === 0) {
					ctx.ui.notify(`No workflow runs in this session yet. ${savedNote}`, "info");
					return;
				}

				const lines = runIds.map((id) => {
					const state = stateDir ? readRunState(stateDir, id) : undefined;
					const status = state?.status ?? "(unreadable)";
					return `${RUN_GLYPHS[state?.status ?? "stopped"] ?? "•"} ${status.padEnd(9)}  ${state?.workflowName ?? "?"}  (${id})  agents ${state?.agentCount ?? "?"}`;
				});

				if (!ctx.hasUI) {
					ctx.ui.notify(`Workflow runs (newest first):\n${lines.join("\n")}\n\n${savedNote}`, "info");
					return;
				}

				// Drill-down: pick a run, see its steps + live agents, optionally stop.
				const byLine = new Map(lines.map((line, i) => [line, runIds[i] as string]));
				let pick: string | undefined;
				try {
					pick = await ctx.ui.select("Workflow runs (newest first)", lines);
				} catch {
					pick = undefined;
				}
				const runId = pick !== undefined ? byLine.get(pick) : undefined;
				if (pick === undefined || runId === undefined) {
					ctx.ui.notify(savedNote, "info");
					return;
				}

				const state = stateDir ? readRunState(stateDir, runId) : undefined;
				if (!state) {
					ctx.ui.notify(`Run state "${runId}" is unreadable.`, "warning");
					return;
				}

				ctx.ui.notify(renderRunDetail(state, ctx), "info");

				const running = ctx.listSubAgents().filter((a) => a.id.startsWith(`${runId}-`) && a.status === "running");
				if (running.length === 0) return;

				const stop = await ctx.ui.confirm(
					`Stop "${state.workflowName}"?`,
					`${running.length} agent(s) still running. Stopping marks the run stopped; completed steps keep their results and can be resumed.`,
				);
				if (!stop) return;
				controllerAbort(activeControllers, runId);
				for (const agent of running) ctx.killSubAgent(agent.id, "workflow stopped by user");
				ctx.ui.notify(
					`Stop requested for "${state.workflowName}" — resume later with run_workflow { workflow: "${state.workflowName}", resume: "${runId}" }.`,
					"info",
				);
			},
		});

		// Authoring trigger: an opt-in keyword in a typed prompt turns the task
		// into workflow authoring. Guarded to human-driven sources (interactive
		// and RPC clients); never fires for programmatic (extension) input.
		pi.on("input", (event) => {
			if (!options.getKeywordTrigger()) return { action: "continue" };
			if (event.source === "extension") return { action: "continue" };
			if (!matchesWorkflowTrigger(event.text)) return { action: "continue" };
			const task = stripWorkflowTrigger(event.text);
			if (!task) return { action: "continue" };
			return { action: "transform", text: buildWorkflowAuthoringPrompt(task) };
		});
	};
}

function textResult(text: string): AgentToolResult<null> {
	return { content: [{ type: "text", text }], details: null };
}

/** Abort a run's controller if still active (no-op after natural completion). */
function controllerAbort(activeControllers: Map<string, AbortController>, runId: string): void {
	activeControllers.get(runId)?.abort();
	activeControllers.delete(runId);
}

function renderRunDetail(state: WorkflowRunState, ctx: ExtensionContext): string {
	const lines = [
		`${RUN_GLYPHS[state.status]} ${state.workflowName} — ${state.status} (run ${state.id})`,
		`agents spawned: ${state.agentCount}${state.error ? `  error: ${state.error}` : ""}`,
	];
	const steps = Object.values(state.steps);
	if (steps.length > 0) {
		lines.push("", "steps:");
		for (const step of steps) {
			const last = step.outputs.at(-1);
			const failed = step.error !== undefined || step.outputs.every((o) => o === null);
			const mark = failed ? "✗" : "●";
			lines.push(`  ${mark} ${step.stepId}: ${step.rounds} round(s)${step.error ? ` — ${step.error}` : ""}`);
			if (Array.isArray(last)) {
				lines.push(`      ${last.length} item(s), ${last.filter((o) => o === null).length} failed`);
			}
		}
	}
	const running = ctx.listSubAgents().filter((a) => a.id.startsWith(`${state.id}-`) && a.status === "running");
	if (running.length > 0) {
		lines.push("", "live agents:");
		for (const agent of running) {
			lines.push(
				`  ▶ ${agent.id}  (${agent.agentType}, ${agent.toolUseCount} tools, last: ${agent.lastToolName ?? "—"})`,
			);
		}
	}
	return lines.join("\n");
}

function makeInvoker(ctx: ExtensionContext): WorkflowAgentInvoker {
	return async (request) => {
		let attempt = 0;
		let prompt = request.prompt;

		while (attempt <= WORKFLOW_STRUCTURED_OUTPUT_RETRIES) {
			const id = attempt === 0 ? request.id : `${request.id}-v${attempt}`;
			ctx.runSubAgentBackground({
				id,
				agentType: request.agentType ?? "general-purpose",
				prompt,
				notifyOnComplete: false,
				detached: false,
				...(request.model ? { model: ctx.modelRegistry.getAvailable().find((m) => m.id === request.model) } : {}),
			});
			const record = await ctx.waitSubAgent(id);
			if (!record) return { ok: false, error: "agent did not finish (missing record)" };
			if (record.status !== "completed") {
				return { ok: false, error: record.error ?? `agent ${record.status}` };
			}

			const finalText = record.finalText ?? "";
			if (!request.schema) return { ok: true, output: finalText };

			const parsed = extractJson(finalText);
			if (parsed !== undefined) {
				const issues = validateAgainstSchema(parsed, request.schema);
				if (issues.length === 0) return { ok: true, output: parsed };
				prompt = `${request.prompt}\n\nYour previous response failed schema validation: ${issues.length} issue(s) — ${issues
					.map((i) => `${i.path || "(root)"}: ${i.message}`)
					.join("; ")}. Return ONLY a JSON value matching the schema, no prose.`;
			} else {
				prompt = `${request.prompt}\n\nYour previous response could not be parsed as JSON. Return ONLY a JSON value matching the schema, with no surrounding prose.`;
			}
			attempt++;
		}
		return {
			ok: false,
			error: `structured output failed validation after ${WORKFLOW_STRUCTURED_OUTPUT_RETRIES} retries`,
		};
	};
}

function renderRunResult(state: WorkflowRunState): string {
	const lines = [
		`Workflow "${state.workflowName}" ${state.status} (run ${state.id}).`,
		`Agents spawned: ${state.agentCount}.`,
	];
	if (state.error) lines.push(`Error: ${state.error}`);
	const steps = Object.values(state.steps);
	if (steps.length > 0) {
		const last = steps.at(-1)!;
		const output = last.outputs.at(-1);
		if (typeof output === "string") {
			lines.push("", output);
		} else if (output !== undefined) {
			lines.push("", "```json", JSON.stringify(output, null, 2), "```");
		}
	}
	return lines.join("\n");
}

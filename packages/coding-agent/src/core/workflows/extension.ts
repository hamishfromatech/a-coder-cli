/**
 * Built-in workflow extension: the `run_workflow` tool, the `/<name>` commands
 * for saved workflow scripts, and the `/workflows` view.
 *
 * run_workflow resolves a saved workflow script (project dir wins over user),
 * statically pre-checks it, and executes it on the script runtime — each
 * agent() call spawns an in-process background subagent whose output is
 * validated against the call's JSON Schema (with retries). The launch flows
 * through the session's normal permission evaluation, so permission modes /
 * allow rules / desktop approval cards apply unchanged.
 *
 * Saved workflows (`.a-coder-cli/workflows/*.js`, personal dir) register as
 * `/<name>` commands that execute the runtime directly; the args string is
 * passed to the script as the `args` global. Scripts saved after session
 * start register on the next reload.
 *
 * Run state persists under the session directory (workflows/<runId>.json),
 * which is what `/workflows` lists; a `resume` parameter replays a stopped,
 * failed, or completed run from its start-ordered agent log (completed agents
 * with unchanged prompts return their saved results, everything from the
 * first changed agent onward reruns). Active runs can be stopped, paused, and
 * resumed from `/workflows`, and a run's script can be saved as a command.
 *
 * The extension also owns the authoring trigger: when the session's typed
 * prompt contains the trigger keyword (settings-gated), the input is
 * transformed so the model authors + runs a workflow for the task instead of
 * working turn by turn.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Type } from "typebox";
import type { ExtensionContext, ExtensionFactory } from "../extensions/types.ts";
import { findWorkflow, loadWorkflows } from "./loader.ts";
import {
	clearWorkflowHandlers,
	pauseWorkflowRun,
	registerWorkflowPauseHandler,
	registerWorkflowStopHandler,
	stopWorkflowRun,
	updateWorkflowRun,
} from "./registry.ts";
import {
	buildAutoOrchestrationPrompt,
	buildWorkflowAuthoringPrompt,
	listRunIds,
	loadRunState,
	matchesWorkflowTrigger,
	readRunState,
	stripWorkflowTrigger,
} from "./runs.ts";
import { staticScriptViolations, WorkflowRuntime } from "./runtime.ts";
import { extractJson, validateAgainstSchema } from "./structured-output.ts";
import {
	WORKFLOW_AGENT_RESTART_REASON,
	WORKFLOW_STRUCTURED_OUTPUT_RETRIES,
	WORKFLOW_WARN_AGENTS,
	type WorkflowAgentInvoker,
	type WorkflowRunState,
} from "./types.ts";

/** Loader options shared by every loadWorkflows/findWorkflow call site. */
function loaderOptions(options: WorkflowExtensionOptions): {
	cwd: string;
	agentDir: string;
	extraFiles: string[];
} {
	return {
		cwd: options.getCwd(),
		agentDir: options.getAgentDir(),
		extraFiles: options.getPackageWorkflowPaths(),
	};
}

export interface WorkflowExtensionOptions {
	/** Max agents running at once (from user settings). */
	getMaxConcurrent: () => number;
	/** Fan-out prompt-cache stagger hold (from user settings; 0 disables). */
	getStaggerMs: () => number;
	/** Agent config dir (user workflows live under <agentDir>/workflows). */
	getAgentDir: () => string;
	/** Whether the authoring trigger keyword is enabled (settings-gated). */
	getKeywordTrigger: () => boolean;
	/** Current working directory (project workflows live under <cwd>/.a-coder-cli/workflows). */
	getCwd: () => string;
	/** Workflow scripts resolved from packages/settings (lowest precedence). */
	getPackageWorkflowPaths: () => string[];
}

const RUN_WORKFLOW_SCHEMA = Type.Object({
	workflow: Type.String({
		description:
			"Saved workflow name (from .a-coder-cli/workflows/ or ~/.a-coder/cli/agent/workflows/) or an absolute .js script path. Run /workflows to list saved workflows and runs.",
	}),
	args: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Invocation input for the workflow's args global.",
		}),
	),
	resume: Type.Optional(
		Type.String({
			description:
				"Run id to resume (from /workflows) instead of starting fresh. Completed agents whose prompts are unchanged return their saved results; agents from the first changed prompt onward rerun.",
		}),
	),
});

const RUN_GLYPHS: Record<WorkflowRunState["status"], string> = {
	running: "▶",
	paused: "⏸",
	completed: "●",
	failed: "✗",
	stopped: "■",
};

/** Fixed command names of this extension that saved workflows must not shadow. */
const RESERVED_COMMANDS = new Set(["workflows", "ultracode"]);

export function createWorkflowExtensionFactory(options: WorkflowExtensionOptions): ExtensionFactory {
	// Per-run abort controllers: the stop path for /workflows, and the merge
	// point for the session's own abort signal (either aborts the runner).
	const activeControllers = new Map<string, AbortController>();
	const activeRuntimes = new Map<string, WorkflowRuntime>();

	return async (pi) => {
		// ------------------------------------------------------------------
		// Saved workflow scripts as /<name> commands.
		// ------------------------------------------------------------------
		for (const spec of loadWorkflows(loaderOptions(options)).workflows) {
			if (RESERVED_COMMANDS.has(spec.name)) continue;
			pi.registerCommand(spec.name, {
				description: spec.description || `Run the "${spec.name}" workflow`,
				handler: async (args, ctx) => {
					const input = args.trim();
					const state = await executeWorkflowRun(ctx, options, activeControllers, activeRuntimes, {
						spec,
						args: input.length > 0 ? input : undefined,
					});
					ctx.ui.notify(renderRunResult(state), state.status === "completed" ? "info" : "warning");
				},
			});
		}

		// ------------------------------------------------------------------
		// run_workflow tool.
		// ------------------------------------------------------------------
		pi.registerTool({
			name: "run_workflow",
			label: "Run workflow",
			description:
				"Execute a saved workflow script: a .js file (meta block + top-level-await body) that orchestrates background subagents through agent()/pipeline()/parallel(), with JSON-Schema structured outputs, loop-until patterns written in plain JavaScript, and per-agent resume. Runs many background subagents; intermediate data stays inside the run, the final report returns to you. Use for work larger than one context window (codebase audits, batch migrations, cross-checked research). Launching requires the user's permission; agents inherit this session's permission rules. Monitor with /workflows; pass resume to continue an earlier run.",
			promptSnippet: "Execute a saved multi-agent workflow",
			parameters: RUN_WORKFLOW_SCHEMA,
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				const { workflow: spec } = findWorkflow(params.workflow, loaderOptions(options));
				if (!spec) {
					const saved = loadWorkflows(loaderOptions(options))
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

				const violations = staticScriptViolations(spec.content);
				if (violations.length > 0) {
					return {
						content: [
							{ type: "text", text: `Workflow script errors in "${spec.name}":\n${violations.join("\n")}` },
						],
						details: null,
					};
				}

				const state = await executeWorkflowRun(ctx, options, activeControllers, activeRuntimes, {
					spec,
					args: params.args,
					resume: params.resume,
					signal,
					onUpdate,
				});
				return { content: [{ type: "text", text: renderRunResult(state) }], details: state };
			},
		});

		// ------------------------------------------------------------------
		// /workflows view.
		// ------------------------------------------------------------------
		pi.registerCommand("workflows", {
			description:
				"List saved workflows and workflow runs; drill into a run, stop/pause running ones, save a run's script as a command",
			handler: async (_args, ctx) => {
				const stateDir = workflowStateDir(ctx);
				const runIds = listRunIds(stateDir);
				const saved = loadWorkflows(loaderOptions(options)).workflows;
				const savedNote =
					saved.length > 0
						? `Saved workflows: ${saved.map((w) => w.name).join(", ")} (also run with /${saved.map((w) => w.name).join(" /")}).`
						: "No saved workflows (.a-coder-cli/workflows/*.js).";

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

				// Drill-down: pick a run, inspect it, act on it.
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

				await runDetailView(ctx, options, activeControllers, runId, state);
			},
		});

		// Authoring triggers, guarded to human-driven sources (interactive and
		// RPC clients); never fire for programmatic (extension) input:
		// - the "ultracode" keyword (settings-gated) forces workflow authoring
		// - /ultracode toggles session-scoped auto-orchestration: every typed
		//   prompt carries guidance to prefer workflows for substantive tasks
		//   (the model judges; trivial tasks stay inline)
		let autoOrchestrate = false;

		pi.registerCommand("ultracode", {
			description:
				"Toggle auto-orchestration: substantive prompts are planned as dynamic workflows (session-scoped)",
			handler: async (_args, ctx) => {
				autoOrchestrate = !autoOrchestrate;
				ctx.ui.notify(
					autoOrchestrate
						? "Auto-orchestration ON — substantive prompts are planned as dynamic workflows; trivial tasks stay inline. Runs until you toggle it off or the session reloads."
						: "Auto-orchestration OFF — prompts are handled turn by turn again.",
					"info",
				);
			},
		});

		pi.on("input", (event) => {
			if (event.source === "extension") return { action: "continue" };
			if (options.getKeywordTrigger() && matchesWorkflowTrigger(event.text)) {
				const task = stripWorkflowTrigger(event.text);
				if (!task) return { action: "continue" };
				return { action: "transform", text: buildWorkflowAuthoringPrompt(task) };
			}
			if (autoOrchestrate) {
				const task = event.text.trim();
				if (!task) return { action: "continue" };
				return { action: "transform", text: buildAutoOrchestrationPrompt(task) };
			}
			return { action: "continue" };
		});
	};
}

// ---------------------------------------------------------------------------
// Run execution (shared by the tool and saved-workflow commands)
// ---------------------------------------------------------------------------

interface ExecuteRunParams {
	spec: { name: string; content: string; filePath?: string };
	args: unknown;
	resume?: string;
	signal?: AbortSignal;
	onUpdate?: (result: AgentToolResult<null>) => void;
}

async function executeWorkflowRun(
	ctx: ExtensionContext,
	options: WorkflowExtensionOptions,
	activeControllers: Map<string, AbortController>,
	activeRuntimes: Map<string, WorkflowRuntime>,
	params: ExecuteRunParams,
): Promise<WorkflowRunState> {
	const stateDir = workflowStateDir(ctx);

	// Resume: load the persisted state; refuse while its agents run.
	let resumeState: WorkflowRunState | undefined;
	if (params.resume !== undefined) {
		if (!stateDir) {
			return rejectedRun(params, "Cannot resume: this session has no state directory.");
		}
		const loaded = loadRunState(stateDir, params.resume);
		if ("error" in loaded) {
			const available = listRunIds(stateDir).join(", ") || "(none)";
			return rejectedRun(params, `${loaded.error}. Runs in this session: ${available}.`);
		}
		const stillRunning = ctx
			.listSubAgents()
			.filter((a) => a.id.startsWith(`${loaded.state.id}-a`) && a.status === "running");
		if (stillRunning.length > 0) {
			return rejectedRun(
				params,
				`Refusing to resume "${params.resume}": ${stillRunning.length} of its agents are still running. Stop them first (/workflows) or wait for them to exit.`,
			);
		}
		resumeState = loaded.state;
	}

	// The run id is stable across resumes so state continues in the same
	// file; fresh runs take a fresh id.
	const runId = resumeState?.id ?? `${params.spec.name}-${Date.now()}`;

	const controller = new AbortController();
	const forwardAbort = () => controller.abort();
	params.signal?.addEventListener("abort", forwardAbort, { once: true });
	activeControllers.set(runId, controller);

	const stopRun = (): void => {
		controller.abort();
		activeControllers.delete(runId);
		for (const agent of ctx.listSubAgents()) {
			if (agent.id.startsWith(`${runId}-a`) && agent.status === "running") {
				ctx.killSubAgent(agent.id, "workflow stopped by user");
			}
		}
	};
	registerWorkflowStopHandler(runId, stopRun);
	registerWorkflowPauseHandler(runId, (value) => activeRuntimes.get(runId)?.setPaused(value));

	// Live progress block: per-phase state rendered below the editor in the
	// TUI and mirrored by the desktop's extension-widget surface. Cleared when
	// the run ends (the result itself returns inline).
	const widgetKey = `workflow-${runId}`;
	const agentCounts = new Map<string, number>(resumeState ? countPhaseAgents(resumeState) : []);
	const phaseList = resumeState ? [...resumeState.phases] : [];
	let agentsSpawned = resumeState?.agentCount ?? 0;
	let runtimeRef: WorkflowRuntime | undefined;
	const renderWidget = () => {
		const status = runtimeRef?.state.status ?? "running";
		const glyph = status === "paused" ? "⏸" : "▶";
		const lines = [`${glyph} ${params.spec.name} — ${status}  ${agentsSpawned} agent(s)`];
		for (const phase of phaseList) {
			lines.push(`  ● ${phase} (${agentCounts.get(phase) ?? 0})`);
		}
		ctx.ui.setWidget(widgetKey, lines, { placement: "belowEditor" });
	};
	if (ctx.hasUI) renderWidget();

	const persist = stateDir
		? (state: WorkflowRunState) => {
				try {
					mkdirSync(stateDir, { recursive: true });
					state.updatedAt = Date.now();
					writeFileSync(join(stateDir, `${state.id}.json`), JSON.stringify(state, null, "\t"), "utf-8");
				} catch {
					// State persistence is best-effort; the run continues in memory.
				}
			}
		: undefined;

	const runtime = new WorkflowRuntime(
		params.spec,
		{
			invoker: makeInvoker(ctx, {
				getRuntime: () => runtimeRef,
				notify: (text) => params.onUpdate?.(textResult(text)),
				update: () => {
					if (runtimeRef) updateWorkflowRun(runtimeRef.state);
					if (ctx.hasUI) renderWidget();
				},
			}),
			maxConcurrent: options.getMaxConcurrent(),
			staggerMs: options.getStaggerMs(),
			onEvent: (event) => {
				const push = (text: string) => params.onUpdate?.(textResult(text));
				if (event.type === "agent_start") {
					agentsSpawned = runtime.state.agentCount;
					push(`▶ agent ${event.seq} [${event.phase}]: ${event.label}`);
					ctx.ui.setStatus("workflows", `▶ ${params.spec.name}: ${event.label} (agent ${event.seq + 1})`);
					agentCounts.set(event.phase, (agentCounts.get(event.phase) ?? 0) + 1);
					if (!phaseList.includes(event.phase)) phaseList.push(event.phase);
					if (agentsSpawned === WORKFLOW_WARN_AGENTS) {
						push(
							`Large workflow: ${agentsSpawned} agents so far — check /workflows to stop the run if the scale is unintended.`,
						);
					}
					renderWidget();
				}
				if (event.type === "phase") {
					push(`◆ phase: ${event.phase}`);
					renderWidget();
				}
				if (event.type === "log") push(event.message);
				if (event.type === "agent_end") {
					renderWidget();
				}
				if (event.type === "run_end") {
					push(`run ${event.status} after ${event.agents} agents`);
					ctx.ui.setStatus("workflows", undefined);
				}
				// Live summary for registry subscribers (desktop RPC stream).
				updateWorkflowRun(runtime.state);
			},
			signal: controller.signal,
			...(persist ? { persist } : {}),
		},
		runId,
		resumeState,
	);
	runtimeRef = runtime;
	activeRuntimes.set(runId, runtime);
	updateWorkflowRun(runtime.state);

	try {
		return await runtime.run(params.args);
	} finally {
		activeControllers.delete(runId);
		activeRuntimes.delete(runId);
		params.signal?.removeEventListener("abort", forwardAbort);
		clearWorkflowHandlers(runId);
		updateWorkflowRun(runtime.state);
		ctx.ui.setStatus("workflows", undefined);
		ctx.ui.setWidget(widgetKey, undefined);
	}
}

/** Build a rejected run result for the tool (no agents spawned). */
function rejectedRun(params: ExecuteRunParams, message: string): WorkflowRunState {
	params.onUpdate?.(textResult(message));
	return {
		id: "rejected",
		workflowName: params.spec.name,
		status: "failed",
		startedAt: Date.now(),
		updatedAt: Date.now(),
		agentCount: 0,
		phases: [],
		steps: {},
		agents: [],
		scriptContent: params.spec.content,
		error: message,
	};
}

// ---------------------------------------------------------------------------
// /workflows drill-down
// ---------------------------------------------------------------------------

async function runDetailView(
	ctx: ExtensionContext,
	options: WorkflowExtensionOptions,
	activeControllers: Map<string, AbortController>,
	runId: string,
	state: WorkflowRunState,
): Promise<void> {
	ctx.ui.notify(renderRunDetail(state, ctx), "info");

	const running = ctx.listSubAgents().filter((a) => a.id.startsWith(`${runId}-a`) && a.status === "running");
	const isLive = activeControllers.has(runId);
	const statusLine = isLive
		? running.length > 0
			? `${running.length} agent(s) still running.`
			: "run is active."
		: running.length > 0
			? `${running.length} agent(s) still running (run not attached to this view).`
			: undefined;

	const actions: string[] = [];
	if (isLive) {
		actions.push("Stop run", state.status === "paused" ? "Resume run" : "Pause run");
		if (running.length > 0) actions.push("Restart an agent", "Stop one agent");
	}
	if (state.scriptContent) actions.push("Save script as command");

	if (actions.length === 0) {
		if (statusLine) ctx.ui.notify(statusLine, "info");
		return;
	}
	if (statusLine) ctx.ui.notify(statusLine, "info");

	let action: string | undefined;
	try {
		action = await ctx.ui.select(`Actions — ${state.workflowName} (${runId})`, actions);
	} catch {
		return;
	}

	if (action === "Stop run") {
		stopWorkflowRun(runId);
		ctx.ui.notify(
			`Stop requested for "${state.workflowName}" — resume later with run_workflow { workflow: "${state.workflowName}", resume: "${runId}" }.`,
			"info",
		);
		return;
	}
	if (action === "Pause run" || action === "Resume run") {
		const value = action === "Pause run";
		pauseWorkflowRun(runId, value);
		ctx.ui.notify(
			value
				? `Pause requested for "${state.workflowName}" — new agents hold until you resume (/workflows).`
				: `Resume requested for "${state.workflowName}".`,
			"info",
		);
		return;
	}
	if (action === "Restart an agent") {
		const agent = await pickRunningAgent(ctx, running, "Restart which agent?");
		if (!agent) return;
		ctx.killSubAgent(agent.id, WORKFLOW_AGENT_RESTART_REASON);
		ctx.ui.notify(
			`Restart requested for agent ${agent.id} — it reruns the same request when its slot frees up.`,
			"info",
		);
		return;
	}
	if (action === "Stop one agent") {
		await stopOneAgent(ctx, running);
		return;
	}
	if (action === "Save script as command") {
		await saveScriptAsCommand(ctx, options, state);
	}
}

/** Show the live agents of a run and return the picked record. */
async function pickRunningAgent(
	ctx: ExtensionContext,
	running: ReturnType<ExtensionContext["listSubAgents"]>,
	title: string,
): Promise<ReturnType<ExtensionContext["listSubAgents"]>[number] | undefined> {
	const lines = running.map(
		(a) => `${a.id}  (${a.agentType}, ${a.toolUseCount} tools, last: ${a.lastToolName ?? "—"})`,
	);
	let pick: string | undefined;
	try {
		pick = await ctx.ui.select(title, lines);
	} catch {
		return undefined;
	}
	const index = pick !== undefined ? lines.indexOf(pick) : -1;
	return index === -1 ? undefined : running[index];
}

async function stopOneAgent(
	ctx: ExtensionContext,
	running: ReturnType<ExtensionContext["listSubAgents"]>,
): Promise<void> {
	const agent = await pickRunningAgent(ctx, running, "Stop which agent?");
	if (!agent) return;
	ctx.killSubAgent(agent.id, "workflow agent stopped by user");
	ctx.ui.notify(`Stop requested for agent ${agent.id} — its agent() call returns null.`, "info");
}

async function saveScriptAsCommand(
	ctx: ExtensionContext,
	options: WorkflowExtensionOptions,
	state: WorkflowRunState,
): Promise<void> {
	const projectPath = join(options.getCwd(), ".a-coder-cli", "workflows", `${state.workflowName}.js`);
	const userPath = join(options.getAgentDir(), "workflows", `${state.workflowName}.js`);
	let pick: string | undefined;
	try {
		pick = await ctx.ui.select(`Save "${state.workflowName}" where?`, [
			`Project — ${projectPath} (shared with the repo)`,
			`Personal — ${userPath} (every project, only you)`,
		]);
	} catch {
		return;
	}
	if (pick === undefined) return;
	const target = pick.startsWith("Project") ? projectPath : userPath;
	try {
		mkdirSync(join(target, ".."), { recursive: true });
		writeFileSync(target, state.scriptContent, "utf-8");
		ctx.ui.notify(
			`Saved to ${target}. It runs as /${state.workflowName} in future sessions (restart or reload to register it).`,
			"info",
		);
	} catch (error) {
		ctx.ui.notify(
			`Failed to save workflow script: ${error instanceof Error ? error.message : String(error)}`,
			"warning",
		);
	}
}

// ---------------------------------------------------------------------------
// Agent invocation (background subagents + structured output)
// ---------------------------------------------------------------------------

/** Heuristic for provider rate-limit / usage-limit failures worth pausing on. */
function looksLikeRateLimit(error: string | undefined): boolean {
	if (!error) return false;
	return /rate.?limit|too many requests|\b429\b|quota|usage limit|capacity/i.test(error);
}

interface InvokerHooks {
	/** Late-bound runtime for pause gating and abort checks (set after construction). */
	getRuntime: () => WorkflowRuntime | undefined;
	/** Push a progress line to the run's output stream. */
	notify: (text: string) => void;
	/** Publish the (possibly paused) run state to the registry. */
	update: () => void;
}

/** Max rate-limit pauses per invocation before the agent fails (upstream's wait-twice rule). */
const MAX_RATE_LIMIT_WAITS = 2;

function makeInvoker(ctx: ExtensionContext, hooks: InvokerHooks): WorkflowAgentInvoker {
	return async (request) => {
		let attempt = 0;
		let spawn = 0;
		let rateLimitWaits = 0;
		let prompt = request.prompt;

		while (attempt <= WORKFLOW_STRUCTURED_OUTPUT_RETRIES) {
			const id = spawn === 0 ? request.id : `${request.id}-v${spawn}`;
			spawn++;
			let beganSignaled = false;
			ctx.runSubAgentBackground({
				id,
				agentType: request.agentType ?? "general-purpose",
				prompt,
				notifyOnComplete: false,
				detached: false,
				...(request.model ? { model: ctx.modelRegistry.getAvailable().find((m) => m.id === request.model) } : {}),
				onProgress: () => {
					// First progress event = the response has begun: release the
					// stagger gate so held fan-out siblings spawn against the
					// now-cached prefix.
					if (!beganSignaled) {
						beganSignaled = true;
						request.onResponseBegin?.();
					}
				},
			});
			const record = await ctx.waitSubAgent(id);
			if (!record) {
				return { ok: false, error: "agent did not finish (missing record)", kind: "agent-failed" } as const;
			}
			if (record.status === "killed" && record.error === WORKFLOW_AGENT_RESTART_REASON) {
				// User-requested restart: rerun the same request (no retry consumed).
				const runtime = hooks.getRuntime();
				if (runtime?.aborted) {
					return { ok: false, error: "workflow aborted", kind: "agent-failed" } as const;
				}
				await runtime?.waitWhilePaused();
				if (runtime?.aborted) {
					return { ok: false, error: "workflow aborted", kind: "agent-failed" } as const;
				}
				continue;
			}
			if (record.status !== "completed") {
				const error = record.error ?? `agent ${record.status}`;
				const runtime = hooks.getRuntime();
				if (runtime && !runtime.aborted && looksLikeRateLimit(error) && rateLimitWaits < MAX_RATE_LIMIT_WAITS) {
					rateLimitWaits++;
					runtime.setPaused(true);
					hooks.update();
					hooks.notify(
						`agent "${request.label}" hit a provider rate limit (${error.trim()}) — run paused; it retries the same request when you resume via /workflows (completed agents are kept).`,
					);
					await runtime.waitWhilePaused();
					if (runtime.aborted) {
						return { ok: false, error: "workflow aborted", kind: "agent-failed" } as const;
					}
					runtime.setPaused(false);
					hooks.update();
					continue;
				}
				return {
					ok: false,
					error,
					kind: "agent-failed",
				} as const;
			}

			const finalText = record.finalText ?? "";
			if (!request.schema) return { ok: true, output: finalText } as const;

			const parsed = extractJson(finalText);
			if (parsed !== undefined) {
				const issues = validateAgainstSchema(parsed, request.schema);
				if (issues.length === 0) return { ok: true, output: parsed } as const;
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
			kind: "invalid-output",
		} as const;
	};
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult<null> {
	return { content: [{ type: "text", text }], details: null };
}

function countPhaseAgents(state: WorkflowRunState): Map<string, number> {
	const counts = new Map<string, number>();
	for (const agent of state.agents) {
		counts.set(agent.phase, (counts.get(agent.phase) ?? 0) + 1);
	}
	return counts;
}

function renderRunDetail(state: WorkflowRunState, ctx: ExtensionContext): string {
	const lines = [
		`${RUN_GLYPHS[state.status]} ${state.workflowName} — ${state.status} (run ${state.id})`,
		`agents spawned: ${state.agentCount}${state.error ? `  error: ${state.error}` : ""}`,
	];
	const phases = state.phases.length > 0 ? state.phases : Object.keys(state.steps);
	if (state.agents.length > 0) {
		lines.push("", "agents (start order):");
		for (const agent of state.agents) {
			const mark = agent.status === "completed" ? "●" : agent.status === "running" ? "▶" : "✗";
			const tokens = agent.tokens !== undefined ? `  ${agent.tokens} tok` : "";
			lines.push(
				`  ${mark} [${agent.phase}] #${agent.seq} ${agent.label} — ${agent.status}${tokens}${agent.error ? ` — ${agent.error}` : ""}`,
			);
		}
	} else if (phases.length > 0) {
		lines.push("", `phases: ${phases.join(", ")}`);
	}
	const running = ctx.listSubAgents().filter((a) => a.id.startsWith(`${state.id}-a`) && a.status === "running");
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

function renderRunResult(state: WorkflowRunState): string {
	const lines = [
		`Workflow "${state.workflowName}" ${state.status} (run ${state.id}).`,
		`Agents spawned: ${state.agentCount}.`,
	];
	if (state.error) lines.push(`Error: ${state.error}`);
	const output = state.returnValue;
	if (typeof output === "string") {
		lines.push("", output);
	} else if (output !== undefined) {
		lines.push("", "```json", JSON.stringify(output, null, 2), "```");
	}
	return lines.join("\n");
}

function workflowStateDir(ctx: ExtensionContext): string | undefined {
	const sessionDir = ctx.sessionManager.getSessionDir();
	return sessionDir ? join(sessionDir, "workflows") : undefined;
}

/**
 * Declarative workflow runner.
 *
 * Executes a WorkflowSpec step by step over an injected agent-invoker (wired
 * to the background subagent machinery by the run_workflow tool). The runner
 * owns sequencing, fan-out concurrency, loop budgets, and run-state
 * persistence; it contains no agent logic — every transformation is an agent
 * step.
 *
 * Resume semantics mirror upstream's: persisted step results are reused as
 * long as the step's fingerprint (template rendered against the current data
 * + fan-out size) is unchanged; a change reruns that step and every step
 * after it.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { checkPredicate, interpolate, resolvePath } from "./data-flow.ts";
import {
	WORKFLOW_MAX_AGENTS,
	WORKFLOW_MAX_RUN_MS,
	type WorkflowRunState,
	type WorkflowSpec,
	type WorkflowStep,
} from "./types.ts";

/** One agent execution request. The host wires this to real subagents. */
export type WorkflowAgentInvoker = (request: {
	id: string;
	prompt: string;
	label: string;
	schema?: Record<string, unknown>;
	model?: string;
	agentType?: string;
}) => Promise<{ ok: true; output: unknown } | { ok: false; error: string }>;

export type WorkflowRunnerEvent =
	| { type: "run_start"; runId: string; workflow: string; steps: number }
	| { type: "step_start"; stepId: string; label: string; agents: number }
	| { type: "step_end"; stepId: string; round: number; agents: number }
	| { type: "log"; message: string }
	| { type: "run_end"; status: "completed" | "failed" | "stopped"; agents: number };

export interface WorkflowRunnerOptions {
	/** Host-wired agent executor (background subagents). */
	invoker: WorkflowAgentInvoker;
	/** Max agents running at once (user-configurable, 1-256). */
	maxConcurrent: number;
	/** Called with runner events for progress surfaces. */
	onEvent?: (event: WorkflowRunnerEvent) => void;
	/** Abort signal (session teardown / user stop). */
	signal?: AbortSignal;
	/** Directory for persisted run state; omitted = in-memory only. */
	stateDir?: string;
}

const DEFAULT_MAX_ROUNDS = 3;

export class WorkflowRunner {
	readonly state: WorkflowRunState;
	private readonly invoker: WorkflowAgentInvoker;
	private readonly options: WorkflowRunnerOptions;

	private readonly spec: WorkflowSpec;

	constructor(spec: WorkflowSpec, options: WorkflowRunnerOptions, runId: string, resumeState?: WorkflowRunState) {
		this.spec = spec;
		this.options = options;
		this.invoker = options.invoker;
		this.state = resumeState
			? { ...resumeState, status: "running", updatedAt: Date.now() }
			: {
					id: runId,
					workflowName: spec.name,
					filePath: spec.filePath,
					status: "running",
					startedAt: Date.now(),
					updatedAt: Date.now(),
					steps: {},
					agentCount: 0,
				};
	}

	async run(args: Record<string, unknown> | undefined): Promise<WorkflowRunState> {
		this.emit({
			type: "run_start",
			runId: this.state.id,
			workflow: this.state.workflowName,
			steps: this.spec.steps.length,
		});

		for (const step of this.spec.steps) {
			if (this.options.signal?.aborted) break;
			if (Date.now() - this.state.startedAt > WORKFLOW_MAX_RUN_MS) {
				this.state.error = `workflow exceeded the ${Math.round(WORKFLOW_MAX_RUN_MS / 60000)}-minute run budget`;
				break;
			}
			await this.executeStep(step, args);
			this.persist();
		}

		this.state.status = this.options.signal?.aborted ? "stopped" : this.state.error ? "failed" : "completed";
		this.state.updatedAt = Date.now();
		this.emit({ type: "run_end", status: this.state.status, agents: this.state.agentCount });
		this.persist();
		return this.state;
	}

	// ------------------------------------------------------------------ steps

	private async executeStep(step: WorkflowStep, args: Record<string, unknown> | undefined): Promise<void> {
		const maxRounds = step.max_rounds ?? (step.until ? DEFAULT_MAX_ROUNDS : 1);
		const outputs: unknown[] = [];
		let noProgressRounds = 0;
		let previousOutput: unknown;

		for (let round = 0; round < maxRounds; round++) {
			if (this.options.signal?.aborted) break;

			let items: unknown[] | undefined;
			if (step.type === "fan-out") {
				items = step.over ? this.resolveItems(step.over) : [];
			}
			const agentsThisRound = step.type === "fan-out" ? items!.length : 1;
			if (this.state.agentCount + agentsThisRound > WORKFLOW_MAX_AGENTS) {
				throw new Error(`agent cap reached (${WORKFLOW_MAX_AGENTS} per run) at step "${step.id}"`);
			}

			const fingerprint = this.fingerprint(step, args, items);

			// Resume: a prior completed result with an unchanged fingerprint is
			// reused (loopless steps only — a loop must run at least once).
			const prior = this.state.steps[step.id];
			if (round === 0 && prior && !prior.error && prior.lastPrompt === fingerprint && step.until === undefined) {
				this.emit({ type: "log", message: `step "${step.id}" reused from a previous run (unchanged inputs)` });
				return;
			}
			if (round === 0) this.invalidateAfter(step.id);

			this.emit({
				type: "step_start",
				stepId: step.id,
				label: this.renderLabel(step, args),
				agents: agentsThisRound,
			});

			let output: unknown;
			if (step.type === "fan-out") {
				output = await this.runFanOut(step, items!, args, round);
			} else {
				const result = await this.invokeAgent(step, args, round, 0);
				if (!result.ok) {
					this.state.steps[step.id] = { stepId: step.id, rounds: round + 1, outputs, error: result.error };
					throw new Error(`step "${step.id}" failed: ${result.error}`);
				}
				output = result.output;
			}

			outputs.push(output);
			this.state.steps[step.id] = {
				stepId: step.id,
				rounds: round + 1,
				outputs: [...outputs],
				lastPrompt: fingerprint,
			};
			this.emit({ type: "step_end", stepId: step.id, round, agents: agentsThisRound });

			if (step.until && checkPredicate(step.until, output)) break;

			if (step.stop_on_no_progress !== undefined) {
				if (JSON.stringify(output) === JSON.stringify(previousOutput)) {
					noProgressRounds++;
					if (noProgressRounds >= step.stop_on_no_progress) {
						this.emit({
							type: "log",
							message: `step "${step.id}": ${noProgressRounds} consecutive rounds made no progress — stopping loop`,
						});
						break;
					}
				} else {
					noProgressRounds = 0;
				}
			}
			previousOutput = output;
		}
	}

	// -------------------------------------------------------- data + resume

	private fingerprint(
		step: WorkflowStep,
		args: Record<string, unknown> | undefined,
		items: unknown[] | undefined,
	): string {
		const rendered = interpolate(step.prompt, { steps: this.stepRefs(), args }, { missing: () => {} });
		return step.type === "fan-out" ? `${rendered}#${items?.length ?? 0}` : rendered;
	}

	/** Drop persisted results for every step after `stepId` (rerun-on-change). */
	private invalidateAfter(stepId: string): void {
		const index = this.spec.steps.findIndex((s) => s.id === stepId);
		for (const later of this.spec.steps.slice(index + 1)) {
			delete this.state.steps[later.id];
		}
	}

	private stepRefs(): Record<string, unknown> {
		const refs: Record<string, unknown> = {};
		for (const [id, result] of Object.entries(this.state.steps)) {
			refs[id] = result.outputs.at(-1);
		}
		return refs;
	}

	private resolveItems(over: string): unknown[] {
		const dot = over.indexOf(".");
		const stepId = dot === -1 ? over : over.slice(0, dot);
		const stepOutput = this.stepRefs()[stepId];
		if (stepOutput === undefined) {
			throw new Error(`fan-out source "${over}" is unavailable (step "${stepId}" has no output yet)`);
		}
		const items = dot === -1 ? stepOutput : resolvePath(stepOutput, over.slice(dot + 1));
		if (!Array.isArray(items)) {
			throw new Error(`fan-out source "${over}" did not resolve to an array`);
		}
		return items;
	}

	// ---------------------------------------------------------------- fan-out

	private async runFanOut(
		step: WorkflowStep,
		items: unknown[],
		args: Record<string, unknown> | undefined,
		round: number,
	): Promise<unknown[]> {
		const results: unknown[] = new Array(items.length);
		let next = 0;
		let failures = 0;

		const worker = async (): Promise<void> => {
			while (!this.options.signal?.aborted) {
				const index = next++;
				if (index >= items.length) return;
				const result = await this.invokeAgent(step, args, round, index, items[index]);
				if (result.ok) {
					results[index] = result.output;
				} else {
					// A failed item stays null (like upstream's stopped-agent nulls)
					// instead of aborting the whole fan-out.
					results[index] = null;
					failures++;
				}
			}
		};

		const workers = Array.from({ length: Math.max(1, Math.min(this.options.maxConcurrent, items.length)) }, () =>
			worker(),
		);
		await Promise.all(workers);

		if (failures === items.length && items.length > 0) {
			throw new Error(`fan-out step "${step.id}" failed for all ${items.length} items`);
		}
		return results;
	}

	// ----------------------------------------------------------------- agents

	private async invokeAgent(
		step: WorkflowStep,
		args: Record<string, unknown> | undefined,
		round: number,
		index: number,
		item?: unknown,
	): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
		const prompt = interpolate(step.prompt, { steps: this.stepRefs(), args }, { item, missing: () => {} });
		const id = `${this.state.id}-${step.id}-r${round}-${index}`;
		this.state.agentCount++;
		return this.invoker({
			id,
			prompt,
			label: this.renderLabel(step, args, item),
			...(step.schema ? { schema: step.schema } : {}),
			...(step.model ? { model: step.model } : {}),
			...(step.agent_type ? { agentType: step.agent_type } : {}),
		});
	}

	private renderLabel(step: WorkflowStep, args: Record<string, unknown> | undefined, item?: unknown): string {
		const template = step.label ?? step.prompt;
		const rendered = interpolate(template, { steps: this.stepRefs(), args }, { item, missing: () => {} });
		const firstLine = rendered.split("\n")[0] ?? "";
		return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
	}

	// -------------------------------------------------------------- plumbing

	private emit(event: WorkflowRunnerEvent): void {
		this.options.onEvent?.(event);
	}

	private persist(): void {
		if (!this.options.stateDir) return;
		try {
			mkdirSync(this.options.stateDir, { recursive: true });
			this.state.updatedAt = Date.now();
			writeFileSync(
				join(this.options.stateDir, `${this.state.id}.json`),
				JSON.stringify(this.state, null, "\t"),
				"utf-8",
			);
		} catch {
			// State persistence is best-effort; the run continues in memory.
		}
	}
}

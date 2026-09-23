/**
 * Script workflow runtime.
 *
 * Executes a workflow script (meta block + top-level-await body) inside a
 * `node:vm` sandbox with the orchestration primitives injected as globals:
 *
 *   agent(prompt, opts?)        one subagent; result, or null on stop/failure
 *   pipeline(list, fn)          one fn() per item concurrently; nulls preserved
 *   parallel(tasks)             await a set of agent tasks together
 *   phase(title)                group the agents that follow under a title
 *   log(message)                progress line
 *   args                        invocation input (undefined when omitted)
 *
 * The script coordinates the agents — it gets no filesystem, no shell, and no
 * module loading (`import()`/`require` are rejected before the run starts).
 * `Date.now()`, `Math.random()`, and no-argument `new Date()` throw so a
 * relaunched run repeats the same agent() calls, which is what makes the
 * start-ordered agent log a valid resume key.
 *
 * Resume replays the script: each agent() call consumes the log head — a
 * completed entry with an identical prompt returns its saved result; the first
 * mismatch (edited script, or an earlier agent that now returns something
 * different) truncates the log and runs fresh from that point on.
 */

import vm from "node:vm";
import {
	WORKFLOW_DEFAULT_PHASE,
	WORKFLOW_DEFAULT_STAGGER_MS,
	WORKFLOW_MAX_AGENTS,
	WORKFLOW_MAX_ITEMS,
	WORKFLOW_MAX_RUN_MS,
	type WorkflowAgentInvocationResult,
	type WorkflowAgentInvoker,
	type WorkflowAgentLogEntry,
	type WorkflowRunState,
	type WorkflowRuntimeEvent,
	type WorkflowRuntimeOptions,
} from "./types.ts";

/** Error raised for static violations and runtime constraint breaches. */
export class WorkflowScriptError extends Error {}

/**
 * Static source checks applied before any agent spawns. `import()` fails
 * before the run starts; `require` is absent from the sandbox but rejected
 * here for a clearer error.
 */
export function staticScriptViolations(source: string): string[] {
	const violations: string[] = [];
	if (/\bimport\s*\(/.test(source)) violations.push("dynamic import() is not allowed in workflow scripts");
	if (/\bimport\s+["']/.test(source) || /^\s*import\s/m.test(source)) {
		violations.push("import statements are not allowed in workflow scripts");
	}
	if (/\bimport\.meta\b/.test(source)) violations.push("import.meta is not allowed in workflow scripts");
	if (/\brequire\s*\(/.test(source)) violations.push("require() is not allowed in workflow scripts");
	return violations;
}

/** Counting semaphore shared by every agent() invocation in a run. */
class Semaphore {
	private active = 0;
	private readonly limit: number;
	private readonly waiters: Array<() => void> = [];

	constructor(limit: number) {
		this.limit = limit;
	}

	async acquire(): Promise<void> {
		while (this.active >= this.limit) {
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		}
		this.active++;
	}

	release(): void {
		this.active--;
		this.waiters.shift()?.();
	}
}

interface AgentOptions {
	schema?: Record<string, unknown>;
	label?: string;
	model?: string;
	agentType?: string;
}

type AgentGlobal = (prompt: string, options?: AgentOptions) => Promise<unknown>;

export class WorkflowRuntime {
	readonly state: WorkflowRunState;

	private readonly invoker: WorkflowAgentInvoker;
	private readonly semaphore: Semaphore;
	private readonly staggerMs: number;
	private readonly launchGates = new Map<string, Promise<void>>();
	private readonly launchReleases = new Map<string, () => void>();
	private readonly persistFn: ((state: WorkflowRunState) => void) | undefined;
	private readonly events: ((event: WorkflowRuntimeEvent) => void) | undefined;
	private readonly signal: AbortSignal | undefined;

	/** Index into `state.agents` of the next expected agent() call. */
	private cursor = 0;
	private currentPhase = WORKFLOW_DEFAULT_PHASE;
	private paused = false;
	private readonly resumeWaiters: Array<() => void> = [];

	constructor(
		spec: { name: string; content: string; filePath?: string; phases?: string[] },
		options: WorkflowRuntimeOptions,
		runId: string,
		resumeState?: WorkflowRunState,
	) {
		this.invoker = options.invoker;
		this.semaphore = new Semaphore(Math.max(1, options.maxConcurrent));
		this.staggerMs = options.staggerMs === undefined ? WORKFLOW_DEFAULT_STAGGER_MS : Math.max(0, options.staggerMs);
		this.persistFn = options.persist;
		this.events = options.onEvent;
		this.signal = options.signal;
		this.state = resumeState
			? {
					// Resume: keep the persisted agent log, but run the CURRENT script
					// (an edited script is the point of a relaunch). meta-declared
					// phases stay visible even before the script re-declares them.
					...resumeState,
					status: "running",
					scriptContent: spec.content,
					...(spec.filePath !== undefined ? { scriptPath: spec.filePath } : {}),
					...(spec.phases ? { phases: [...new Set([...spec.phases, ...resumeState.phases])] } : {}),
					updatedAt: Date.now(),
				}
			: {
					id: runId,
					workflowName: spec.name,
					...(spec.filePath !== undefined ? { scriptPath: spec.filePath } : {}),
					status: "running",
					startedAt: Date.now(),
					updatedAt: Date.now(),
					agentCount: 0,
					phases: spec.phases ? [...spec.phases] : [],
					steps: {},
					agents: [],
					scriptContent: spec.content,
				};
	}

	/**
	 * Pause or resume the run. Pausing gates future agent() spawns AND lets
	 * in-flight invocations hold (via waitWhilePaused) — e.g. a rate-limit
	 * pause raised from inside the invoker. The paused status only replaces a
	 * running status; terminal statuses stand.
	 */
	setPaused(value: boolean): void {
		this.paused = value;
		if (value) {
			if (this.state.status === "running") this.state.status = "paused";
		} else {
			for (const resolve of this.resumeWaiters.splice(0)) resolve();
			if (this.state.status === "paused") this.state.status = "running";
		}
		this.persist();
	}

	/** Whether the run's abort signal has fired. */
	get aborted(): boolean {
		return this.signal?.aborted ?? false;
	}

	/** Resolve once the run is unpaused (immediately when not paused or aborted). */
	async waitWhilePaused(): Promise<void> {
		while (this.paused && !this.signal?.aborted) {
			await new Promise<void>((resolve) => {
				this.resumeWaiters.push(resolve);
				this.signal?.addEventListener("abort", () => resolve(), { once: true });
			});
		}
	}

	async run(args: unknown): Promise<WorkflowRunState> {
		this.emit({ type: "run_start", runId: this.state.id, workflow: this.state.workflowName });
		const violations = staticScriptViolations(this.state.scriptContent);
		if (violations.length > 0) {
			this.state.error = violations[0];
			return this.finish("failed");
		}

		try {
			this.state.returnValue = await this.executeScript(args);
		} catch (error) {
			if (!this.signal?.aborted) {
				this.state.error = error instanceof Error ? error.message : String(error);
			}
		}
		return this.finish(this.signal?.aborted ? "stopped" : this.state.error ? "failed" : "completed");
	}

	private finish(status: "completed" | "failed" | "stopped"): WorkflowRunState {
		this.state.status = status;
		this.state.steps = phaseSummaries(this.state);
		this.emit({ type: "run_end", status, agents: this.state.agentCount });
		this.persist();
		return this.state;
	}

	// ------------------------------------------------------------ execution

	private executeScript(args: unknown): Promise<unknown> {
		const body = this.state.scriptContent.replace(/\bexport\s+/g, "");
		const wrapped = `(async () => {\n${body}\n})()`;

		const agent: AgentGlobal = (prompt, options) => this.agent(prompt, options);

		const sandbox: Record<string, unknown> = {
			agent,
			pipeline: (list: unknown[], fn: (item: unknown, index: number) => unknown) => this.pipeline(list, fn),
			parallel: (tasks: unknown[]) => this.parallel(tasks),
			phase: (title: string) => this.phase(title),
			log: (message: string) => this.log(message),
			args,
			console: { log: (message: unknown) => this.log(String(message)) },
			Date: sandboxDate(),
			Math: { ...Math, random: () => throwDeterminism("Math.random()") },
		};

		const context = vm.createContext(sandbox);
		const script = new vm.Script(wrapped, { filename: `${this.state.workflowName}.workflow.js` });
		return script.runInContext(context) as Promise<unknown>;
	}

	// ----------------------------------------------------------- primitives

	private async agent(prompt: string, options?: AgentOptions): Promise<unknown> {
		if (typeof prompt !== "string" || prompt.length === 0) {
			throw new WorkflowScriptError("agent() requires a non-empty prompt string");
		}
		const schema = options?.schema;
		const label = options?.label ?? firstLine(prompt);

		// Resume: a completed log entry with an identical prompt replays its
		// saved result without consuming a concurrency slot.
		const prior = this.state.agents[this.cursor];
		if (prior && prior.status === "completed" && prior.prompt === prompt) {
			this.cursor++;
			this.emit({ type: "log", message: `agent ${this.cursor - 1} reused from a previous run (unchanged prompt)` });
			return prior.result;
		}

		if (this.cursor >= WORKFLOW_MAX_AGENTS) {
			throw new WorkflowScriptError(`agent cap reached (${WORKFLOW_MAX_AGENTS} per run)`);
		}
		if (this.signal?.aborted) {
			throw new WorkflowScriptError("workflow aborted");
		}
		if (Date.now() - this.state.startedAt > WORKFLOW_MAX_RUN_MS) {
			throw new WorkflowScriptError(
				`workflow exceeded the ${Math.round(WORKFLOW_MAX_RUN_MS / 60000)}-minute run budget`,
			);
		}

		// Fresh invocation: drop the prior entry and everything after it, then
		// append this one — synchronously, so the start order (and thus the
		// replay order) is deterministic.
		this.state.agents.length = this.cursor;
		const seq = this.cursor;
		const entry: WorkflowAgentLogEntry = {
			seq,
			prompt,
			label,
			phase: this.currentPhase,
			status: "running",
			...(schema !== undefined ? { schema } : {}),
			startedAt: Date.now(),
		};
		this.state.agents.push(entry);
		this.state.agentCount = this.state.agents.length;
		this.cursor++;
		// Only explicit phases land in state.phases — the implicit default shows
		// up in the phase summaries (steps) instead of the declared-phase list.
		if (entry.phase !== WORKFLOW_DEFAULT_PHASE) this.recordPhaseInState(entry.phase);
		this.persist();

		this.emit({ type: "agent_start", seq, label, phase: entry.phase, agents: this.state.agentCount });

		await this.waitWhilePaused();
		if (this.signal?.aborted) return this.markStopped(entry, seq);

		await this.semaphore.acquire();
		try {
			if (Date.now() - this.state.startedAt > WORKFLOW_MAX_RUN_MS) {
				throw new WorkflowScriptError(
					`workflow exceeded the ${Math.round(WORKFLOW_MAX_RUN_MS / 60000)}-minute run budget`,
				);
			}
			if (this.signal?.aborted) return this.markStopped(entry, seq);

			// Prompt-cache stagger: hold matching siblings until the first
			// response begins so their first requests read the shared prefix.
			await this.launchGate(schema, options);

			let result: WorkflowAgentInvocationResult;
			try {
				result = await this.invoker({
					id: `${this.state.id}-a${seq}`,
					prompt,
					label,
					...(schema !== undefined ? { schema } : {}),
					...(options?.model !== undefined ? { model: options.model } : {}),
					...(options?.agentType !== undefined ? { agentType: options.agentType } : {}),
					onResponseBegin: () => this.releaseLaunchGate(schema, options),
				});
			} finally {
				// The gate is spent whether the invocation completed, failed, or
				// never signaled a response — followers must not wait on a dead
				// leader past their stagger cap.
				this.releaseLaunchGate(schema, options);
			}

			if (result.ok) {
				entry.status = "completed";
				entry.result = result.output;
				entry.finishedAt = Date.now();
				this.emit({ type: "agent_end", seq, status: "completed" });
				this.persist();
				return entry.result;
			}
			entry.status = "failed";
			entry.error = result.error;
			entry.finishedAt = Date.now();
			this.emit({ type: "agent_end", seq, status: "failed" });
			this.persist();
			if (result.kind === "agent-failed") {
				// Stopped mid-run or unrecoverable agent failure: the script sees
				// null (like upstream), the run continues.
				return null;
			}
			// Structured output never validated: the call fails with an error.
			throw new WorkflowScriptError(`agent "${label}" failed schema validation: ${result.error}`);
		} finally {
			this.semaphore.release();
		}
	}

	private async pipeline(list: unknown[], fn: (item: unknown, index: number) => unknown): Promise<unknown[]> {
		if (!Array.isArray(list)) throw new WorkflowScriptError("pipeline() requires an array as its first argument");
		if (list.length > WORKFLOW_MAX_ITEMS) {
			throw new WorkflowScriptError(
				`pipeline() accepts at most ${WORKFLOW_MAX_ITEMS} items per call (got ${list.length})`,
			);
		}
		return Promise.all(list.map((item, index) => Promise.resolve(fn(item, index))));
	}

	private async parallel(tasks: unknown[]): Promise<unknown[]> {
		if (!Array.isArray(tasks)) throw new WorkflowScriptError("parallel() requires an array of tasks");
		if (tasks.length > WORKFLOW_MAX_ITEMS) {
			throw new WorkflowScriptError(
				`parallel() accepts at most ${WORKFLOW_MAX_ITEMS} tasks per call (got ${tasks.length})`,
			);
		}
		return Promise.all(tasks.map((task) => (typeof task === "function" ? Promise.resolve(task()) : task)));
	}

	private phase(title: string): void {
		if (typeof title !== "string" || title.length === 0) {
			throw new WorkflowScriptError("phase() requires a non-empty title string");
		}
		if (title === this.currentPhase) return;
		this.currentPhase = title;
		this.recordPhaseInState(title);
		this.emit({ type: "phase", phase: title });
		this.persist();
	}

	private log(message: string): void {
		this.emit({ type: "log", message: String(message) });
	}

	// -------------------------------------------------------------- plumbing

	private markStopped(entry: WorkflowAgentLogEntry, seq: number): null {
		entry.status = "stopped";
		entry.finishedAt = Date.now();
		this.emit({ type: "agent_end", seq, status: "stopped" });
		this.persist();
		return null;
	}

	private recordPhaseInState(title: string): void {
		if (!this.state.phases.includes(title)) this.state.phases.push(title);
	}

	// --------------------------------------------------- launch stagger

	/** Followers sharing a signature with the in-flight leader wait on its gate. */
	private launchSignature(schema: Record<string, unknown> | undefined, options?: AgentOptions): string {
		return `${options?.model ?? ""}|${options?.agentType ?? ""}|${JSON.stringify(schema ?? null)}`;
	}

	private async launchGate(schema: Record<string, unknown> | undefined, options?: AgentOptions): Promise<void> {
		if (this.staggerMs <= 0) return;
		const sig = this.launchSignature(schema, options);
		const gate = this.launchGates.get(sig);
		if (gate) {
			// Follower: hold until the leader's response begins or the cap expires.
			await Promise.race([gate, sleep(this.staggerMs)]);
			return;
		}
		// Leader: publish the gate; consumed when the response begins or settles.
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		pending.then(() => {
			if (this.launchGates.get(sig) === pending) this.launchGates.delete(sig);
		});
		this.launchGates.set(sig, pending);
		this.launchReleases.set(sig, release);
	}

	private releaseLaunchGate(schema: Record<string, unknown> | undefined, options?: AgentOptions): void {
		const sig = this.launchSignature(schema, options);
		const release = this.launchReleases.get(sig);
		if (release) {
			this.launchReleases.delete(sig);
			release();
		}
	}

	private persist(): void {
		this.state.updatedAt = Date.now();
		this.persistFn?.(this.state);
	}

	private emit(event: WorkflowRuntimeEvent): void {
		this.events?.(event);
	}
}

// ------------------------------------------------------------------ helpers

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

function sleep(ms: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function throwDeterminism(what: string): never {
	throw new WorkflowScriptError(
		`${what} is disabled inside workflow scripts so runs replay deterministically; pass a timestamp through args instead`,
	);
}

/** Date shim: Date.now() and no-argument new Date() throw; the rest works. */
function sandboxDate(): DateConstructor {
	class WorkflowDate extends Date {
		constructor(...args: unknown[]) {
			if (args.length === 0) throwDeterminism("new Date()");
			super(...(args as ConstructorParameters<typeof Date>));
		}
		static now(): number {
			return throwDeterminism("Date.now()");
		}
	}
	return WorkflowDate as unknown as DateConstructor;
}

/** Phase summaries keyed by title; kept structurally compatible with cloud. */
export function phaseSummaries(state: WorkflowRunState): WorkflowRunState["steps"] {
	const steps: WorkflowRunState["steps"] = {};
	const ensure = (title: string): { stepId: string; rounds: number; error?: string } => {
		const existing = steps[title];
		if (existing) return existing;
		const created = { stepId: title, rounds: 0 };
		steps[title] = created;
		return created;
	};
	for (const phase of state.phases) ensure(phase);
	for (const agent of state.agents) {
		const summary = ensure(agent.phase || WORKFLOW_DEFAULT_PHASE);
		summary.rounds++;
		if ((agent.status === "failed" || agent.status === "stopped") && summary.error === undefined) {
			summary.error = agent.error ?? `agent ${agent.seq} ${agent.status}`;
		}
	}
	return steps;
}

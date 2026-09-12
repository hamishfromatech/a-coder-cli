import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	CHECKPOINT_INTERVAL_MS,
	DEFAULT_TIMEOUT_MINUTES,
	getTaskArtifactsDir,
	getWorkspacePath,
	TASK_BRANCH_PREFIX,
} from "./config.ts";
import * as git from "./git.ts";
import { buildReport } from "./report.ts";
import type { CloudRpcResponse, CloudUiRequest } from "./rpc-process.ts";
import { RpcProcessInstance } from "./rpc-process.ts";
import { getTask, upsertTask } from "./storage.ts";
import type { CloudTask, SpawnTaskOptions, TaskStatus } from "./types.ts";

function nowIso(): string {
	return new Date().toISOString();
}

function shortId(): string {
	return randomUUID().replace(/-/g, "").slice(0, 12);
}

function timeoutMinutesFor(task: CloudTask): number {
	return task.timeoutMinutes > 0 ? task.timeoutMinutes : DEFAULT_TIMEOUT_MINUTES;
}

const REPORT_PROMPT =
	"Your task work is complete. Write a factual report of what you did to `report.md` at the repository root: what changed and why, files touched, commands/tests you ran and their results, and how a reviewer should verify the work. Keep it concise. Do not start new work.";

/**
 * Drives one cloud task end to end: workspace prep, an a-coder RPC agent
 * running in that workspace, WIP checkpoint commits, an agent-authored
 * report.md, and the structured sync-back record.
 */
class TaskRunner {
	private readonly task: CloudTask;
	private rpcProcess?: RpcProcessInstance;
	private unsubscribeEvents?: () => void;
	private unsubscribeExit?: () => void;
	private checkpointTimer?: NodeJS.Timeout;
	private deadlineTimer?: NodeJS.Timeout;
	private phase: "working" | "reporting" = "working";
	private stoppedByUser = false;
	private finalized = false;

	private constructor(task: CloudTask) {
		this.task = task;
	}

	/** Create a queued task record. */
	static create(options: SpawnTaskOptions): CloudTask {
		const id = shortId();
		const now = nowIso();
		const task: CloudTask = {
			id,
			createdAt: now,
			updatedAt: now,
			repoSource: options.repo,
			workspacePath: getWorkspacePath(id),
			baseBranch: options.baseBranch?.trim() || "HEAD",
			baseSha: "",
			branch: `${TASK_BRANCH_PREFIX}${id}`,
			prompt: options.prompt,
			provider: options.provider,
			model: options.model,
			timeoutMinutes: options.timeoutMinutes ?? 0,
			push: options.push === true,
			status: "queued",
			commits: [],
			changedFiles: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				turns: 0,
				toolCalls: 0,
				toolErrors: 0,
			},
			warnings: [],
		};
		upsertTask(task);
		return task;
	}

	/** Run a task to completion. Resolves once the task reaches a terminal state. */
	static async execute(taskId: string): Promise<CloudTask> {
		const task = getTask(taskId);
		if (!task) {
			throw new Error(`Task not found: ${taskId}`);
		}
		const runner = new TaskRunner(task);
		activeRunners.set(taskId, runner);
		try {
			return await runner.run();
		} finally {
			activeRunners.delete(taskId);
		}
	}

	private async run(): Promise<CloudTask> {
		try {
			await this.prepareWorkspace();
			this.transition("running", { startedAt: this.task.startedAt ?? nowIso() });

			this.rpcProcess = new RpcProcessInstance({ cwd: this.task.workspacePath });
			this.wireAgent();

			// Wall-clock budget: agents must not run forever.
			this.deadlineTimer = setTimeout(
				() => {
					void this.onDeadline();
				},
				timeoutMinutesFor(this.task) * 60 * 1000,
			);

			// Periodic checkpoints while the agent works.
			this.checkpointTimer = setInterval(() => {
				void this.checkpoint("checkpoint (periodic)").catch(() => {
					// checkpoint failures never kill the task
				});
			}, CHECKPOINT_INTERVAL_MS);

			if (this.task.provider && this.task.model) {
				await this.selectModel();
			}

			const message = this.task.warnings.some((warning) => warning.includes("re-queued"))
				? `${this.task.prompt}\n\nNote: a previous attempt at this task made progress in this working tree (see git log and uncommitted changes). Continue the task from where it left off; do not redo finished work.`
				: this.task.prompt;

			await this.rpcProcess.send({ type: "prompt", message });
		} catch (error) {
			await this.finalize("error", error instanceof Error ? error.message : String(error));
		}
		return this.waitForTerminal();
	}

	/** Resolves when the task record reaches a terminal status. */
	private waitForTerminal(): Promise<CloudTask> {
		return new Promise<CloudTask>((resolve) => {
			const poll = setInterval(() => {
				const task = getTask(this.task.id);
				if (task && ["done", "error", "stopped"].includes(task.status)) {
					clearInterval(poll);
					resolve(task);
				}
			}, 500);
		});
	}

	private transition(status: TaskStatus, extra?: Partial<CloudTask>): void {
		this.task.status = status;
		this.task.updatedAt = nowIso();
		if (extra) {
			Object.assign(this.task, extra);
		}
		upsertTask(this.task);
	}

	// ── workspace ────────────────────────────────────────────────────────

	private async prepareWorkspace(): Promise<void> {
		const task = this.task;
		mkdirSync(getTaskArtifactsDir(task.id), { recursive: true });
		if (!existsSync(task.workspacePath) || !(await git.isGitRepo(task.workspacePath))) {
			mkdirSync(getWorkspacePath(task.id), { recursive: true });
			await git.cloneRepo(task.repoSource, task.workspacePath);
			task.warnings.push(`Cloned ${task.repoSource} into the task workspace.`);
		}
		const base = await git.resolveBaseBranch(task.workspacePath, task.baseBranch);
		if (base === "HEAD") {
			// Detached HEAD clone (no remote HEAD): branch from the recorded sha.
			task.baseSha = await git.currentSha(task.workspacePath);
			await git.checkoutTaskBranch(task.workspacePath, task.branch, task.baseSha);
		} else {
			task.baseBranch = base;
			await git.checkoutTaskBranch(task.workspacePath, task.branch, base);
			task.baseSha = await git.currentSha(task.workspacePath);
		}
		upsertTask(task);
	}

	// ── agent wiring ─────────────────────────────────────────────────────

	/** Select the requested model on the worker; dynamic catalogs may need a refresh first. */
	private async selectModel(): Promise<void> {
		const rpc = this.rpcProcess;
		const provider = this.task.provider;
		const modelId = this.task.model;
		if (!rpc || !provider || !modelId) return;
		const attempt = (): Promise<CloudRpcResponse> => rpc.send({ type: "set_model", provider, modelId });
		let response = await attempt();
		if (!response.success) {
			// Dynamic catalogs (Ollama Cloud, OpenAdapter, ...) may not include the
			// requested model until a live refresh pulls the current list.
			await rpc.send({ type: "refresh_models" });
			response = await attempt();
		}
		if (!response.success) {
			this.task.warnings.push(
				`Model ${provider}/${modelId} not available on the worker; continuing with the worker default.`,
			);
			upsertTask(this.task);
		}
	}

	private wireAgent(): void {
		const rpc = this.rpcProcess;
		if (!rpc) return;
		this.unsubscribeEvents = rpc.onEvent((event) => this.onAgentEvent(event));
		rpc.setUiRequestHandler((request) => this.autoDeclineUi(request));
		this.unsubscribeExit = rpc.onExit((error) => {
			if (!this.finalized && !this.stoppedByUser) {
				void this.finalize("error", `Agent process exited unexpectedly${error ? `: ${error.message}` : ""}`).catch(
					(finalizeError) => {
						console.error(`finalize failed: ${String(finalizeError)}`);
					},
				);
			}
		});
	}

	private onAgentEvent(event: { type: string } & Record<string, unknown>): void {
		const task = this.task;
		switch (event.type) {
			case "turn_end": {
				const usage = event.usage as
					| { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number }
					| undefined;
				if (usage) {
					task.usage.inputTokens += usage.input ?? 0;
					task.usage.outputTokens += usage.output ?? 0;
					task.usage.cacheRead += usage.cacheRead ?? 0;
					task.usage.cacheWrite += usage.cacheWrite ?? 0;
					task.usage.totalTokens += usage.totalTokens ?? 0;
				}
				task.usage.turns += 1;
				break;
			}
			case "tool_execution_end": {
				task.usage.toolCalls += 1;
				if (event.isError === true) {
					task.usage.toolErrors += 1;
				}
				break;
			}
			case "agent_end": {
				if (this.finalized) break;
				if (this.phase === "working") {
					this.phase = "reporting";
					this.transition("finishing");
					void this.askForReport();
				} else {
					void this.finalize("done").catch((finalizeError) => {
						console.error(`finalize failed: ${String(finalizeError)}`);
					});
				}
				break;
			}
			default:
				break;
		}
	}

	private autoDeclineUi(request: CloudUiRequest): void {
		try {
			this.rpcProcess?.process.stdin?.write(
				`${JSON.stringify({ type: "extension_ui_response", id: request.id, cancelled: true })}\n`,
			);
			if (this.task.warnings.length < 50) {
				this.task.warnings.push(
					"Auto-declined extension UI request; headless tasks cannot answer interactive prompts.",
				);
				upsertTask(this.task);
			}
		} catch {
			// best-effort
		}
	}

	private async askForReport(): Promise<void> {
		const rpc = this.rpcProcess;
		if (!rpc) return;
		try {
			await rpc.send({ type: "prompt", message: REPORT_PROMPT });
		} catch (error) {
			this.task.warnings.push(
				`Report-writing prompt failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			upsertTask(this.task);
			await this.finalize("done");
		}
	}

	// ── completion ───────────────────────────────────────────────────────

	private async onDeadline(): Promise<void> {
		if (this.finalized) return;
		const minutes = timeoutMinutesFor(this.task);
		this.task.warnings.push(
			`Task hit its ${minutes} minute wall-clock budget; stopped with partial work preserved on the branch.`,
		);
		await this.disposeAgent();
		await this.finalize(
			"error",
			`Timed out after ${minutes} minutes (partial work preserved on ${this.task.branch}).`,
		);
	}

	/** Stop a running task on user request. */
	async stop(): Promise<void> {
		if (this.finalized) return;
		this.stoppedByUser = true;
		await this.disposeAgent();
		await this.finalize("stopped");
	}

	private async disposeAgent(): Promise<void> {
		this.clearTimers();
		const rpc = this.rpcProcess;
		if (!rpc) return;
		this.rpcProcess = undefined;
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = undefined;
		this.unsubscribeExit?.();
		this.unsubscribeExit = undefined;
		try {
			await rpc.send({ type: "abort" });
		} catch {
			// process may already be gone
		}
		try {
			await rpc.dispose();
		} catch {
			// ignore
		}
	}

	private clearTimers(): void {
		if (this.checkpointTimer) {
			clearInterval(this.checkpointTimer);
			this.checkpointTimer = undefined;
		}
		if (this.deadlineTimer) {
			clearTimeout(this.deadlineTimer);
			this.deadlineTimer = undefined;
		}
	}

	private async checkpoint(label: string): Promise<void> {
		if (this.finalized) return;
		await git.commitAll(this.task.workspacePath, label);
	}

	private async finalize(status: "done" | "error" | "stopped", error?: string): Promise<void> {
		if (this.finalized) return;
		this.finalized = true;
		this.clearTimers();

		// Capture whatever work exists, even on failure paths.
		try {
			await git.commitAll(this.task.workspacePath, "final checkpoint");
		} catch {
			this.task.warnings.push("Final checkpoint commit failed; working tree left as-is.");
		}

		try {
			const diff = await git.diffSummary(
				this.task.workspacePath,
				this.task.baseSha === "" ? "HEAD" : this.task.baseSha,
			);
			this.task.commits = diff.commits;
			this.task.diffStat = diff.diffStat;
			this.task.changedFiles = diff.changedFiles;
		} catch (gitError) {
			this.task.warnings.push(
				`Could not summarize the diff: ${gitError instanceof Error ? gitError.message : String(gitError)}`,
			);
		}

		try {
			const state: CloudRpcResponse | undefined = await this.rpcProcess?.send({ type: "get_state" });
			if (state?.success && state.data && typeof state.data === "object") {
				const data = state.data as { sessionId?: string; sessionFile?: string };
				if (data.sessionId) this.task.sessionId = data.sessionId;
				if (data.sessionFile) {
					this.task.sessionFile = data.sessionFile;
					if (existsSync(data.sessionFile)) {
						const artifacts = getTaskArtifactsDir(this.task.id);
						mkdirSync(artifacts, { recursive: true });
						copyFileSync(data.sessionFile, join(artifacts, "session.jsonl"));
					}
				}
			}
		} catch {
			// agent process may be gone; the session path may have been recorded earlier
		}

		if (this.task.push) {
			try {
				this.task.pushedToRemote = await git.pushBranch(this.task.workspacePath, this.task.branch);
				if (!this.task.pushedToRemote) {
					this.task.warnings.push("No git remote 'origin' configured in the workspace; branch kept locally.");
				}
			} catch (pushError) {
				this.task.warnings.push(
					`Push to origin failed: ${pushError instanceof Error ? pushError.message : String(pushError)}`,
				);
			}
		}

		this.transition(status, { finishedAt: nowIso(), ...(error !== undefined ? { error } : {}) });
		const report = buildReport(this.task, {
			commits: this.task.commits,
			diffStat: this.task.diffStat ?? "",
			changedFiles: this.task.changedFiles,
		});
		this.task.reportMarkdown = report.markdown;
		upsertTask(this.task);

		try {
			await this.rpcProcess?.dispose();
		} catch {
			// ignore
		}
	}
}

/** Active runners by task id (daemon-scoped). */
const activeRunners = new Map<string, TaskRunner>();

export const CloudTaskRunner = {
	create: TaskRunner.create.bind(TaskRunner),
	execute: TaskRunner.execute.bind(TaskRunner),
	async stop(taskId: string): Promise<void> {
		const runner = activeRunners.get(taskId);
		if (runner) {
			await runner.stop();
			return;
		}
		// Not live in this daemon: mark stopped so the record is honest.
		const task = getTask(taskId);
		if (task && !["done", "error", "stopped"].includes(task.status)) {
			task.status = "stopped";
			task.error = "Stopped while not running (daemon restarted).";
			task.updatedAt = nowIso();
			upsertTask(task);
		}
	},
};

export { TaskRunner };

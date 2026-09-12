import { DEFAULT_TIMEOUT_MINUTES } from "./config.ts";
import { CloudTaskRunner, TaskRunner } from "./runner.ts";
import { getTask, interruptLiveTasks, loadTasks, upsertTask } from "./storage.ts";
import type { CloudTask, SpawnTaskOptions } from "./types.ts";

/**
 * Spawn a task: create the record, then execute it in the background. The
 * daemon keeps running regardless of who dispatched the spawn.
 */
export async function spawnTask(options: SpawnTaskOptions): Promise<CloudTask> {
	if (!options.repo || options.repo.trim().length === 0) {
		throw new Error("spawn requires a repo (local path or git URL)");
	}
	if (!options.prompt || options.prompt.trim().length === 0) {
		throw new Error("spawn requires a task prompt");
	}
	const timeoutMinutes = options.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
	const task = TaskRunner.create({ ...options, timeoutMinutes });
	// Fire and forget: the runner owns its lifecycle and writes status to the store.
	void TaskRunner.execute(task.id).catch((error) => {
		const record = getTask(task.id);
		if (record && !["done", "error", "stopped"].includes(record.status)) {
			record.status = "error";
			record.error = error instanceof Error ? error.message : String(error);
			record.updatedAt = new Date().toISOString();
			upsertTask(record);
		}
	});
	return task;
}

export function listTasks(): CloudTask[] {
	return loadTasks();
}

export function getTaskById(taskId: string): CloudTask | undefined {
	return getTask(taskId);
}

export async function stopTask(taskId: string): Promise<void> {
	await CloudTaskRunner.stop(taskId);
}

/** Called at daemon startup: requeue tasks orphaned by a daemon restart. */
export function resumeOrphanedTasks(): void {
	const orphaned = interruptLiveTasks();
	for (const task of orphaned) {
		void TaskRunner.execute(task.id).catch((error) => {
			const record = getTask(task.id);
			if (record && !["done", "error", "stopped"].includes(record.status)) {
				record.status = "error";
				record.error = error instanceof Error ? error.message : String(error);
				record.updatedAt = new Date().toISOString();
				upsertTask(record);
			}
		});
	}
	if (orphaned.length > 0) {
		console.log(`re-queued ${orphaned.length} task(s) interrupted by daemon restart`);
	}
}

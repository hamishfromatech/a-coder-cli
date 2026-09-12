import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCloudDir, getTasksPath } from "./config.ts";
import type { CloudTask } from "./types.ts";

function ensureCloudDir(): void {
	const dir = getCloudDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

export function loadTasks(): CloudTask[] {
	const path = getTasksPath();
	if (!existsSync(path)) {
		return [];
	}
	const data = readFileSync(path, "utf-8");
	const parsed = JSON.parse(data) as { tasks?: CloudTask[] };
	return parsed.tasks ?? [];
}

export function saveTasks(tasks: CloudTask[]): void {
	ensureCloudDir();
	writeFileSync(getTasksPath(), JSON.stringify({ tasks }, null, 2));
}

export function getTask(taskId: string): CloudTask | undefined {
	return loadTasks().find((task) => task.id === taskId);
}

export function upsertTask(task: CloudTask): void {
	const tasks = loadTasks();
	const index = tasks.findIndex((existing) => existing.id === task.id);
	if (index === -1) {
		tasks.push(task);
	} else {
		tasks[index] = task;
	}
	saveTasks(tasks);
}

export function removeTask(taskId: string): void {
	const tasks = loadTasks().filter((task) => task.id !== taskId);
	saveTasks(tasks);
	const artifactsDir = join(getCloudDir(), "tasks", taskId);
	if (existsSync(artifactsDir)) {
		rmSync(artifactsDir, { recursive: true, force: true });
	}
}

/** Mark tasks that claim to be live but whose daemon died. */
export function interruptLiveTasks(): CloudTask[] {
	const tasks = loadTasks();
	const changed: CloudTask[] = [];
	for (const task of tasks) {
		if (task.status === "running" || task.status === "finishing") {
			task.status = "queued";
			task.updatedAt = new Date().toISOString();
			task.warnings = [
				...task.warnings,
				"Cloud daemon restarted while the task was running; the task was re-queued and will resume from the last checkpoint.",
			];
			changed.push(task);
		}
	}
	if (changed.length > 0) {
		saveTasks(tasks);
	}
	return changed;
}

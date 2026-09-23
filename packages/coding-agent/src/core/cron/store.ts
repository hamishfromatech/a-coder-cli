/**
 * Cron store — JSON persistence for the main agent's scheduled tasks.
 *
 * A single file at `<agentDir>/cron/jobs.json` holding CronJob[]. Writers
 * rewrite atomically (tmp + rename) under a keyed lock, the same tolerance
 * the office store uses for concurrent writers.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";
import { withKeyedLock } from "../../utils/async-mutex.ts";
import type { CronJob, CronRun } from "./types.ts";

function jobsPath(): string {
	return join(getAgentDir(), "cron", "jobs.json");
}

function runsPath(): string {
	return join(getAgentDir(), "cron", "runs.json");
}

async function readJobs(path = jobsPath()): Promise<CronJob[]> {
	try {
		const content = await readFile(path, "utf-8");
		const parsed = JSON.parse(content) as unknown;
		return Array.isArray(parsed) ? (parsed as CronJob[]) : [];
	} catch {
		return [];
	}
}

async function writeJobs(path: string, jobs: CronJob[]): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, JSON.stringify(jobs, null, "\t"), "utf-8");
	await rename(tmp, path);
}

function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
	return withKeyedLock(`cron:${path}`, fn);
}

export async function listJobs(): Promise<CronJob[]> {
	return readJobs();
}

export async function saveJob(job: CronJob): Promise<void> {
	const path = jobsPath();
	await withFileLock(path, async () => {
		const list = await readJobs(path);
		const next = list.filter((j) => j.id !== job.id);
		next.push(job);
		await writeJobs(path, next);
	});
}

export async function deleteJob(id: string): Promise<void> {
	const path = jobsPath();
	await withFileLock(path, async () => {
		const list = await readJobs(path);
		await writeJobs(
			path,
			list.filter((j) => j.id !== id),
		);
	});
}

/**
 * Read-modify-write one job under the file lock. The mutator runs on the
 * loaded record; a thrown mutator leaves the file untouched. Returns the
 * updated job, or undefined when the id no longer exists.
 */
export async function updateJob(id: string, mutate: (job: CronJob) => void): Promise<CronJob | undefined> {
	const path = jobsPath();
	return withFileLock(path, async () => {
		const list = await readJobs(path);
		const job = list.find((j) => j.id === id);
		if (!job) return undefined;
		mutate(job);
		await writeJobs(path, list);
		return job;
	});
}

// ── Run history (`runs.json`, keyed by job id, capped per job) ───────────────

const MAX_RUNS_PER_JOB = 20;

async function readRuns(path = runsPath()): Promise<Record<string, CronRun[]>> {
	try {
		const content = await readFile(path, "utf-8");
		const parsed = JSON.parse(content) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, CronRun[]>) : {};
	} catch {
		return {};
	}
}

async function writeRuns(path: string, runs: Record<string, CronRun[]>): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, JSON.stringify(runs, null, "\t"), "utf-8");
	await rename(tmp, path);
}

/** All runs for a job (newest first), or every job's runs flattened newest-first. */
export async function listRuns(jobId?: string): Promise<CronRun[]> {
	const all = await readRuns();
	const lists = jobId ? [all[jobId] ?? []] : Object.values(all);
	return lists.flat().sort((a, b) => b.startedAt - a.startedAt);
}

export async function appendRun(run: CronRun): Promise<void> {
	const path = runsPath();
	await withFileLock(path, async () => {
		const all = await readRuns(path);
		const list = [run, ...(all[run.jobId] ?? [])].slice(0, MAX_RUNS_PER_JOB);
		all[run.jobId] = list;
		await writeRuns(path, all);
	});
}

/** Update one run under the lock; returns the updated run or undefined. */
export async function updateRun(
	jobId: string,
	runId: string,
	mutate: (run: CronRun) => void,
): Promise<CronRun | undefined> {
	const path = runsPath();
	return withFileLock(path, async () => {
		const all = await readRuns(path);
		const run = all[jobId]?.find((r) => r.id === runId);
		if (!run) return undefined;
		mutate(run);
		await writeRuns(path, all);
		return run;
	});
}

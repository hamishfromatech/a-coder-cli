// A-Coder Bench frontend bindings: invoke wrappers for the tauri bench
// commands and listeners for the streamed run events.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface BenchTaskInfo {
	id: string;
	title: string;
	tags: string[];
	timeout_seconds: number;
}

export interface BenchRunConfig {
	bench_dir: string;
	model: string;
	endpoint?: string;
	api?: string;
	api_key?: string;
	runs: number;
	tasks?: string;
}

/** One NDJSON event emitted by `bench run --json`. */
export interface BenchEvent {
	type: string;
	// bench_progress
	taskId?: string;
	runIndex?: number;
	state?: string;
	detail?: string;
	// bench_log / bench_stderr
	message?: string;
	// bench_summary
	passed?: number;
	total?: number;
	leaderboardPath?: string;
	// bench_stderr wrapper payload
	[key: string]: unknown;
}

export async function benchListTasks(benchDir: string): Promise<BenchTaskInfo[]> {
	return await invoke<BenchTaskInfo[]>("bench_list_tasks", { benchDir });
}

export async function benchScaffold(benchDir: string): Promise<string> {
	return await invoke<string>("bench_scaffold", { benchDir });
}

export async function benchStart(config: BenchRunConfig): Promise<void> {
	await invoke("bench_start", { config });
}

export async function benchStop(): Promise<void> {
	await invoke("bench_stop");
}

/** Subscribe to streamed bench output lines (JSON strings). */
export async function onBenchLine(handler: (event: BenchEvent) => void): Promise<UnlistenFn> {
	return await listen<string>("desktop://bench-line", (payload) => {
		const raw = payload.payload;
		try {
			handler(JSON.parse(raw) as BenchEvent);
		} catch {
			handler({ type: "bench_stderr", message: raw });
		}
	});
}

export async function onBenchExit(handler: (exitCode: number) => void): Promise<UnlistenFn> {
	return await listen<number>("desktop://bench-exit", (payload) => {
		handler(payload.payload);
	});
}
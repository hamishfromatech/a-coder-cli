/**
 * Background process store — tracks detached bash commands that run in the
 * background while the agent continues.
 *
 * When the bash tool is called with `background: true`, the process is
 * spawned detached (stdio piped to a temp file), the tool returns immediately
 * with a process id, and the process is registered here. The UI subscribes
 * to show a status bar of running background commands (like the background
 * agents bar).
 *
 * The store keeps a tail of output (capped) so the user can inspect what
 * a background command has produced so far. On process exit, the record
 * transitions to "done" (or "error") and stays in the store until cleared,
 * so the UI can show a completion notification.
 */

import { createStore, type StoreListener } from "./create-store.ts";

export type BackgroundProcessStatus = "running" | "done" | "error" | "killed";

export interface BackgroundProcessRecord {
	/** Unique id for this background process (the tool call id). */
	id: string;
	/** The command being executed. */
	command: string;
	/** Process PID (for kill). */
	pid: number | undefined;
	/** Wall-clock start (ms since epoch). */
	startedAt: number;
	/** Wall-clock end (ms since epoch), set on exit. */
	endedAt: number | undefined;
	/** Current status. */
	status: BackgroundProcessStatus;
	/** Exit code (set on done/error). */
	exitCode: number | undefined;
	/** Tail of combined stdout+stderr (capped to MAX_TAIL_LINES). */
	output: string;
	/** Total lines seen so far. */
	totalLines: number;
	/** Total bytes seen so far. */
	totalBytes: number;
	/** Path to the full output temp file (if retained). */
	fullOutputPath: string | undefined;
}

const MAX_TAIL_LINES = 20;

// Throttled to ~10Hz (leading + trailing edge): a chatty command emits output
// in bursts and notifying per chunk would drive renders (and the desktop's
// background_processes_update stream) far faster than any human can read.
const store = createStore<BackgroundProcessRecord>({ throttleMs: 100 });

export function getBackgroundProcesses(): BackgroundProcessRecord[] {
	return store.entries().map(([, v]) => v);
}

export function getBackgroundProcess(id: string): BackgroundProcessRecord | undefined {
	return store.get(id);
}

export function subscribeBackgroundProcesses(listener: StoreListener<BackgroundProcessRecord>): () => void {
	return store.subscribe(listener);
}

export function startBackgroundProcess(
	id: string,
	command: string,
	pid: number | undefined,
	fullOutputPath?: string,
): BackgroundProcessRecord {
	const record: BackgroundProcessRecord = {
		id,
		command,
		pid,
		startedAt: Date.now(),
		endedAt: undefined,
		status: "running",
		exitCode: undefined,
		output: "",
		totalLines: 0,
		totalBytes: 0,
		fullOutputPath,
	};
	store.set(id, record);
	return record;
}

export function appendBackgroundProcessOutput(id: string, chunk: string): void {
	const cur = store.get(id);
	if (!cur || cur.status !== "running") return;
	const combined = cur.output + chunk;
	const lines = combined.split("\n");
	const tail = lines.slice(-MAX_TAIL_LINES);
	store.setThrottled(id, {
		...cur,
		output: tail.join("\n"),
		totalLines: cur.totalLines + (chunk.match(/\n/g)?.length ?? 0),
		totalBytes: cur.totalBytes + Buffer.byteLength(chunk),
	});
}

export function completeBackgroundProcess(id: string, exitCode: number | undefined, killed: boolean): void {
	const cur = store.get(id);
	if (!cur) return;
	store.set(id, {
		...cur,
		status: killed ? "killed" : exitCode !== 0 && exitCode !== undefined ? "error" : "done",
		exitCode,
		endedAt: Date.now(),
	});
}

export function removeBackgroundProcess(id: string): void {
	store.delete(id);
}

export function clearAllBackgroundProcesses(): void {
	store.clear();
}

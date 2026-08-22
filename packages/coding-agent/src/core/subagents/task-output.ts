/**
 * Task-output file helpers for background sub-agents.
 *
 * Ports easy-agent's taskOutput/taskOutputReader. While a background
 * sub-agent runs, every interesting event (model text, tool_use start/done,
 * per-turn usage, completion / error) is appended as a JSON-Lines record to
 * `<sessionDir>/tasks/<agentId>.output`. The model gets the path back from
 * spawn_subagent and can Read or `tail` it to peek at progress at any time;
 * the completion notification references the same path.
 *
 * Why JSONL: one event per line so `tail` and `Read offset` work cleanly;
 * structured timestamp+type+payload so a dedicated UI viewer can parse the
 * file without regex hacks; resilient to partial writes (a mid-append crash
 * leaves at most one truncated trailing line, which readers drop).
 *
 * All writes are best-effort — an IO error never bubbles up to crash the
 * sub-agent loop.
 */

import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import * as path from "node:path";

/** Discriminated union of events written to the .output JSONL stream. */
export type TaskOutputEvent =
	| { type: "started"; agentType: string; prompt: string }
	| { type: "text"; text: string }
	| { type: "tool_use"; toolName: string }
	| { type: "tool_result"; toolName: string; isError: boolean; preview: string }
	| { type: "turn_usage"; inputTokens: number; outputTokens: number; totalTokens: number; turn: number }
	| {
			type: "completed";
			reason: string;
			finalText: string;
			durationMs: number;
			totalTokens: number;
			toolUseCount: number;
	  }
	| { type: "failed"; error: string; durationMs: number };

export interface TaskOutputRecord {
	timestamp: string;
	event: TaskOutputEvent;
}

/** Absolute output file path for one background sub-agent. Pure — creates nothing. */
export function getTaskOutputPath(sessionDir: string, agentId: string): string {
	// Restrict agentId to [A-Za-z0-9._-] so a model-supplied id can't traverse
	// out of the tasks/ directory.
	const safeId = agentId.replaceAll(/[^A-Za-z0-9._-]/g, "-");
	return path.join(sessionDir, "tasks", `${safeId}.output`);
}

/**
 * Ensure the `tasks/` directory and an empty .output file both exist.
 * Idempotent. We pre-create the empty file so a concurrent Read doesn't
 * ENOENT between the spawn returning and the first event being written.
 */
export async function ensureTaskOutputFile(sessionDir: string, agentId: string): Promise<string> {
	const filePath = getTaskOutputPath(sessionDir, agentId);
	await mkdir(path.dirname(filePath), { recursive: true });
	const handle = await open(filePath, "a");
	await handle.close();
	return filePath;
}

/** Append one event to the .output JSONL file. Best-effort — IO errors are swallowed. */
export async function appendTaskOutput(filePath: string, event: TaskOutputEvent): Promise<void> {
	const record = {
		timestamp: new Date().toISOString(),
		...event,
	};
	try {
		await appendFile(filePath, `${JSON.stringify(record)}\n`);
	} catch {
		// Intentional — see file header.
	}
}

/** Truncate long tool results before storing them in the .output file. */
export function previewToolResult(content: string, max = 2000): string {
	if (content.length <= max) return content;
	return `${content.slice(0, max)}\n... [truncated ${content.length - max} chars]`;
}

/**
 * Read + parse the JSONL .output file a background sub-agent appends to.
 * Returns [] when the file is missing. Partial trailing lines (process
 * crashed mid-append) are dropped instead of throwing.
 */
export async function readTaskOutputEvents(filePath: string): Promise<TaskOutputRecord[]> {
	let text: string;
	try {
		text = await readFile(filePath, "utf8");
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const lines = text.split("\n");
	const out: TaskOutputRecord[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			const { timestamp, ...rest } = parsed;
			if (typeof timestamp !== "string") continue;
			out.push({ timestamp, event: rest as unknown as TaskOutputEvent });
		} catch {
			// Partial last line from a mid-append read — drop it.
		}
	}
	return out;
}

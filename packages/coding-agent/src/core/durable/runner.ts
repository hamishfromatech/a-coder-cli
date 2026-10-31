/**
 * Durable execution for unattended runs (cron, background turns).
 *
 * Upstream Pi 1.x extracted `pi-durable`: a harness where every step of a run is a
 * checkpointed task over pluggable storage. A run that dies mid–model-request or
 * mid–tool-call is resumed by the next process that opens the same storage, instead
 * of being lost — the failure mode our heartbeat/background runs kept hitting.
 *
 * This module adapts the vendored harness to the engine: JSONL storage under the
 * engine data directory, the durable coding tools, and a Node execution env scoped to
 * the run's working directory. Our providers keep working unchanged: durable builds
 * system-message transcripts, and `Models` normalizes them into `Context` before
 * dispatch (see `ai/src/utils/transcript.ts`).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Models } from "@earendil-works/pi-ai";
import {
	AssistantEntry,
	createRegistry,
	Harness as DurableHarness,
	type Harness,
	type Registry,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

/** The harness context every call takes; background work is not bound to a UI request. */
const context: Context = BACKGROUND_CONTEXT;

export interface DurableRunOptions {
	/** Directory holding one storage file per run. */
	storageDir: string;
	/** Stable run id; the storage file name. Reopening the same id resumes that run. */
	runId: string;
	models: Models;
	/** Provider and model the run's conversation is pinned to. */
	model: { provider: string; id: string };
	/** Working directory the tools execute in. */
	cwd: string;
	/** The task prompt. */
	prompt: string;
	/** Extra instructions prepended to the durable agent prompt. */
	instructions?: string;
}

export type DurableRunStatus = "done" | "unanswered";

export interface DurableRunResult {
	status: DurableRunStatus;
	/** The final assistant text, when the run produced one. */
	text?: string;
}

/** Storage directory for a run id (JSONL storage is directory-backed). */
export function durableStoragePath(storageDir: string, runId: string): string {
	return join(storageDir, runId.replace(/[^A-Za-z0-9._-]+/g, "_"));
}

/** Registry with the durable coding tools (read, write, edit, bash) installed. */
function createDurableRegistry(): Registry {
	const registry = createRegistry();
	registry.install(CodingTools);
	return registry;
}

async function openHarness(options: DurableRunOptions): Promise<{ harness: Harness; registry: Registry }> {
	await mkdir(options.storageDir, { recursive: true });
	const registry = createDurableRegistry();
	const harness = await DurableHarness.open(
		await openNodeJsonlStorage(durableStoragePath(options.storageDir, options.runId), context),
		{
			models: options.models,
			registry,
			env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? options.cwd }),
			onReport: (error, info) => {
				// Unattended runs have no UI; surface faults on the run log only.
				console.error(`[durable:${info.type}]`, error);
			},
		},
		context,
	);
	return { harness, registry };
}

/** Text of the assistant message an answer entry points at. */
function answerText(entry: { model?: readonly unknown[] } | undefined): string | undefined {
	const message = entry?.model?.[0] as AssistantMessage | undefined;
	if (message === undefined) return undefined;
	return message.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("")
		.trim();
}

/** Run a prompt to completion under durable storage; safe to retry by reopening. */
export async function runDurablePrompt(options: DurableRunOptions): Promise<DurableRunResult> {
	const { harness } = await openHarness(options);
	try {
		const root = await harness.root(context, {
			agent: {
				model: { provider: options.model.provider, modelId: options.model.id },
				cwd: options.cwd,
				...(options.instructions === undefined ? {} : { instructions: options.instructions }),
			},
		});
		harness.resume();
		const submission = await root.submit({ type: "input", content: options.prompt }, context);
		const settled = await submission.wait(context);
		if (settled.status !== "done") return { status: settled.status };
		const entry =
			settled.answer === undefined
				? undefined
				: await root.commit((tx) => tx.entry(AssistantEntry, settled.answer!), context);
		return { status: "done", text: answerText(entry) };
	} finally {
		await harness.close(context);
	}
}

/**
 * Reopen a run's storage and let the harness finish whatever was interrupted
 * (cut-off model requests, tool calls, nested tasks). Resolves undefined when the
 * storage file does not exist.
 */
export async function resumeDurableRun(
	options: Omit<DurableRunOptions, "prompt">,
): Promise<DurableRunResult | undefined> {
	const { harness } = await openHarness({ ...options, prompt: "" });
	try {
		harness.resume();
		const root = await harness.root(context);
		await harness.waitForIdle(context);
		const entries = await root.entries({}, 200, undefined, context);
		const last = [...entries.items].reverse().find((entry) => entry.kind === "pi.assistant");
		return { status: "done", text: answerText(last) };
	} catch {
		return undefined;
	} finally {
		await harness.close(context);
	}
}

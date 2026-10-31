import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { durableStoragePath, resumeDurableRun, runDurablePrompt } from "../../src/core/durable/runner.ts";

const directories = new Set<string>();

afterEach(async () => {
	for (const directory of directories) await rm(directory, { recursive: true, force: true });
	directories.clear();
});

async function tempDir(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "durable-runner-"));
	directories.add(directory);
	return directory;
}

function setup() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return { faux, models };
}

describe("durable run runner", () => {
	it("runs a prompt to completion and returns the answer text", async () => {
		const storageDir = await tempDir();
		const cwd = await tempDir();
		const { faux, models } = setup();
		faux.setResponses([() => fauxAssistantMessage("done: checked the repo")]);

		const result = await runDurablePrompt({
			storageDir,
			runId: "cron-1",
			models,
			model: { provider: "faux", id: "faux-1" },
			cwd,
			prompt: "check the repo",
			instructions: "You are the maintenance agent.",
		});

		expect(result.status).toBe("done");
		expect(result.text).toContain("checked the repo");
	});

	it("resumes an interrupted run from its storage", async () => {
		const storageDir = await tempDir();
		const cwd = await tempDir();
		const { faux, models } = setup();
		// The first response never answers: the run stays busy, then the storage is
		// reopened — the "process died mid-request" shape.
		faux.setResponses([
			(_context, options) =>
				new Promise((_resolve, reject) => {
					options!.signal?.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
				}),
			() => fauxAssistantMessage("resumed answer"),
		]);

		const pending = runDurablePrompt({
			storageDir,
			runId: "cron-2",
			models,
			model: { provider: "faux", id: "faux-1" },
			cwd,
			prompt: "long job",
		});
		// Let the request reach the provider, then abandon the first process.
		await new Promise((resolve) => setTimeout(resolve, 20));
		void pending.catch(() => {});

		const resumed = await resumeDurableRun({
			storageDir,
			runId: "cron-2",
			models,
			model: { provider: "faux", id: "faux-1" },
			cwd,
		});
		expect(resumed?.status).toBe("done");
	});

	it("derives a filesystem-safe storage path per run", () => {
		expect(durableStoragePath("/tmp/runs", "job/1 a")).toBe("/tmp/runs/job_1_a");
	});
});

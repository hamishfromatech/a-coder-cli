/**
 * Kill -9 recovery: a durable run interrupted mid-bash-tool resumes on the next
 * process. The unsafe tool keeps its single execution (no replay), and the model
 * continues from the interruption.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { resumeDurableRun } from "../../src/core/durable/runner.ts";

const directories = new Set<string>();

afterEach(async () => {
	for (const directory of directories) await rm(directory, { recursive: true, force: true });
	directories.clear();
});

async function waitForFile(path: string, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(path)) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

describe("durable kill -9 recovery", () => {
	it("resumes after the process dies mid tool call without replaying it", async () => {
		const storageDir = await mkdtemp(join(tmpdir(), "durable-kill-store-"));
		const cwd = await mkdtemp(join(tmpdir(), "durable-kill-cwd-"));
		directories.add(storageDir);
		directories.add(cwd);

		const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures/kill-run.ts")], {
			cwd: process.cwd(),
			env: { ...process.env, KILL_STORAGE: storageDir, KILL_CWD: cwd },
			stdio: ["ignore", "ignore", "pipe"],
		});
		const errors: string[] = [];
		child.stderr?.on("data", (chunk: Buffer) => errors.push(chunk.toString()));

		// The tool has started executing when the marker exists, so the kill lands
		// while the tool call is in flight.
		await waitForFile(join(cwd, "count.txt"));
		child.kill("SIGKILL");
		await new Promise((resolve) => child.once("exit", resolve));
		expect(existsSync(join(cwd, "count.txt"))).toBe(true);

		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([() => fauxAssistantMessage("resumed after kill")]);

		const resumed = await resumeDurableRun({
			storageDir,
			runId: "kill-1",
			models,
			model: { provider: "faux", id: "faux-1" },
			cwd,
		});
		expect(resumed?.status).toBe("done");
		expect(resumed?.text).toContain("resumed after kill");
		// Bash is not replay-safe: it ran once, before the kill.
		expect((await readFile(join(cwd, "count.txt"), "utf8")).trim()).toBe("1");
	}, 60_000);
});

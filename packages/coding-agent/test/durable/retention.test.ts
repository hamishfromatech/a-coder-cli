import { mkdir, mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneDurableStorage } from "../../src/core/durable/retention.ts";

const directories = new Set<string>();

afterEach(async () => {
	for (const directory of directories) await rm(directory, { recursive: true, force: true });
	directories.clear();
});

const DAY = 24 * 60 * 60 * 1000;

async function oldDir(root: string, name: string, days: number): Promise<string> {
	const path = join(root, name);
	await mkdir(path, { recursive: true });
	const at = new Date(Date.now() - days * DAY);
	await utimes(path, at, at);
	return path;
}

describe("durable storage retention", () => {
	it("removes expired finished runs and keeps running ones", async () => {
		const root = await mkdtemp(join(tmpdir(), "durable-retention-"));
		directories.add(root);
		const running = await oldDir(root, "cron-running", 30);
		await oldDir(root, "cron-finished", 30);
		await oldDir(root, "cron-recent", 1);

		const removed = await pruneDurableStorage({ storageDir: root, keep: new Set([running]) });

		expect(removed).toEqual([join(root, "cron-finished")]);
		expect((await readdir(root)).sort()).toEqual(["cron-recent", "cron-running"]);
	});

	it("tolerates a missing storage directory", async () => {
		expect(await pruneDurableStorage({ storageDir: "/nonexistent/durable", keep: new Set() })).toEqual([]);
	});
});

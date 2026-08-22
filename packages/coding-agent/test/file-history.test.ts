import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileHistory } from "../src/core/file-history.ts";

let dir: string;
let history: FileHistory;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "pi-file-history-"));
	// Override the backup root so tests never touch ~/.a-coder-cli.
	process.env.A_CODER_CLI_FILE_HISTORY_DIR = join(dir, "backups");
	history = new FileHistory();
	history.configure(dir, "test-session");
});

afterEach(async () => {
	delete process.env.A_CODER_CLI_FILE_HISTORY_DIR;
	await rm(dir, { recursive: true, force: true });
});

describe("FileHistory", () => {
	it("is enabled by default", () => {
		expect(history.isEnabled()).toBe(true);
	});

	it("can be disabled via env var", () => {
		const prev = process.env.A_CODER_CLI_DISABLE_FILE_HISTORY;
		process.env.A_CODER_CLI_DISABLE_FILE_HISTORY = "1";
		const h = new FileHistory();
		h.configure(dir, "x");
		expect(h.isEnabled()).toBe(false);
		process.env.A_CODER_CLI_DISABLE_FILE_HISTORY = prev;
	});

	it("restores a file edited after a turn snapshot (rewind n=1)", async () => {
		const file = join(dir, "a.txt");
		await writeFile(file, "original");

		// Turn 1 snapshot captures "original".
		await history.makeSnapshot("turn-1");
		// The agent edits the file during turn 1 — track the pre-edit content.
		await history.trackEdit(file, "turn-1");
		await writeFile(file, "modified");

		expect(await readFile(file, "utf-8")).toBe("modified");

		const changed = await history.rewind("turn-1");
		expect(changed).toContain(file);
		expect(await readFile(file, "utf-8")).toBe("original");
	});

	it("returns [] when already at the target state", async () => {
		const file = join(dir, "b.txt");
		await writeFile(file, "same");
		await history.makeSnapshot("t1");
		await history.trackEdit(file, "t1");
		// No edit happens.
		const changed = await history.rewind("t1");
		expect(changed).toEqual([]);
	});

	it("deletes a file created during the rewound turn", async () => {
		const file = join(dir, "created.txt");
		await history.makeSnapshot("t1");
		// File did not exist at snapshot time; trackEdit records null backup.
		await history.trackEdit(file, "t1");
		await writeFile(file, "new content");

		const changed = await history.rewind("t1");
		expect(changed).toContain(file);
		await expect(access(file)).rejects.toThrow();
	});

	it("resolves snapshots by offset", async () => {
		await history.makeSnapshot("t1");
		await history.makeSnapshot("t2");
		await history.makeSnapshot("t3");
		expect(history.snapshotCount()).toBe(3);
		expect(history.getSnapshotByOffset(1)?.messageId).toBe("t3");
		expect(history.getSnapshotByOffset(3)?.messageId).toBe("t1");
		expect(history.getSnapshotByOffset(4)).toBeUndefined();
	});

	it("only backs up v1 once per turn (idempotent trackEdit)", async () => {
		const file = join(dir, "c.txt");
		await writeFile(file, "v0");
		await history.makeSnapshot("t1");
		await history.trackEdit(file, "t1");
		await history.trackEdit(file, "t1"); // no-op
		const snap = history.getSnapshotByOffset(1)!;
		const backups = Object.values(snap.trackedFileBackups);
		expect(backups.length).toBe(1);
		expect(backups[0].version).toBe(1);
	});

	it("reports diff stats for a rewound turn", async () => {
		const file = join(dir, "d.txt");
		await writeFile(file, "line1\nline2\nline3\n");
		await history.makeSnapshot("t1");
		await history.trackEdit(file, "t1");
		await writeFile(file, "line1\nCHANGED\nline3\nline4\n");
		const stats = await history.getDiffStats("t1");
		expect(stats.filesChanged).toContain(file);
		expect(stats.insertions).toBeGreaterThan(0);
		expect(stats.deletions).toBeGreaterThan(0);
	});

	it("evicts snapshots past the cap", async () => {
		for (let i = 0; i < 110; i++) {
			await history.makeSnapshot(`t${i}`);
		}
		expect(history.snapshotCount()).toBe(100);
		// Oldest evicted, newest retained.
		expect(history.getSnapshotById("t0")).toBeUndefined();
		expect(history.getSnapshotById("t109")).toBeDefined();
	});
});

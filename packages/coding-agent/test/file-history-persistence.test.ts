import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileHistory } from "../src/core/file-history.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("file-history persistence across resume", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-file-history-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("persists snapshots to the transcript and restores them on a fresh store", async () => {
		const fileA = join(tempDir, "notes.md");
		writeFileSync(fileA, "original\n");

		const sessionManager = SessionManager.inMemory();
		const history = new FileHistory();
		history.configure(tempDir, "session-1");
		const persisted: unknown[] = [];
		history.setPersistHook((snapshot) => {
			persisted.push(snapshot);
			sessionManager.appendFileHistorySnapshot(snapshot);
		});

		// Turn 1: edit tracked file.
		await history.trackEdit(fileA, "turn-1");
		writeFileSync(fileA, "edited\n");
		// Turn 2 starts: snapshot captures post-turn-1 state.
		await history.makeSnapshot("turn-2");

		expect(persisted.length).toBe(2);
		expect(sessionManager.getFileHistorySnapshots()).toHaveLength(2);

		// Simulate a resume: fresh store rehydrates from the transcript.
		const restored = new FileHistory();
		restored.configure(tempDir, "session-1");
		restored.restoreFromSnapshots(sessionManager.getFileHistorySnapshots());
		expect(restored.snapshotCount()).toBe(2);

		// Rewind to pre-turn-1 state (v1 backup taken by trackEdit).
		const changed = await restored.rewind("turn-1");
		expect(changed).toContain(fileA);
		expect(readFileSync(fileA, "utf-8")).toBe("original\n");
	});

	it("keeps the fullest record per messageId when a turn has multiple entries", async () => {
		const fileA = join(tempDir, "a.md");
		writeFileSync(fileA, "one\n");
		const fileB = join(tempDir, "b.md");
		writeFileSync(fileB, "two\n");

		const sessionManager = SessionManager.inMemory();
		const history = new FileHistory();
		history.configure(tempDir, "session-1");
		history.setPersistHook((snapshot) => sessionManager.appendFileHistorySnapshot(snapshot));

		await history.trackEdit(fileA, "turn-1");
		await history.trackEdit(fileB, "turn-1");

		const restored = new FileHistory();
		restored.configure(tempDir, "session-1");
		restored.restoreFromSnapshots(sessionManager.getFileHistorySnapshots());

		// Two entries per turn-1 (one per trackEdit) must collapse to ONE snapshot.
		expect(sessionManager.getFileHistorySnapshots()).toHaveLength(2);
		expect(restored.snapshotCount()).toBe(1);
		const snapshot = restored.getSnapshotById("turn-1");
		expect(snapshot?.trackedFileBackups).toHaveProperty("a.md");
		expect(snapshot?.trackedFileBackups).toHaveProperty("b.md");
	});

	it("follows the active session branch after navigation", async () => {
		const sessionManager = SessionManager.inMemory();
		const history = new FileHistory();
		history.configure(tempDir, "session-1");
		history.setPersistHook((snapshot) => sessionManager.appendFileHistorySnapshot(snapshot));

		await history.makeSnapshot("branch-a-turn");
		const entryA = sessionManager.getEntries().at(-1)!;

		// Branch from the snapshot entry: new entries on the new branch are separate.
		sessionManager.branch(entryA.id);
		await history.makeSnapshot("branch-b-turn");
		expect(sessionManager.getFileHistorySnapshots().map((s) => s.messageId)).toEqual([
			"branch-a-turn",
			"branch-b-turn",
		]);

		// Navigate back to the first entry: only the branch-a snapshot remains.
		sessionManager.branch(entryA.id);
		const restored = new FileHistory();
		restored.configure(tempDir, "session-1");
		restored.restoreFromSnapshots(sessionManager.getFileHistorySnapshots());
		expect(restored.snapshotCount()).toBe(1);
		expect(restored.getSnapshotById("branch-b-turn")).toBeUndefined();
	});
});

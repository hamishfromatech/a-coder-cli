// Regression for pi#12154: a session whose post-compaction tail exceeds the engine's
// maximum argument count threw RangeError on every context rebuild, so it could never
// be opened again. The tail is now appended one entry at a time instead of spread.
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CompactionEntry,
	type CustomEntry,
	type SessionEntry,
	type SessionHeader,
	SessionManager,
	type SessionMessageEntry,
} from "../../../src/core/session-manager.ts";

/** Above V8's argument limit (~120k-150k), so `push(...tail)` overflows the stack. */
const STATE_ENTRY_COUNT = 150_000;
/** Batched so the test never holds the whole 16 MB transcript as one string. */
const WRITE_BATCH_SIZE = 10_000;
const TIMESTAMP = "2025-01-01T00:00:00Z";

function userMessage(id: string, parentId: string | null, text: string): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: TIMESTAMP,
		message: { role: "user", content: text, timestamp: 1 },
	};
}

function compaction(id: string, parentId: string | null, summary: string, firstKeptEntryId: string): CompactionEntry {
	return { type: "compaction", id, parentId, timestamp: TIMESTAMP, summary, firstKeptEntryId, tokensBefore: 1000 };
}

function stateEntry(index: number, parentId: string | null): CustomEntry {
	return { type: "custom", id: `state-${index}`, parentId, timestamp: TIMESTAMP, customType: "state" };
}

function appendLines(file: string, entries: SessionEntry[]): void {
	appendFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

describe("issue #12154 context entry overflow", () => {
	let tempDir = "";

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-12154-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	/** Writes a session with a compaction followed by STATE_ENTRY_COUNT state entries. */
	function writeLongSession(): string {
		const file = join(tempDir, "long-session.jsonl");
		const header: SessionHeader = {
			type: "session",
			version: 3,
			id: "12154",
			timestamp: TIMESTAMP,
			cwd: tempDir,
		};
		writeFileSync(file, `${JSON.stringify(header)}\n`);

		appendLines(file, [
			userMessage("1", null, "summarized"),
			userMessage("2", "1", "kept"),
			compaction("3", "2", "Summary", "2"),
		]);

		let parentId = "3";
		for (let start = 0; start < STATE_ENTRY_COUNT; start += WRITE_BATCH_SIZE) {
			const batch: SessionEntry[] = [];
			for (let index = start; index < Math.min(start + WRITE_BATCH_SIZE, STATE_ENTRY_COUNT); index++) {
				batch.push(stateEntry(index, parentId));
				parentId = `state-${index}`;
			}
			appendLines(file, batch);
		}

		return file;
	}

	it("loads a long session and rebuilds its context without overflowing the stack", () => {
		const file = writeLongSession();
		const sessionManager = SessionManager.open(file, tempDir);

		const contextEntries = sessionManager.buildContextEntries();
		expect(contextEntries).toHaveLength(STATE_ENTRY_COUNT + 2);
		expect(contextEntries.slice(0, 3).map((entry) => entry.id)).toEqual(["3", "2", "state-0"]);
		expect(
			contextEntries.slice(2).every((entry, index) => entry.id === `state-${index}`),
			"retained entries keep their original order",
		).toBe(true);
		expect(contextEntries[contextEntries.length - 1].id).toBe(`state-${STATE_ENTRY_COUNT - 1}`);

		const context = sessionManager.buildSessionContext();
		expect(context.messages).toHaveLength(2);
		expect(context.messages[0]).toMatchObject({ role: "compactionSummary", summary: "Summary" });
		expect(context.messages[1]).toMatchObject({ role: "user", content: "kept" });
	});

	it("applies a later context edit to a loaded long session", () => {
		const file = writeLongSession();
		const sessionManager = SessionManager.open(file, tempDir);

		const editId = sessionManager.appendCustomMessageEntry("test", "edited", false);

		expect(sessionManager.getLeafId()).toBe(editId);
		const contextEntries = sessionManager.buildContextEntries();
		expect(contextEntries).toHaveLength(STATE_ENTRY_COUNT + 3);
		expect(contextEntries.slice(-2).map((entry) => entry.id)).toEqual([`state-${STATE_ENTRY_COUNT - 1}`, editId]);

		const context = sessionManager.buildSessionContext();
		expect(context.messages).toHaveLength(3);
		expect(context.messages[context.messages.length - 1]).toMatchObject({
			role: "custom",
			customType: "test",
			content: "edited",
		});
	});
});

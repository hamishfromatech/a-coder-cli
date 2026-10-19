import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../src/core/session-manager.ts";
import { pageTranscriptEntries, toTranscriptEntries } from "../src/modes/rpc/rpc-history.ts";

const base = (id: string, parentId: string | null, timestamp: string) => ({ id, parentId, timestamp });

const entries: SessionEntry[] = [
	{
		...base("m1", null, "2026-01-01T00:00:00.000Z"),
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "old" }] } as never,
	},
	{
		...base("m2", "m1", "2026-01-01T00:00:01.000Z"),
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "old reply" }] } as never,
	},
	{
		...base("c1", "m2", "2026-01-01T00:00:02.000Z"),
		type: "compaction",
		summary: "summarized old turns",
		firstKeptEntryId: "m2",
		tokensBefore: 100,
	},
	{
		...base("m3", "c1", "2026-01-01T00:00:03.000Z"),
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "new" }] } as never,
	},
	{
		...base("m4", "m3", "2026-01-01T00:00:04.000Z"),
		type: "message",
		message: { role: "toolResult", toolCallId: "t1", content: [] } as never,
	},
	{
		...base("m5", "m4", "2026-01-01T00:00:05.000Z"),
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "done" }] } as never,
	},
	{
		...base("s1", "m5", "2026-01-01T00:00:06.000Z"),
		type: "session_info",
		name: "ignored",
	},
];

describe("transcript entries", () => {
	it("projects messages and explicit summary boundaries, dropping metadata", () => {
		const transcript = toTranscriptEntries(entries);
		expect(transcript.map((entry) => entry.type)).toEqual([
			"message",
			"message",
			"compaction",
			"message",
			"message",
			"message",
		]);
		expect(transcript[2]).toMatchObject({
			summary: "summarized old turns",
			firstKeptEntryId: "m2",
			tokensBefore: 100,
		});
	});

	it("pages without starting on an orphaned tool result", () => {
		const transcript = toTranscriptEntries(entries);
		const page = pageTranscriptEntries(transcript, { limit: 2, before: 6 });
		expect(page.start).toBe(3);
		expect(page.entries.map((entry) => entry.id)).toEqual(["m3", "m4", "m5"]);
		expect(page.hasMore).toBe(true);
	});

	it("includes pre-compaction history when the page is large enough", () => {
		const page = pageTranscriptEntries(toTranscriptEntries(entries), { limit: 100 });
		expect(page.start).toBe(0);
		expect(page.entries.some((entry) => entry.type === "compaction")).toBe(true);
		expect(page.entries[0]?.id).toBe("m1");
	});
});

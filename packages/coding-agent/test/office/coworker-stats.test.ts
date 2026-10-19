import { describe, expect, it } from "vitest";
import { summarizeCoworkerSession } from "../../src/core/office/coworker-stats.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";

const message = (
	id: string,
	parentId: string | null,
	timestamp: string,
	role: "user" | "assistant",
	usage?: unknown,
): SessionEntry => ({
	id,
	parentId,
	timestamp,
	type: "message",
	message: { role, content: [], usage } as never,
});

describe("summarizeCoworkerSession", () => {
	it("counts turns, tokens, messages, and the latest activity", () => {
		const entries: SessionEntry[] = [
			message("m1", null, "2026-01-01T00:00:00.000Z", "user"),
			message("m2", "m1", "2026-01-01T00:00:01.000Z", "assistant", {
				input: 100,
				output: 20,
				cacheRead: 5,
				cacheWrite: 2,
			}),
			message("m3", "m2", "2026-01-01T00:00:02.000Z", "user"),
			message("m4", "m3", "2026-01-01T00:00:03.000Z", "assistant", { input: 10, output: 1 }),
			{
				id: "s1",
				parentId: "m4",
				timestamp: "2026-01-01T00:00:04.000Z",
				type: "session_info",
				name: "Harbor sweep",
			},
		];
		const summary = summarizeCoworkerSession(entries, "/s.jsonl", "/repo");
		expect(summary).toMatchObject({
			path: "/s.jsonl",
			cwd: "/repo",
			name: "Harbor sweep",
			messageCount: 4,
			turns: 2,
			tokens: 138,
			lastActivity: Date.parse("2026-01-01T00:00:04.000Z"),
		});
	});

	it("ignores non-message usage and missing usage", () => {
		const summary = summarizeCoworkerSession(
			[message("m1", null, "2026-01-01T00:00:00.000Z", "assistant")],
			"/s.jsonl",
			"/repo",
		);
		expect(summary.tokens).toBe(0);
		expect(summary.turns).toBe(0);
	});
});

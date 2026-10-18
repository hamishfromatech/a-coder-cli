import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	archiveSessionFile,
	formatBytes,
	getSessionStoreStats,
	searchSessions,
} from "../src/core/session-maintenance.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";

function session(overrides: Partial<SessionInfo> & { path: string }): SessionInfo {
	return {
		id: overrides.id ?? overrides.path,
		cwd: overrides.cwd ?? "/work/proj",
		created: overrides.created ?? new Date("2026-10-01T10:00:00Z"),
		modified: overrides.modified ?? new Date("2026-10-02T10:00:00Z"),
		messageCount: overrides.messageCount ?? 4,
		firstMessage: overrides.firstMessage ?? "hello",
		allMessagesText: overrides.allMessagesText ?? "",
		...overrides,
	};
}

describe("searchSessions", () => {
	it("returns nothing for an empty query", async () => {
		await expect(searchSessions("   ", { listSessions: async () => [] })).resolves.toEqual([]);
	});

	it("matches transcript text, names, and folders, with snippets", async () => {
		const sessions = [
			session({
				path: "/s/a.jsonl",
				name: "Proxy debugging",
				allMessagesText: "we fixed the tunnel proxy by rewriting the headers",
			}),
			session({
				path: "/s/b.jsonl",
				name: "unrelated",
				cwd: "/work/proxy-service",
				allMessagesText: "nothing here",
			}),
			session({ path: "/s/c.jsonl", name: "other", allMessagesText: "no match at all" }),
		];
		const hits = await searchSessions("proxy", { listSessions: async () => sessions });
		expect(hits.map((hit) => hit.session.path)).toEqual(["/s/a.jsonl", "/s/b.jsonl"]);
		expect(hits[0]!.snippet).toContain("proxy");
		expect(hits[0]!.matches).toBe(1);
		// Name matches rank above body matches.
		expect(hits[0]!.session.name).toBe("Proxy debugging");
	});

	it("counts every occurrence and keeps context around the first", async () => {
		const text = `${"x".repeat(200)} needle then more needle ${"y".repeat(200)}`;
		const hits = await searchSessions("needle", {
			listSessions: async () => [session({ path: "/s/a.jsonl", allMessagesText: text })],
		});
		expect(hits[0]!.matches).toBe(2);
		expect(hits[0]!.snippet.startsWith("…")).toBe(true);
		expect(hits[0]!.snippet.endsWith("…")).toBe(true);
	});

	it("caps results at the requested limit, newest first among equals", async () => {
		const sessions = Array.from({ length: 5 }, (_, i) =>
			session({
				path: `/s/${i}.jsonl`,
				allMessagesText: "shared term",
				modified: new Date(Date.UTC(2026, 9, i + 1)),
			}),
		);
		const hits = await searchSessions("shared", { limit: 3, listSessions: async () => sessions });
		expect(hits).toHaveLength(3);
		expect(hits[0]!.session.path).toBe("/s/4.jsonl");
	});
});

describe("session store maintenance", () => {
	let dir: string;

	beforeEach(() => {
		dir = join(tmpdir(), `pi-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(dir, "proj"), { recursive: true });
		mkdirSync(join(dir, ".trash"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	});

	it("counts stored sessions, excludes the archive, and ranks by size", () => {
		writeFileSync(join(dir, "proj", "a.jsonl"), "a".repeat(100));
		writeFileSync(join(dir, "proj", "b.jsonl"), "b".repeat(300));
		writeFileSync(join(dir, ".trash", "old.jsonl"), "c".repeat(999));

		const stats = getSessionStoreStats(dir);
		expect(stats.count).toBe(2);
		expect(stats.totalBytes).toBe(400);
		expect(stats.largest[0]!.bytes).toBe(300);
		expect(stats.largest[0]!.path.endsWith("b.jsonl")).toBe(true);
	});

	it("archives into .trash and preserves the content", () => {
		const path = join(dir, "proj", "session.jsonl");
		writeFileSync(path, "content");

		const { trashPath } = archiveSessionFile(path, { sessionsDir: dir });
		expect(existsSync(path)).toBe(false);
		expect(trashPath.startsWith(join(dir, ".trash"))).toBe(true);
		expect(readFileSync(trashPath, "utf8")).toBe("content");
	});

	it("refuses the open session, foreign paths, and double archives", () => {
		const path = join(dir, "proj", "session.jsonl");
		writeFileSync(path, "content");

		expect(() => archiveSessionFile(path, { sessionsDir: dir, activePath: path })).toThrow(/open session/);
		expect(() => archiveSessionFile("/etc/passwd", { sessionsDir: dir })).toThrow(/Not a stored session/);

		const { trashPath } = archiveSessionFile(path, { sessionsDir: dir });
		expect(() => archiveSessionFile(trashPath, { sessionsDir: dir })).toThrow(/already archived/);
	});

	it("formats byte sizes compactly", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2048)).toBe("2.0 KB");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
		expect(formatBytes(1024 ** 3 * 12)).toBe("12 GB");
	});
});

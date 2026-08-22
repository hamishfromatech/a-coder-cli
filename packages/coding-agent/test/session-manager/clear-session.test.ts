import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEntriesFromFile, SessionManager } from "../../src/core/session-manager.ts";

let tempDir: string;

beforeEach(() => {
	tempDir = realpathSync(mkdtempSync(join(tmpdir(), "pi-clear-session-")));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function userMessage(text: string) {
	return { role: "user" as const, content: text, timestamp: Date.now() };
}

function assistantMessage(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "anthropic-messages" as const,
		provider: "anthropic" as const,
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

describe("SessionManager.rebindAndOverwriteFile (in-place clear)", () => {
	it("rewrites an existing session file to a fresh header (same id, no messages)", () => {
		const sessionDir = join(tempDir, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		// Create a session with a full turn (user + assistant materializes the file).
		const sm = SessionManager.create(tempDir, sessionDir);
		const sessionId = sm.getSessionId();
		const sessionFile = sm.getSessionFile()!;
		sm.appendMessage(userMessage("hello"));
		sm.appendMessage(assistantMessage("hi"));

		// Sanity: the file has more than just a header.
		const before = loadEntriesFromFile(sessionFile);
		expect(before.filter((e) => e.type !== "session").length).toBeGreaterThan(0);

		// Build a fresh manager bound to the same file, clear it in place.
		const cleared = SessionManager.create(tempDir, sessionDir);
		const parent = sm.getHeader()?.parentSession;
		cleared.newSession({ id: sessionId, parentSession: parent });
		cleared.rebindAndOverwriteFile(sessionFile);

		// The file now contains only the session header.
		const after = loadEntriesFromFile(sessionFile);
		expect(after.length).toBe(1);
		expect(after[0].type).toBe("session");
		expect((after[0] as { id: string }).id).toBe(sessionId);

		// A new SessionManager loading that file sees zero messages.
		const reloaded = SessionManager.create(tempDir, sessionDir);
		reloaded.setSessionFile(sessionFile);
		expect(reloaded.getSessionId()).toBe(sessionId);
		expect(reloaded.getEntries().length).toBe(0);
		expect(reloaded.buildSessionContext().messages.length).toBe(0);
	});

	it("preserves the session id and parent link", () => {
		const sessionDir = join(tempDir, "sessions");
		mkdirSync(sessionDir, { recursive: true });
		const parentFile = join(tempDir, "parent.jsonl");
		writeFileSync(parentFile, "");

		const sm = SessionManager.create(tempDir, sessionDir);
		sm.appendMessage(userMessage("x"));
		sm.appendMessage(assistantMessage("y"));
		const sessionId = sm.getSessionId();
		const sessionFile = sm.getSessionFile()!;

		const cleared = SessionManager.create(tempDir, sessionDir);
		cleared.newSession({ id: sessionId, parentSession: parentFile });
		cleared.rebindAndOverwriteFile(sessionFile);

		const reloaded = SessionManager.create(tempDir, sessionDir);
		reloaded.setSessionFile(sessionFile);
		const header = reloaded.getHeader();
		expect(header?.id).toBe(sessionId);
		expect(header?.parentSession).toBe(parentFile);
	});

	it("is a no-op write for in-memory (non-persisted) sessions", () => {
		const sm = SessionManager.inMemory(tempDir);
		const sessionId = sm.getSessionId();
		sm.appendMessage(userMessage("x"));

		const cleared = SessionManager.inMemory(tempDir);
		cleared.newSession({ id: sessionId });
		expect(() => cleared.rebindAndOverwriteFile(join(tempDir, "in-memory.jsonl"))).not.toThrow();
	});
});

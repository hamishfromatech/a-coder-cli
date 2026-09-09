import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	clearAllBackgroundProcesses,
	completeBackgroundProcess,
	startBackgroundProcess,
} from "../src/core/stores/background-process-store.ts";

/**
 * Background-process task notifications must be scoped to the session that
 * started the process. The store is process-wide and every coexisting session
 * (parked runtimes, office coworker sessions, SDK sessions) receives its
 * events — without ownership filtering, one completion enqueued the same
 * notification in every session and each fired its own <task-notification>
 * wake turn.
 */
describe("background process notifications", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-bg-notify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		clearAllBackgroundProcesses();
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function createSession() {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.inMemory(tempDir);
		const { session } = await createAgentSession({ cwd: tempDir, agentDir, settingsManager, sessionManager });
		return session;
	}

	it("notifies the owning session exactly once per process", async () => {
		const session = await createSession();
		try {
			startBackgroundProcess("p1", "echo hi", 123, undefined, session.sessionId);
			completeBackgroundProcess("p1", 0, false);

			const notes = session.drainPendingNotifications();
			expect(notes).toHaveLength(1);
			expect(notes[0]).toContain("echo hi");
			expect(notes[0]).toContain("completed");

			// Repeated terminal events for the same id must not re-notify.
			completeBackgroundProcess("p1", 0, false);
			expect(session.drainPendingNotifications()).toHaveLength(0);
		} finally {
			session.dispose();
		}
	});

	it("does not notify coexisting sessions that did not start the process", async () => {
		const owner = await createSession();
		const bystander = await createSession();
		try {
			startBackgroundProcess("p2", "sleep 5", 456, undefined, owner.sessionId);
			completeBackgroundProcess("p2", 0, false);

			expect(owner.drainPendingNotifications()).toHaveLength(1);
			expect(bystander.drainPendingNotifications()).toHaveLength(0);
		} finally {
			owner.dispose();
			bystander.dispose();
		}
	});

	it("does not notify ownerless records (no session to wake)", async () => {
		const session = await createSession();
		try {
			startBackgroundProcess("p3", "echo anon", 789);
			completeBackgroundProcess("p3", 0, false);
			expect(session.drainPendingNotifications()).toHaveLength(0);
		} finally {
			session.dispose();
		}
	});

	it("stops notifying after dispose", async () => {
		const session = await createSession();
		session.dispose();

		startBackgroundProcess("p4", "echo gone", 101, undefined, session.sessionId);
		completeBackgroundProcess("p4", 0, false);
		expect(session.drainPendingNotifications()).toHaveLength(0);
	});
});

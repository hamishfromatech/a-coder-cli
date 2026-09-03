import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearAllBackgroundProcesses,
	completeBackgroundProcess,
	startBackgroundProcess,
} from "../../src/core/stores/background-process-store.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

/**
 * Background bash-process notifications: when a backgrounded process
 * terminates (done/error/killed), the agent must receive a
 * <task-notification> wake — same contract as detached sub-agents.
 */
describe("AgentSession background process notifications", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		clearAllBackgroundProcesses();
	});

	async function waitForWake(harness: Harness, replyText: string): Promise<void> {
		await vi.waitFor(
			() => {
				const messages = harness.session.messages;
				const last = messages[messages.length - 1];
				if (!last || last.role !== "assistant") throw new Error("wake turn did not complete");
				if (!getMessageText(last).includes(replyText)) throw new Error("wake reply not seen yet");
			},
			{ timeout: 5000 },
		);
	}

	function findWakePrompt(harness: Harness, needle: string): Extract<AgentMessage, { role: "user" }> | undefined {
		return harness.session.messages.find(
			(m): m is Extract<AgentMessage, { role: "user" }> =>
				m.role === "user" && JSON.stringify(m.content).includes(needle),
		);
	}

	it("does not wake while a process is still running", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		startBackgroundProcess("bgproc-running", "npm run dev", 4242);
		await new Promise((r) => setTimeout(r, 50));
		expect(harness.session.drainPendingNotifications()).toEqual([]);
		expect(harness.session.messages.filter((m) => m.role === "user")).toHaveLength(0);
	});

	it("notifies the agent when a background process completes while idle", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("proc ack")]);

		startBackgroundProcess("bgproc-done", "npm run dev", 4242);
		completeBackgroundProcess("bgproc-done", 0, false);

		await waitForWake(harness, "proc ack");

		const wakePrompt = findWakePrompt(harness, "npm run dev");
		expect(wakePrompt).toBeDefined();
		const text = JSON.stringify(wakePrompt?.content);
		expect(text).toContain("<task-notification>");
		expect(text).toContain("completed");
		// The wake consumed the queued notification.
		expect(harness.session.drainPendingNotifications()).toEqual([]);
	});

	it("reports killed processes and includes the exit code", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("kill ack")]);

		startBackgroundProcess("bgproc-kill", "webpack --watch", 4243);
		completeBackgroundProcess("bgproc-kill", 1, false);

		await waitForWake(harness, "kill ack");

		const wakePrompt = findWakePrompt(harness, "webpack --watch");
		expect(wakePrompt).toBeDefined();
		const text = JSON.stringify(wakePrompt?.content);
		expect(text).toContain("<task-notification>");
		expect(text).toContain("failed");
		expect(text).toContain("exit code 1");
	});

	it("does not wake for a user kill from the viewer but stamps the next submit", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		startBackgroundProcess("bgproc-userkill", "vite dev", 4246);
		// killed=true is only passed by the interactive viewer's kill action.
		completeBackgroundProcess("bgproc-userkill", undefined, true);
		await new Promise((r) => setTimeout(r, 80));

		// No wake turn: no assistant reply, notification stays queued.
		expect(harness.session.messages.some((m) => m.role === "assistant")).toBe(false);
		const notes = harness.session.drainPendingNotifications();
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("vite dev");
		expect(notes[0]).toContain("was killed");
	});

	it("does not wake when a sub-agent is killed via killSubAgent", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("bg reply")]);

		const { id } = harness.session.runSubAgentBackground({ id: "bg-kill-gate", prompt: "x", maxTurns: 5 });
		harness.session.killSubAgent(id, "user");
		await harness.session.waitSubAgent(id);
		await new Promise((r) => setTimeout(r, 100));

		// No wake turn, but the note is queued for the next submission.
		expect(harness.session.messages.filter((m) => m.role === "user")).toHaveLength(0);
		const notes = harness.session.drainPendingNotifications();
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("bg-kill-gate");
	});

	it("batches multiple terminations into one wake turn", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("batch ack")]);

		startBackgroundProcess("bgproc-a", "make build", 4244);
		startBackgroundProcess("bgproc-b", "make test", 4245);
		completeBackgroundProcess("bgproc-a", 0, false);
		completeBackgroundProcess("bgproc-b", 0, false);

		await waitForWake(harness, "batch ack");

		const wakePrompt = findWakePrompt(harness, "make build");
		expect(wakePrompt).toBeDefined();
		const text = JSON.stringify(wakePrompt?.content);
		expect(text).toContain("make build");
		expect(text).toContain("make test");
		// Exactly one wake turn for both notifications.
		const wakePrompts = harness.session.messages.filter(
			(m) => m.role === "user" && JSON.stringify(m.content).includes("<task-notification>"),
		);
		expect(wakePrompts).toHaveLength(1);
	});
});

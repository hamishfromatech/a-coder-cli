import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const THINKING_RANK = ["off", "minimal", "low", "medium", "high", "xhigh"];

describe("thinking keyword escalation", () => {
	const tempDir = join(tmpdir(), `pi-think-escalation-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	async function createSession() {
		const settingsManager = SettingsManager.inMemory({});
		const sessionManager = SessionManager.inMemory();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: join(tempDir, "agent"),
			model: getModel("anthropic", "claude-sonnet-4-5")!, // reasoning: true, no xhigh mapping
			settingsManager,
			sessionManager,
		});
		return session;
	}

	it("ultrathink raises to the highest supported level", async () => {
		const session = await createSession();
		const newLevel = session.applyThinkingEscalation("Please ultrathink about this migration.");
		expect(session.thinkingLevel).toBe(session.getAvailableThinkingLevels().at(-1));
		expect(newLevel).toBe(session.thinkingLevel);
		session.dispose();
	});

	it("escalation keywords raise monotonically and never lower", async () => {
		const session = await createSession();
		const startingRank = THINKING_RANK.indexOf(session.thinkingLevel);
		const first = session.applyThinkingEscalation("think hard about the tradeoffs");
		// From a low default this raises to at least medium; if already at/above it, no-op.
		if (startingRank < THINKING_RANK.indexOf("medium")) {
			expect(THINKING_RANK.indexOf(first ?? "off")).toBeGreaterThanOrEqual(THINKING_RANK.indexOf("medium"));
		} else {
			expect(first).toBeUndefined();
		}
		const raised = session.applyThinkingEscalation("ultrathink the whole thing");
		expect(session.thinkingLevel).toBe(session.getAvailableThinkingLevels().at(-1));
		expect(raised).toBe(session.thinkingLevel);
		// Already at the top: another escalation is a no-op.
		expect(session.applyThinkingEscalation("ultrathink again")).toBeUndefined();
		session.dispose();
	});

	it("ignores prompts without escalation keywords", async () => {
		const session = await createSession();
		expect(session.applyThinkingEscalation("just fix the typo in utils.ts")).toBeUndefined();
		session.dispose();
	});
});

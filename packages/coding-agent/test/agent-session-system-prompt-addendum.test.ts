import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

describe("AgentSession system-prompt addendum", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-addendum-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function createSession() {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model,
			settingsManager,
			sessionManager,
			authStorage,
			resourceLoader,
		});
		return { session };
	}

	it("composes the addendum on top of the base system prompt and clears on null", async () => {
		const { session } = await createSession();

		const base = session.agent.state.systemPrompt;
		const addendum = "You are on a live voice call. Keep answers short.";
		session.setSystemPromptAddendum(addendum);

		const composed = session.agent.state.systemPrompt;
		expect(composed.startsWith(`${base}\n\n${addendum}`)).toBe(true);

		// A rebuild resets the live prompt to the base; the addendum is
		// recomposed at the next run, so a rebuild must not concatenate it
		// twice into _baseSystemPrompt.
		session.rebuildSystemPrompt();
		expect(session.agent.state.systemPrompt).toBe(base);

		// Setting again after a rebuild recomposes immediately.
		session.setSystemPromptAddendum(addendum);
		expect(session.agent.state.systemPrompt.startsWith(`${base}\n\n${addendum}`)).toBe(true);

		// Clearing restores the exact base prompt.
		session.setSystemPromptAddendum(null);
		expect(session.agent.state.systemPrompt).toBe(base);

		// Whitespace-only addenda are treated as empty.
		session.setSystemPromptAddendum("   \n\t  ");
		expect(session.agent.state.systemPrompt).toBe(base);
	});
});

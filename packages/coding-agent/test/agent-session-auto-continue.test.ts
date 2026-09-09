import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

describe("AgentSession auto-continue on output-token truncation", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-auto-continue-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

		return { session, sessionManager };
	}

	it("auto-continues when the model hits the output token limit", async () => {
		const { session } = await createSession();

		const truncatedMessage = fauxAssistantMessage(
			'<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>About the NDIS | Mackay Connect</title>\n  <meta name="description" content="Understanding how Mack',
			{ stopReason: "length" },
		);
		const doneMessage = fauxAssistantMessage(
			'ay Connect works within the NDIS framework — residential care, provider verification, and participant support in Mackay and beyond.">\n</head>\n<body>\n</body>\n</html>',
		);

		let callCount = 0;
		session.agent.streamFn = () => {
			const stream = createAssistantMessageEventStream();
			const message = callCount++ === 0 ? truncatedMessage : doneMessage;
			queueMicrotask(() => {
				stream.push({ type: "done", reason: message === truncatedMessage ? "length" : "stop", message });
			});
			return stream;
		};

		const followUpSpy = vi.spyOn(session.agent, "followUp");

		await session.prompt("write ndis.html for Mackay Connect");

		expect(callCount).toBe(2);
		expect(followUpSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "user",
				content: [
					{
						type: "text",
						text: "You were cut off due to the output token limit. Please continue exactly where you left off. Do not repeat what you already wrote.",
					},
				],
			}),
		);

		session.dispose();
	});

	it("never nudges after a normal stop — replies that merely promise action stay untouched", async () => {
		const { session } = await createSession();

		const planningMessage = fauxAssistantMessage(
			"I can see you already have a strong foundation. The main missing piece is the search page. Let me build that now.",
		);

		session.agent.streamFn = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: planningMessage });
			});
			return stream;
		};

		const followUpSpy = vi.spyOn(session.agent, "followUp");

		await session.prompt("build the organisations page for Mackay Connect");

		expect(followUpSpy).not.toHaveBeenCalled();

		session.dispose();
	});
});

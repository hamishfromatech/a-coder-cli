import { type AssistantMessage, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

function createUsage(input: number, output: number) {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

describe("post-run overflow compaction retry", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("retries after overflow compaction without throwing Cannot continue from message role: assistant", async () => {
		const harness = await createHarness({
			models: [{ id: "faux-1", contextWindow: 100, maxTokens: 100 }],
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "overflow retry summary",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					}));
				},
			],
		});
		harnesses.push(harness);

		const model = harness.getModel();
		// First response: length-stop (recoverable) overflow. willRetry is true
		// because stopReason !== "stop". recoverableLength holds since output < maxTokens.
		const lengthStopAssistant: AssistantMessage = {
			...fauxAssistantMessage("partial response that was cut off", { stopReason: "length" }),
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: createUsage(100, 50),
		};
		// Second response: the successful retry result.
		const retryAssistant = fauxAssistantMessage("completed response after retry");
		harness.setResponses([lengthStopAssistant, retryAssistant]);

		// Should not throw "Cannot continue from message role: assistant".
		await expect(harness.session.prompt("do something")).resolves.toBeUndefined();

		expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
			reason: "overflow",
			aborted: false,
			willRetry: true,
		});
		// The retry turn ran (faux was called twice: initial + retry).
		expect(harness.faux.state.callCount).toBe(2);
	});
});

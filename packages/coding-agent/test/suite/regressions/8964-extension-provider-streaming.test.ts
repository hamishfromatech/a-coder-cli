import type { AssistantMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

describe("#8964 model registry streaming for extensions", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("streams through the registry with request-time auth resolved", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("streamed reply")]);

		const model = harness.getModel();
		const stream = await harness.session.modelRegistry.streamSimple(model, {
			systemPrompt: "",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
		});
		const result = (await stream.result()) as AssistantMessage;

		expect(result.stopReason).toBe("stop");
		expect(result.content.find((c) => c.type === "text")?.text).toBe("streamed reply");
	});

	it("surfaces setup failures as error events instead of throwing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const model = harness.getModel();
		// Point the model at a provider without configured credentials.
		const unauthed = { ...model, provider: "no-such-provider" };
		const stream = await harness.session.modelRegistry.streamSimple(unauthed, {
			systemPrompt: "",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
		});

		// The setup failure must not throw; it flows through the stream.
		const events = [];
		for await (const event of stream) {
			events.push(event);
		}
		const errorEvent = events.at(-1) as { type: string; error?: { errorMessage?: string } };
		expect(errorEvent.type).toBe("error");
		expect(errorEvent.error?.errorMessage).toBeTruthy();
	});

	it("is reachable from the extension context registry", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("extension streamed")]);

		// The extension context exposes the same ModelRegistry instance the
		// session streams through — the new methods are on the prototype.
		const registry = harness.session.modelRegistry;
		expect(typeof registry.stream).toBe("function");
		expect(typeof registry.streamSimple).toBe("function");

		const model = harness.getModel();
		const stream = await registry.stream(model, {
			systemPrompt: "",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
		});
		const result = (await stream.result()) as AssistantMessage;

		expect(result.content.find((c) => c.type === "text")?.text).toBe("extension streamed");
	});
});

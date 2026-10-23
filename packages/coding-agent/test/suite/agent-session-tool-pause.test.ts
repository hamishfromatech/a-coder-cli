import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
});

function echoTool(): AgentTool {
	return {
		name: "echo",
		label: "Echo",
		description: "Echo text back",
		parameters: Type.Object({ text: Type.String() }),
		execute: async (_toolCallId, params) => {
			const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
			return { content: [{ type: "text", text: `echo:${text}` }], details: { text } };
		},
	};
}

describe("AgentSession tool-pause auto-continue", () => {
	it("nudges an empty assistant turn after a tool result in smart mode", async () => {
		const harness = await createHarness({
			tools: [echoTool()],
			settings: {
				autoContinue: {
					mode: "smart",
					provider: "definitely-missing-provider",
					model: "definitely-missing-model",
				},
			},
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "hello" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("", { stopReason: "stop" }),
			fauxAssistantMessage("finished after the empty tool turn"),
		]);

		await harness.session.prompt("run the tool");

		const messages = harness.session.messages;
		expect(messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"user",
			"assistant",
		]);
		expect(getMessageText(messages[messages.length - 1]!)).toBe("finished after the empty tool turn");
		const decisions = harness.eventsOfType("auto_continue_decision");
		expect(decisions.some((event) => event.checkpoint === "tool_pause" && event.action === "continue")).toBe(true);
	});
});

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { messageKey } from "./message-key";

const user = (timestamp: number, text: string) =>
	({ role: "user", content: [{ type: "text", text }], timestamp }) as unknown as AgentMessage;

describe("messageKey", () => {
	it("keys tool results by tool call id", () => {
		expect(messageKey({ role: "toolResult", toolCallId: "t1" } as unknown as AgentMessage)).toBe("tool:t1");
	});

	it("keeps the streaming assistant key stable across content updates", () => {
		const first = {
			role: "assistant",
			timestamp: 10,
			responseId: "r1",
			content: [{ type: "text", text: "Hello" }],
		} as unknown as AgentMessage;
		const second = {
			...first,
			content: [{ type: "text", text: "Hello world" }],
		} as unknown as AgentMessage;
		expect(messageKey(first)).toBe(messageKey(second));
	});

	it("does not change when older messages are prepended", () => {
		const old = user(1, "old");
		const recent = user(2, "recent");
		const before = [recent].map(messageKey);
		const after = [old, recent].map(messageKey);
		expect(after[1]).toBe(before[0]);
	});
});

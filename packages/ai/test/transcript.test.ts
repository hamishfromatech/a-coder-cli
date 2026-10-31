import { describe, expect, it } from "vitest";
import type { Context, SystemMessage, Tool, TranscriptContext } from "../src/types.ts";
import {
	collapseSystemMessages,
	declarationsEqual,
	getCurrentTools,
	normalizeContext,
	resolveTranscript,
	toToolDeclaration,
} from "../src/utils/transcript.ts";

const tool = (name: string, description = "does things"): Tool => ({
	name,
	description,
	parameters: { type: "object", properties: {} } as Tool["parameters"],
});

describe("durable transcript helpers", () => {
	it("folds a request Context into a leading system message", () => {
		const context: Context = {
			systemPrompt: "You are helpful.",
			tools: [tool("bash")],
			messages: [{ role: "user", content: "hi", timestamp: 1 }],
		};
		const transcript = normalizeContext(context);
		const head = transcript.messages[0] as SystemMessage;
		expect(head.role).toBe("system");
		expect(head.content).toBe("You are helpful.");
		expect(head.toolsAdded?.map((t) => t.name)).toEqual(["bash"]);
		expect(transcript.messages).toHaveLength(2);
	});

	it("returns an empty transcript when there is no prompt and no tools", () => {
		const transcript = normalizeContext({ messages: [] });
		expect(transcript.messages).toHaveLength(0);
	});

	it("replays tool additions and removals", () => {
		const messages = [
			{ role: "system", content: "", toolsAdded: [tool("bash"), tool("read")], timestamp: 0 } as SystemMessage,
			{ role: "system", content: "", toolsRemoved: [{ name: "bash" }], timestamp: 1 } as SystemMessage,
		];
		expect(getCurrentTools(messages).map((t) => t.name)).toEqual(["read"]);
	});

	it("compares declarations structurally, ignoring non-interface fields", () => {
		const a = { ...tool("bash"), execute: () => undefined } as unknown as Tool;
		const b = tool("bash");
		expect(declarationsEqual(a, b)).toBe(true);
		expect(declarationsEqual(a, tool("bash", "different"))).toBe(false);
		expect(toToolDeclaration(a)).not.toHaveProperty("execute");
	});

	it("collapses mid-conversation system messages when the transport cannot take them", () => {
		const transcript = {
			messages: [
				{ role: "system", content: "base", timestamp: 0 } as SystemMessage,
				{ role: "user", content: "hi", timestamp: 1 },
				{ role: "system", content: "later note", timestamp: 2 } as SystemMessage,
			],
		} as unknown as TranscriptContext;
		const resolved = resolveTranscript(transcript, false);
		expect(resolved.messages.filter((m) => m.role === "system")).toHaveLength(1);
		expect((resolved.messages[0] as SystemMessage).content).toBe("base\n\nlater note");
		const collapsed = collapseSystemMessages(transcript);
		expect(collapsed.messages).toHaveLength(2);
	});
});

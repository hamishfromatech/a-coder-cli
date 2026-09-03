import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function createAssistantMessage(
	content: AssistantMessage["content"],
	overrides: Partial<Pick<AssistantMessage, "stopReason">> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: overrides.stopReason ?? "stop",
		timestamp: Date.now(),
	};
}

describe("AssistantMessageComponent", () => {
	test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		component.flush();
		const lines = component.render(40);

		expect(lines).not.toHaveLength(0);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
			]),
		);
		component.flush();
		const rendered = component.render(60).join("\n");

		expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
	});

	test("renders length stops as visible errors", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: "private reasoning" }], { stopReason: "length" }),
			true,
		);
		component.flush();
		const rendered = component.render(80).join("\n");

		expect(rendered).toContain("Thinking...");
		expect(rendered).toContain("Response was truncated before completion.");
	});

	test("uses configured output padding for text and thinking", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "hello" },
				{ type: "thinking", thinking: "reasoning" },
			]),
			false,
			undefined,
			"Thinking...",
			1,
		);
		component.flush();
		const lines = component.render(80).map((line) => stripAnsi(line));

		expect(lines.some((line) => line.includes(" hello"))).toBe(true);
		expect(lines.some((line) => line.includes(" reasoning"))).toBe(true);

		component.setOutputPad(0);
		const updatedLines = component.render(80).map((line) => stripAnsi(line));
		expect(updatedLines.some((line) => line.startsWith("hello"))).toBe(true);
		expect(updatedLines.some((line) => line.startsWith("reasoning"))).toBe(true);
	});

	test("uses configured output padding for user messages", () => {
		initTheme("dark");

		const paddedComponent = new UserMessageComponent("hello", undefined, 1);
		const paddedLines = paddedComponent.render(40).map((line) => stripAnsi(line));
		expect(paddedLines.some((line) => line.startsWith(" hello"))).toBe(true);

		const unpaddedComponent = new UserMessageComponent("hello", undefined, 0);
		const unpaddedLines = unpaddedComponent.render(40).map((line) => stripAnsi(line));
		expect(unpaddedLines.some((line) => line.startsWith("hello"))).toBe(true);
	});
});

describe("AssistantMessageComponent fold past thinking", () => {
	test("folded message renders no thinking trace; unfolded renders it", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "thinking", thinking: "secret reasoning trace" },
			{ type: "text", text: "visible answer" },
		]);

		const folded = new AssistantMessageComponent(message);
		folded.setFoldPastThinking(true);
		folded.flush();
		const foldedLines = stripAnsi(folded.render(60).join("\n"));
		expect(foldedLines).not.toContain("secret reasoning trace");
		expect(foldedLines).toContain("visible answer");

		const unfolded = new AssistantMessageComponent(message);
		unfolded.flush();
		const unfoldedLines = stripAnsi(unfolded.render(60).join("\n"));
		expect(unfoldedLines).toContain("secret reasoning trace");
	});

	test("setFoldPastThinking(false) restores the trace on a folded component", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "thinking", thinking: "earlier round reasoning" },
			{ type: "text", text: "answer" },
		]);
		const component = new AssistantMessageComponent(message);
		component.setFoldPastThinking(true);
		component.flush();
		expect(stripAnsi(component.render(60).join("\n"))).not.toContain("earlier round reasoning");

		component.setFoldPastThinking(false);
		component.flush();
		expect(stripAnsi(component.render(60).join("\n"))).toContain("earlier round reasoning");
	});

	test("getMessage returns the rendered message; global hide-thinking still wins", () => {
		initTheme("dark");
		const message = createAssistantMessage([
			{ type: "thinking", thinking: "hidden by setting" },
			{ type: "text", text: "answer" },
		]);
		const component = new AssistantMessageComponent(message);
		component.flush();
		expect(component.getMessage()).toBe(message);

		component.setHideThinkingBlock(true);
		component.flush();
		// The global setting hides thinking even when unfolding is requested.
		component.setFoldPastThinking(false);
		component.flush();
		expect(stripAnsi(component.render(60).join("\n"))).not.toContain("hidden by setting");
	});
});

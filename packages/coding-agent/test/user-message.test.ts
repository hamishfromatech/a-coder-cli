import { describe, expect, test } from "vitest";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const BG_RESET = "\x1b[49m";

describe("UserMessageComponent", () => {
	test("keeps user message height stable while moving closing OSC markers off line end", () => {
		initTheme("dark");

		const component = new UserMessageComponent("hello");
		const lines = component.render(20);

		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[0].endsWith(BG_RESET)).toBe(true);
		expect(lines[0]).not.toContain(OSC133_ZONE_END);
		expect(lines[1]).toContain("hello");
		expect(lines[2].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
		expect(lines[2].endsWith(BG_RESET)).toBe(true);
	});
});

describe("UserMessageComponent task-notification pills", () => {
	test("renders a stamped background-process note as a pill above the user text", () => {
		initTheme("dark");
		const note = [
			"Background process `npm test` completed (exit code 0) after 3.2s",
			"12 lines · 45.3KB",
			"Output tail:",
			"  all tests passed",
			"Full output: /tmp/out.log",
		].join("\n");
		const component = new UserMessageComponent(`${note}\n\nfix the bug`);
		const lines = component.render(100);
		const text = lines.join("\n");
		// Pill: one compact line, glyph + header only.
		expect(text).toContain("npm test` completed (exit code 0) after 3.2s");
		expect(text).not.toContain("Output tail:");
		expect(text).not.toContain("Full output:");
		expect(text).not.toContain("12 lines");
		// User text still renders in the bubble.
		expect(text).toContain("fix the bug");
	});

	test("renders the wake turn as pills only, without boilerplate", () => {
		initTheme("dark");
		const text = [
			"<task-notification>",
			'[Background subagent "explore" (general-purpose) completed, 4200 tokens, 7 tool uses, 3 turns, 12.3s]\nFinal report body…',
			"</task-notification>",
			"Background task results above — report the findings to the user in your reply.",
		].join("\n\n");
		const component = new UserMessageComponent(text);
		const lines = component.render(140);
		const stripped = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
		expect(stripped).toContain(
			'[Background subagent "explore" (general-purpose) completed, 4200 tokens, 7 tool uses, 3 turns, 12.3s]',
		);
		expect(stripped).not.toContain("Background task results above");
		expect(stripped).not.toContain("Final report body");
	});

	test("plain user text is unchanged (no pill false positives)", () => {
		initTheme("dark");
		const component = new UserMessageComponent("Background reading is fun\n\nmore text");
		const lines = component.render(60);
		expect(lines.join("\n")).toContain("Background reading is fun");
		expect(lines.join("\n")).toContain("more text");
	});
});

describe("UserMessageComponent task-notification pills (real formats)", () => {
	test("stamped bracketed subagent note renders as a pill", () => {
		initTheme("dark");
		const note = [
			'[Background subagent "pill2" (general-purpose) completed, 30785 tokens, 1 turns, 2.4s]',
			"PILL2-DONE",
			"Full transcript: /tmp/tasks/pill2.output",
		].join("\n");
		const component = new UserMessageComponent(`${note}\n\nsay ok`);
		const lines = component.render(120);
		const stripped = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
		expect(stripped).toContain(
			'[Background subagent "pill2" (general-purpose) completed, 30785 tokens, 1 turns, 2.4s]',
		);
		expect(stripped).not.toContain("Full transcript:");
		expect(stripped).toContain("say ok");
	});

	test("unrecognized wake wrapper is never swallowed", () => {
		initTheme("dark");
		const text = [
			"<task-notification>",
			"something unfamiliar entirely",
			"</task-notification>",
			"Background task results above — report the findings to the user in your reply.",
		].join("\n\n");
		const component = new UserMessageComponent(text);
		const lines = component.render(120);
		const stripped = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
		expect(stripped).toContain("something unfamiliar entirely");
	});
});

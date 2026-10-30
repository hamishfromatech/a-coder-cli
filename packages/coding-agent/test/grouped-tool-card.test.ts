import { Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { beforeAll, describe, expect, test } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { GroupedToolCardComponent, isCollapsibleTool } from "../src/modes/interactive/components/grouped-tool-card.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as unknown as TUI;
}

function simpleDefinition(name: string): ToolDefinition {
	return {
		name,
		label: name,
		description: name,
		parameters: Type.Any(),
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
		renderCall: () => new Text(`call:${name}`, 0, 0),
		renderResult: (_result, options) => new Text(options.expanded ? `full:${name}` : `preview:${name}`, 0, 0),
	};
}

describe("GroupedToolCard", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("classifies collapsible tools", () => {
		expect(isCollapsibleTool("read")).toBe(true);
		expect(isCollapsibleTool("bash")).toBe(false);
	});

	test("collapses members into a summary, expands back into them", () => {
		const a = new ToolExecutionComponent(
			"read",
			"id-a",
			{},
			{},
			simpleDefinition("read"),
			createFakeTui(),
			process.cwd(),
		);
		const b = new ToolExecutionComponent(
			"ls",
			"id-b",
			{},
			{},
			simpleDefinition("ls"),
			createFakeTui(),
			process.cwd(),
		);
		a.updateResult({ content: [{ type: "text", text: "a" }], details: {}, isError: false });
		b.updateResult({ content: [{ type: "text", text: "b" }], details: {}, isError: false });

		const group = new GroupedToolCardComponent(
			[
				{ toolName: "read", target: "a.ts" },
				{ toolName: "ls", target: "." },
			],
			[a, b],
		);

		const collapsed = stripAnsi(group.render(120).join("\n"));
		expect(collapsed).toContain("Read 1 file");
		expect(collapsed).toContain("Listed 1 directory");
		// The target preview lists the files searched.
		expect(collapsed).toContain("a.ts");

		group.setExpanded(true);
		const expanded = stripAnsi(group.render(120).join("\n"));
		expect(expanded).toContain("call:read");
		expect(expanded).toContain("call:ls");
		// Members render expanded with the group.
		expect(expanded).toContain("full:read");

		group.setExpanded(false);
		expect(stripAnsi(group.render(120).join("\n"))).toContain("Read 1 file");
	});

	test("absorbs later collapsible cards into an existing group", () => {
		const a = new ToolExecutionComponent(
			"read",
			"id-a2",
			{},
			{},
			simpleDefinition("read"),
			createFakeTui(),
			process.cwd(),
		);
		const c = new ToolExecutionComponent(
			"grep",
			"id-c",
			{},
			{},
			simpleDefinition("grep"),
			createFakeTui(),
			process.cwd(),
		);
		a.updateResult({ content: [{ type: "text", text: "a" }], details: {}, isError: false });
		c.updateResult({ content: [{ type: "text", text: "c" }], details: {}, isError: false });

		const group = new GroupedToolCardComponent([{ toolName: "read", target: "a.ts" }], [a]);
		group.absorb([{ toolName: "grep", target: '"pattern"' }], [c]);

		const collapsed = stripAnsi(group.render(120).join("\n"));
		expect(collapsed).toContain("Read 1 file");
		expect(collapsed).toContain("Searched 1 pattern");
	});
});

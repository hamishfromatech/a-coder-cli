import { beforeAll, describe, expect, it } from "vitest";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { createFindToolDefinition } from "../src/core/tools/find.ts";
import { createGrepToolDefinition } from "../src/core/tools/grep.ts";
import { createLsToolDefinition } from "../src/core/tools/ls.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import {
	diffStats,
	formatHeadline,
	formatPreviewResult,
	moreLinesFooter,
	resultGlyph,
} from "../src/core/tools/result-headline.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => {
	initTheme("dark", false);
});

const CW = 120;

/** Tool result literal with a narrowed TextContent type. */
const textResult = (text: string, details?: object) => ({
	content: [{ type: "text" as const, text }],
	details,
});

describe("result-headline helpers", () => {
	it("colors the outcome glyph by outcome", () => {
		expect(resultGlyph("success", theme)).toContain("✓");
		expect(resultGlyph("error", theme)).toContain("✗");
		expect(resultGlyph("success", theme)).not.toEqual(resultGlyph("error", theme));
	});

	it("formats a headline with stats", () => {
		expect(formatHeadline("success", theme, "40 lines")).toContain("40 lines");
		expect(formatHeadline("error", theme, "exit 1 · 3.4s")).toContain("exit 1");
	});

	it("counts unified-diff patch lines", () => {
		const stats = diffStats("--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,4 @@\n-old\n+new1\n+new2\n context\n+new3");
		expect(stats).toEqual({ added: 3, removed: 1 });
	});

	it("renders the unified more-footer", () => {
		const footer = moreLinesFooter(theme, 37, "lines");
		expect(footer).toContain("37 more lines");
		expect(footer).toContain("to expand");
		const earlier = moreLinesFooter(theme, 2, "lines", { earlier: true });
		expect(earlier).toContain("2 earlier lines");
	});

	it("renders the collapsed generic preview block", () => {
		const block = formatPreviewResult(["a", "b", "c", "d", "e"], false, theme);
		expect(block).toContain("5 lines");
		expect(block).toContain("a");
		expect(block).not.toContain("\n  e");
		expect(block).toContain("2 more lines");
		const errorBlock = formatPreviewResult(["boom"], true, theme);
		expect(errorBlock).not.toContain("lines");
	});
});

describe("read result headline", () => {
	const def = createReadToolDefinition("/tmp");
	const result = textResult(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n"), {
		truncation: { truncated: true, truncatedBy: "lines", outputLines: 10, totalLines: 40, maxLines: 10 },
	});

	it("collapsed shows headline with total line count and a 3-line preview", () => {
		const text = def.renderResult!(result, { expanded: false, isPartial: false }, theme, {} as any)
			.render(CW)
			.join("\n");
		expect(text).toContain("✓");
		expect(text).toContain("40 lines");
		expect(text).toContain("line 3");
		expect(text).not.toContain("line 4:");
		expect(text).toContain("37 more lines");
		// Tool-level truncation note stays visible.
		expect(text).toContain("Truncated: showing 10 of 40 lines");
	});

	it("collapsed reports the displayed count when nothing was truncated", () => {
		const text = def.renderResult!(textResult("a\nb\nc"), { expanded: false, isPartial: false }, theme, {} as any)
			.render(CW)
			.join("\n");
		expect(text).toContain("3 lines");
		expect(text).not.toContain("more lines");
	});

	it("expanded keeps the full content", () => {
		const text = def.renderResult!(result, { expanded: true, isPartial: false }, theme, {} as any)
			.render(CW)
			.join("\n");
		expect(text).toContain("line 40");
	});
});

describe("grep result headline", () => {
	const def = createGrepToolDefinition("/tmp");

	it("counts matches and files from file:line output", () => {
		const text = def.renderResult!(
			textResult(
				"src/a.ts:1: alpha\nsrc/a.ts:5: beta\nsrc/b.ts:2: gamma\nsrc/b.ts:9: delta\nsrc/b.ts:11: epsilon\nsrc/b.ts:14: zeta",
				{},
			),
			{ expanded: false, isPartial: false },
			theme,
			{} as any,
		)
			.render(CW)
			.join("\n");
		expect(text).toContain("6 matches in 2 files");
		expect(text).toContain("src/a.ts:1: alpha");
		expect(text).toContain("3 more matches");
	});

	it("reports no matches with a headline", () => {
		const text = def.renderResult!(textResult(""), { expanded: false, isPartial: false }, theme, {} as any)
			.render(CW)
			.join("\n");
		expect(text).toContain("no matches");
	});
});

describe("ls and find result headlines", () => {
	it("ls counts entries", () => {
		const def = createLsToolDefinition("/tmp");
		const text = def.renderResult!(
			textResult("a.ts\nb.ts\nc.ts\nd.ts\ne.ts", {}),
			{ expanded: false, isPartial: false },
			theme,
			{} as any,
		)
			.render(CW)
			.join("\n");
		expect(text).toContain("5 entries");
		expect(text).toContain("2 more entries");
	});

	it("find counts results", () => {
		const def = createFindToolDefinition("/tmp");
		const text = def.renderResult!(
			textResult("x.ts\ny.ts", {}),
			{ expanded: false, isPartial: false },
			theme,
			{} as any,
		)
			.render(CW)
			.join("\n");
		expect(text).toContain("2 results");
	});
});

describe("bash result headline", () => {
	const def = createBashToolDefinition("/tmp");

	it("success headline carries duration, no separate Took line", () => {
		const component = def.renderResult!(textResult("ok"), { expanded: false, isPartial: false }, theme, {
			state: { startedAt: Date.now() - 1500, endedAt: Date.now() },
			isError: false,
		} as any);
		const text = component.render(CW).join("\n");
		expect(text).toContain("✓");
		expect(text).toMatch(/\d+\.\d?s/);
		expect(text).not.toContain("Took");
	});

	it("error headline carries the exit code", () => {
		const component = def.renderResult!(
			textResult("boom\nCommand exited with code 2", { stderr: "boom" }),
			{ expanded: false, isPartial: false },
			theme,
			{
				state: { startedAt: Date.now() - 1500, endedAt: Date.now() },
				isError: true,
			} as any,
		);
		const text = component.render(CW).join("\n");
		expect(text).toContain("✗");
		expect(text).toContain("exit 2");
	});
});

describe("mcp fallback result rendering", () => {
	const fakeTui = { requestRender: () => {} } as any;

	function renderFallback(output: string, isError: boolean): string {
		const component = new ToolExecutionComponent(
			"mcp__server__tool",
			"tool-1",
			{},
			{},
			{
				name: "mcp__server__tool",
				label: "tool",
				description: "mcp tool",
				parameters: undefined,
				execute: async () => ({ content: [{ type: "text" as const, text: output }], details: {} }),
			} as any,
			fakeTui,
			"/tmp",
		);
		component.markExecutionStarted();
		component.updateResult({ content: [{ type: "text", text: output }], details: {}, isError }, false);
		return stripAnsi(component.render(120).join("\n"));
	}

	it("collapsed shows headline + 3-line preview instead of the dump", () => {
		const output = Array.from({ length: 12 }, (_, i) => `row ${i}`).join("\n");
		const rendered = renderFallback(output, false);
		expect(rendered).toContain("✓");
		expect(rendered).toContain("12 lines");
		expect(rendered).toContain("row 2");
		expect(rendered).not.toContain("row 3");
		expect(rendered).toContain("9 more lines");
	});

	it("expanded shows the full output", () => {
		const output = Array.from({ length: 12 }, (_, i) => `row ${i}`).join("\n");
		const component = new ToolExecutionComponent(
			"mcp__server__tool",
			"tool-1",
			{},
			{},
			{
				name: "mcp__server__tool",
				label: "tool",
				description: "mcp tool",
				parameters: undefined,
				execute: async () => ({ content: [{ type: "text" as const, text: output }], details: {} }),
			} as any,
			fakeTui,
			"/tmp",
		);
		component.markExecutionStarted();
		component.updateResult({ content: [{ type: "text", text: output }], details: {}, isError: false }, false);
		component.setExpanded(true);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("row 11");
	});

	it("error fallback renders the error body", () => {
		const rendered = renderFallback("tool call failed: boom", true);
		expect(rendered).toContain("✗");
		expect(rendered).toContain("tool call failed: boom");
	});
});

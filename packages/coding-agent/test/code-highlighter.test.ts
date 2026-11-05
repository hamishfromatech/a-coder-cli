import { beforeEach, describe, expect, it } from "vitest";
import { CodeHighlighter, initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("CodeHighlighter", () => {
	beforeEach(() => initTheme("dark"));

	it("reuses the highlighted lines while the code and language are unchanged", () => {
		const highlighter = new CodeHighlighter();
		const first = highlighter.highlight("const x = 1;", "ts");
		const second = highlighter.highlight("const x = 1;", "ts");
		expect(second).toBe(first);
	});

	it("recomputes when the code or language changes", () => {
		const highlighter = new CodeHighlighter();
		const first = highlighter.highlight("const x = 1;", "ts");
		expect(highlighter.highlight("const y = 2;", "ts")).not.toBe(first);
		expect(highlighter.highlight("const x = 1;", "js")).not.toBe(first);
	});

	it("returns lines for unknown languages without throwing", () => {
		const highlighter = new CodeHighlighter();
		expect(highlighter.highlight("plain text", "not-a-language").length).toBe(1);
	});
});

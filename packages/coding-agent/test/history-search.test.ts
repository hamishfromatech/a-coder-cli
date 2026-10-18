import { describe, expect, it } from "vitest";
import { HistorySearchComponent } from "../src/modes/interactive/components/history-search.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

function render(component: HistorySearchComponent): string {
	return component.render(120).join("\n");
}

describe("HistorySearchComponent", () => {
	it("lists every prompt, most recent first", () => {
		const component = new HistorySearchComponent(
			["fix the router", "deploy staging", "update docs"],
			() => {},
			() => {},
		);
		const output = render(component);
		expect(output).toContain("Search history");
		expect(output).toContain("fix the router");
		expect(output).toContain("deploy staging");
		expect(output.indexOf("fix the router")).toBeLessThan(output.indexOf("deploy staging"));
	});

	it("filters as you type and inserts the selection on Enter", () => {
		const picked: string[] = [];
		const component = new HistorySearchComponent(
			["fix the router", "deploy staging", "fix the router tests"],
			(text) => void picked.push(text),
			() => {},
		);
		for (const char of "rout") component.handleInput(char);
		const output = render(component);
		expect(output).toContain("fix the router");
		expect(output).not.toContain("deploy staging");
		expect(output).toContain("2 matches");
		component.handleInput("\r");
		expect(picked).toHaveLength(1);
		expect(picked[0]).toBe("fix the router");
	});

	it("moves the selection with the arrow keys", () => {
		const picked: string[] = [];
		const component = new HistorySearchComponent(
			["first prompt", "second prompt"],
			(text) => void picked.push(text),
			() => {},
		);
		component.handleInput("\x1b[B");
		component.handleInput("\r");
		expect(picked[0]).toBe("second prompt");
	});

	it("escapes and empty-backspace cancel", () => {
		let cancelled = 0;
		const component = new HistorySearchComponent(
			["one"],
			() => {},
			() => void cancelled++,
		);
		component.handleInput("\x1b");
		expect(cancelled).toBe(1);
		component.handleInput("\x7f");
		expect(cancelled).toBe(2);
	});

	it("backspaces out of a query without cancelling", () => {
		let cancelled = 0;
		const component = new HistorySearchComponent(
			["alpha", "beta"],
			() => {},
			() => void cancelled++,
		);
		component.handleInput("b");
		component.handleInput("\x7f");
		expect(cancelled).toBe(0);
		expect(render(component)).toContain("alpha");
	});
});

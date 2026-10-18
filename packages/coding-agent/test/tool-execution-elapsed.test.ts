import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

function makeTui(): TUI {
	return {
		requestRender: () => {},
		terminal: { rows: 24, columns: 100 },
	} as unknown as TUI;
}

describe("ToolExecutionComponent elapsed timer", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows elapsed time once a tool has run for over a second", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const component = new ToolExecutionComponent(
			"read",
			"call-1",
			{ file_path: "src/index.ts" },
			{},
			undefined,
			makeTui(),
			process.cwd(),
		);

		component.markExecutionStarted();
		const atStart = component.render(100).join("\n");
		expect(atStart).toContain("read");
		expect(atStart).not.toContain("·");

		vi.setSystemTime(new Date("2026-01-01T00:00:02.400Z"));
		const later = component.render(100).join("\n");
		expect(later).toContain("read");
		expect(later).toContain("2.4s");

		component.updateResult({ content: [{ type: "text", text: "done" }], isError: false });
		const settled = component.render(100).join("\n");
		expect(settled).not.toContain("2.4s");
		component.dispose();
	});
});

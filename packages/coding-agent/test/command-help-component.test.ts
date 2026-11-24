import { beforeAll, describe, expect, test, vi } from "vitest";
import { CommandHelpComponent, type CommandHelpItem } from "../src/modes/interactive/components/command-help.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const commands: CommandHelpItem[] = [
	{ name: "help", description: "Browse commands", source: "builtin" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts", source: "builtin" },
	{ name: "settings", description: "Open settings", source: "builtin" },
	{ name: "skill:demo", description: "Run the demo skill", source: "skill" },
];

function render(component: CommandHelpComponent): string {
	return component.render(100).join("\n");
}

describe("CommandHelpComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("lists every command when the query is empty", () => {
		const component = new CommandHelpComponent(commands, vi.fn(), vi.fn());
		const output = render(component);
		expect(output).toContain("/help");
		expect(output).toContain("/hotkeys");
		expect(output).toContain("/settings");
		expect(output).toContain("/skill:demo");
	});

	test("filters by command name and description", () => {
		const component = new CommandHelpComponent(commands, vi.fn(), vi.fn(), "keyboard");
		const output = render(component);
		expect(output).toContain("/hotkeys");
		expect(output).not.toContain("/settings");
	});

	test("ranks command-name matches above description-only matches", () => {
		const component = new CommandHelpComponent(
			[
				{ name: "skill:planning", description: "Planning helper", source: "skill" },
				{ name: "plan", description: "Toggle plan mode", source: "builtin" },
			],
			vi.fn(),
			vi.fn(),
			"plan",
		);
		const output = render(component);
		expect(output.indexOf("/plan")).toBeLessThan(output.indexOf("/skill:planning"));
	});

	test("returns the selected command name", () => {
		const onSelect = vi.fn();
		const component = new CommandHelpComponent(commands, onSelect, vi.fn(), "hotk");
		component.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith("hotkeys");
	});

	test("cancels from an empty query", () => {
		const onCancel = vi.fn();
		const component = new CommandHelpComponent(commands, vi.fn(), onCancel);
		component.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalledOnce();
	});
});

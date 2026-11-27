import { beforeAll, describe, expect, it } from "vitest";
import type { Task } from "../src/core/tasks/task-store.ts";
import type { TodoItem } from "../src/core/tools/todo.ts";
import { TaskPanelComponent } from "../src/modes/interactive/components/task-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => {
	initTheme("dark", false);
});

function todo(text: string, status: TodoItem["status"] = "pending"): TodoItem {
	return { text, status };
}

function makeTask(over: Partial<Task>): Task {
	return {
		id: "1",
		subject: "wire auth",
		description: "",
		status: "pending",
		blocks: [],
		blockedBy: [],
		...over,
	};
}

function visible(panel: TaskPanelComponent, width = 120): string {
	return panel
		.render(width)
		.join("\n")
		.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("TaskPanelComponent", () => {
	it("renders an expanded board with todos and tasks when content exists", () => {
		const panel = new TaskPanelComponent();
		panel.update([todo("alpha", "in_progress"), todo("beta")], [{ ...makeTask({ id: "3", status: "completed" }) }]);
		const out = visible(panel);
		expect(out).toContain("TASKS");
		expect(out).toContain("0/2 todos");
		expect(out).toContain("1/1 done");
		expect(out).toContain("TODOS");
		expect(out).toContain("DONE 1");
		expect(out).toContain("#3 wire auth");
	});

	it("groups the task graph and labels dependencies", () => {
		const panel = new TaskPanelComponent();
		panel.update(
			[],
			[
				makeTask({ id: "1", subject: "scaffold", status: "completed", blocks: ["2"] }),
				makeTask({
					id: "2",
					subject: "wire auth",
					activeForm: "wiring auth",
					status: "in_progress",
					owner: "backend",
					blocks: ["3"],
				}),
				makeTask({ id: "3", subject: "add tests", status: "pending", blockedBy: ["2"] }),
				makeTask({ id: "4", subject: "write docs", status: "pending", blockedBy: ["2", "3"] }),
				makeTask({ id: "5", subject: "ship it", status: "pending" }),
			],
		);
		const out = visible(panel);
		expect(out).toContain("☰ TASKS");
		expect(out).toContain("1/5 done");
		expect(out).toContain("1 active");
		expect(out).toContain("2 blocked");
		expect(out).toContain("IN PROGRESS 1");
		expect(out).toContain("NEXT 1");
		expect(out).toContain("BLOCKED 2");
		expect(out).toContain("DONE 1");
		expect(out).toContain("#2 wiring auth");
		expect(out).toContain("@backend");
		expect(out).toContain("⤷ #2, #3");
		expect(out.indexOf("IN PROGRESS")).toBeLessThan(out.indexOf("BLOCKED"));
	});

	it("renders nothing when empty", () => {
		const panel = new TaskPanelComponent();
		panel.update([], []);
		expect(panel.render(120)).toEqual([]);
	});

	it("auto-collapses large boards and shows the in-progress rows", () => {
		const panel = new TaskPanelComponent();
		const todos = Array.from({ length: 9 }, (_, i) => todo(`item ${i}`));
		todos[2] = todo("the active one", "in_progress");
		panel.update(todos, []);
		const out = visible(panel);
		expect(out).toContain("9 todos");
		// Collapsed: in-progress row visible, the rest hidden
		expect(out).toContain("the active one");
		expect(out).not.toContain("item 0");
	});

	it("expands and collapses from ctrl+o via toggle()", () => {
		const todos = Array.from({ length: 10 }, (_, i) => todo(`item ${i}`));
		const panel = new TaskPanelComponent();
		panel.update(todos, []);
		expect(visible(panel)).not.toContain("item 0"); // auto-collapsed
		panel.toggle();
		expect(visible(panel)).toContain("item 0");
		panel.toggle();
		expect(visible(panel)).not.toContain("item 0");
	});

	it("manual toggle overrides auto-collapse until the board shrinks", () => {
		const panel = new TaskPanelComponent();
		panel.update(
			Array.from({ length: 10 }, (_, i) => todo(`item ${i}`)),
			[],
		);
		panel.toggle(); // user expanded the large board
		// Subsequent updates with same-size board keep the user's expansion
		panel.update(
			Array.from({ length: 10 }, (_, i) => todo(`item ${i} v2`)),
			[],
		);
		expect(visible(panel)).toContain("item 0 v2");
	});

	it("clears on empty update", () => {
		const panel = new TaskPanelComponent();
		panel.update([todo("alpha")], []);
		expect(panel.render(120).length).toBeGreaterThan(0);
		panel.update([], []);
		expect(panel.render(120)).toEqual([]);
	});
});

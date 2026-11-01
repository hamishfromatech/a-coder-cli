import { beforeEach, describe, expect, it } from "vitest";
import { useTabsStore } from "./tabs-store";

describe("tabs-store openTab label semantics", () => {
	beforeEach(() => {
		useTabsStore.getState().clear();
	});

	it("creates a tab with the provided name and activates it", () => {
		useTabsStore.getState().openTab("/s/a.jsonl", "Fix login bug");
		const { tabs, activePath } = useTabsStore.getState();
		expect(tabs).toEqual([{ path: "/s/a.jsonl", name: "Fix login bug" }]);
		expect(activePath).toBe("/s/a.jsonl");
	});

	it("creates a new tab as Untitled session when no name is given", () => {
		useTabsStore.getState().openTab("/s/b.jsonl");
		const { tabs } = useTabsStore.getState();
		expect(tabs[0]).toEqual({ path: "/s/b.jsonl", name: "Untitled session" });
	});

	it("keeps an existing tab's label when reopened without a name (stale-name guard)", () => {
		useTabsStore.getState().openTab("/s/a.jsonl", "Fix login bug");
		// Reopen while the caller has no authoritative name for this session —
		// e.g. an optimistic switch before get_state returns. The good label
		// must survive.
		useTabsStore.getState().openTab("/s/a.jsonl");
		const { tabs } = useTabsStore.getState();
		expect(tabs[0]).toEqual({ path: "/s/a.jsonl", name: "Fix login bug" });
	});

	it("updates the label when a name IS provided (rename flow)", () => {
		useTabsStore.getState().openTab("/s/a.jsonl", "Fix login bug");
		useTabsStore.getState().openTab("/s/a.jsonl", "Build app");
		const { tabs } = useTabsStore.getState();
		expect(tabs[0]).toEqual({ path: "/s/a.jsonl", name: "Build app" });
	});

	it("renameTab applies authoritative renames and preserves others", () => {
		useTabsStore.getState().openTab("/s/a.jsonl", "Fix login bug");
		useTabsStore.getState().openTab("/s/b.jsonl", "Build app");
		useTabsStore.getState().renameTab("/s/a.jsonl", "Fix login bug v2");
		const { tabs } = useTabsStore.getState();
		expect(tabs.map((t) => t.name)).toEqual(["Fix login bug v2", "Build app"]);
	});
});
describe("tabs-store moveTab", () => {
	beforeEach(() => {
		useTabsStore.getState().clear();
	});

	it("reorders by drag without changing the active tab", () => {
		const store = useTabsStore.getState();
		store.openTab("/s/a.jsonl", "A");
		store.openTab("/s/b.jsonl", "B");
		store.openTab("/s/c.jsonl", "C");
		store.setActive("/s/b.jsonl");

		useTabsStore.getState().moveTab("/s/c.jsonl", "/s/a.jsonl");
		expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([
			"/s/c.jsonl",
			"/s/a.jsonl",
			"/s/b.jsonl",
		]);
		expect(useTabsStore.getState().activePath).toBe("/s/b.jsonl");
	});

	it("ignores unknown paths", () => {
		useTabsStore.getState().openTab("/s/a.jsonl", "A");
		const before = useTabsStore.getState().tabs;
		useTabsStore.getState().moveTab("/missing", "/s/a.jsonl");
		expect(useTabsStore.getState().tabs).toBe(before);
	});
});

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
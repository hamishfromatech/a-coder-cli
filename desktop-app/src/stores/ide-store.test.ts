import { beforeEach, describe, expect, it } from "vitest";
import { useIdeStore } from "./ide-store";

const tab = (path: string) => ({ path, lastSaved: "" });

describe("ide store", () => {
	beforeEach(() => {
		useIdeStore.setState({
			openTabs: [tab("/w/a.ts"), tab("/w/b.ts"), tab("/w/c.ts")],
			activePath: "/w/b.ts",
		});
	});

	it("reorders editor tabs without changing the active one", () => {
		useIdeStore.getState().moveTab("/w/c.ts", "/w/a.ts");
		expect(useIdeStore.getState().openTabs.map((entry) => entry.path)).toEqual([
			"/w/c.ts",
			"/w/a.ts",
			"/w/b.ts",
		]);
		expect(useIdeStore.getState().activePath).toBe("/w/b.ts");
	});

	it("closing the active tab activates its neighbor", () => {
		useIdeStore.getState().closeTab("/w/b.ts");
		expect(useIdeStore.getState().openTabs.map((entry) => entry.path)).toEqual([
			"/w/a.ts",
			"/w/c.ts",
		]);
		expect(useIdeStore.getState().activePath).toBe("/w/c.ts");
	});

	it("persists folder expansion per workspace", () => {
		useIdeStore.getState().setExplorerExpanded("/w", ["/w/src", "/w/src/ide"]);
		useIdeStore.getState().setExplorerExpanded("/other", ["/other/lib"]);
		expect(useIdeStore.getState().explorerExpanded["/w"]).toEqual(["/w/src", "/w/src/ide"]);
		expect(useIdeStore.getState().explorerExpanded["/other"]).toEqual(["/other/lib"]);
	});

	it("clamps the editor font size", () => {
		useIdeStore.getState().setEditorFontSize(99);
		expect(useIdeStore.getState().editorFontSize).toBe(22);
		useIdeStore.getState().setEditorFontSize(1);
		expect(useIdeStore.getState().editorFontSize).toBe(10);
	});
});

import { beforeEach, describe, expect, it } from "vitest";
import { useSessionTreeStore } from "./session-tree-store";

// Helper: build a minimal SessionTreeNode shape accepted by setTree.
function node(id: string, children: any[] = [], label?: string) {
	return {
		entry: { id, type: "message", parentId: null, message: { role: "user" as const }, label },
		children,
		label,
	};
}

describe("session-tree-store", () => {
	beforeEach(() => {
		useSessionTreeStore.setState({
			tree: [],
			leafId: null,
			expanded: new Set<string>(),
			focusedId: null,
		});
	});

	it("toggles expanded membership", () => {
		const { toggleExpanded } = useSessionTreeStore.getState();
		toggleExpanded("a");
		expect(useSessionTreeStore.getState().expanded.has("a")).toBe(true);
		useSessionTreeStore.getState().toggleExpanded("a");
		expect(useSessionTreeStore.getState().expanded.has("a")).toBe(false);
	});

	it("collapseAll clears all expanded nodes", () => {
		const { toggleExpanded } = useSessionTreeStore.getState();
		toggleExpanded("a");
		toggleExpanded("b");
		useSessionTreeStore.getState().collapseAll();
		expect(useSessionTreeStore.getState().expanded.size).toBe(0);
	});

	it("expandAll collects every node id in the tree", () => {
		useSessionTreeStore
			.getState()
			.setTree(
				[node("root", [node("c1", [node("g1")]), node("c2")])] as any,
				"g1",
			);
		useSessionTreeStore.getState().expandAll();
		const { expanded } = useSessionTreeStore.getState();
		expect(expanded.has("root")).toBe(true);
		expect(expanded.has("c1")).toBe(true);
		expect(expanded.has("c2")).toBe(true);
		expect(expanded.has("g1")).toBe(true);
	});

	it("setFocused tracks keyboard focus", () => {
		useSessionTreeStore.getState().setFocused("x");
		expect(useSessionTreeStore.getState().focusedId).toBe("x");
		useSessionTreeStore.getState().setFocused(null);
		expect(useSessionTreeStore.getState().focusedId).toBeNull();
	});

	it("normalizes labels, role mapping, and leafId on setTree", () => {
		useSessionTreeStore
			.getState()
			.setTree(
				[
					node("root", [node("child")], "Root label"),
					{
						entry: { id: "tool1", type: "message", parentId: null, message: { role: "tool" } },
						children: [],
					},
				] as any,
				"child",
			);
		const { tree, leafId } = useSessionTreeStore.getState();
		expect(tree[0].label).toBe("Root label");
		expect(tree[0].children[0].id).toBe("child");
		expect(tree[1].role).toBe("toolResult");
		expect(leafId).toBe("child");
	});
});

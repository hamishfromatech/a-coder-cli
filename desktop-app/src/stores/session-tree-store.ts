import { create } from "zustand";
import type { SessionTreeNode } from "../lib/rpc";

type TreeNodeRole = "user" | "assistant" | "system" | "toolResult" | "other";

export interface TreeNode {
	id: string;
	label?: string;
	role: TreeNodeRole;
	children: TreeNode[];
}

export interface SessionTreeState {
	tree: TreeNode[];
	leafId: string | null;
	/** IDs of nodes whose children are expanded in the drawer. Persisted in the
	 *  Zustand store (not React useState) so the expansion survives the
	 *  hover-rail collapse/expand unmount. */
	expanded: Set<string>;
	/** Node currently keyboard-focused for arrow-key navigation. */
	focusedId: string | null;
	setTree: (tree: SessionTreeNode[], leafId: string | null) => void;
	toggleExpanded: (id: string) => void;
	setFocused: (id: string | null) => void;
	collapseAll: () => void;
	expandAll: () => void;
}

function collectIds(nodes: TreeNode[]): string[] {
	const ids: string[] = [];
	const walk = (ns: TreeNode[]) => {
		for (const n of ns) {
			ids.push(n.id);
			walk(n.children);
		}
	};
	walk(nodes);
	return ids;
}

function normalizeTree(nodes: SessionTreeNode[]): TreeNode[] {
	return nodes.map((n) => ({
		id: n.entry.id,
		label: n.label ?? n.entry.label ?? undefined,
		role: (n.entry.message?.role === "tool" ? "toolResult" : n.entry.message?.role) ?? "other",
		children: normalizeTree(n.children),
	}));
}

export const useSessionTreeStore = create<SessionTreeState>((set) => ({
	tree: [],
	leafId: null,
	expanded: new Set<string>(),
	focusedId: null,
	setTree: (tree, leafId) => set({ tree: normalizeTree(tree), leafId }),
	toggleExpanded: (id) =>
		set((s) => {
			const expanded = new Set(s.expanded);
			if (expanded.has(id)) expanded.delete(id);
			else expanded.add(id);
			return { expanded };
		}),
	setFocused: (focusedId) => set({ focusedId }),
	collapseAll: () => set({ expanded: new Set<string>() }),
	expandAll: () => set((s) => ({ expanded: new Set<string>(collectIds(s.tree)) })),
}));

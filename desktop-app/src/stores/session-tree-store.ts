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
	setTree: (tree: SessionTreeNode[], leafId: string | null) => void;
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
	setTree: (tree, leafId) => set({ tree: normalizeTree(tree), leafId }),
}));

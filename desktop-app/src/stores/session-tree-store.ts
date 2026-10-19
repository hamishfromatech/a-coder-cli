import { create } from "zustand";
import type { SessionTreeFlatNode, SessionTreeNode } from "../lib/rpc";

type TreeNodeRole = "user" | "assistant" | "system" | "toolResult" | "other";

export interface TreeNode {
	id: string;
	label?: string;
	role: TreeNodeRole;
	/** Entry type ("message", "file_history_snapshot", "compaction", …). */
	type?: string;
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
	/** Build the same tree from the flat `get_tree {flat:true}` response. */
	setFlatTree: (nodes: SessionTreeFlatNode[], leafId: string | null) => void;
	applyTreeDelta: (delta: {
		leafId?: string | null;
		added?: SessionTreeFlatNode[];
		updated?: SessionTreeFlatNode[];
		removed?: string[];
	}) => void;
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

function toTreeNode(node: SessionTreeFlatNode): TreeNode {
	return {
		id: node.id,
		label: node.label,
		role: ((node.messageRole === "tool" ? "toolResult" : node.messageRole) ?? "other") as TreeNodeRole,
		type: node.type,
		children: [],
	};
}

function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
	const stack = [...nodes];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		if (node.id === id) return node;
		for (const child of node.children) stack.push(child);
	}
	return undefined;
}

function removeNodes(nodes: TreeNode[], ids: Set<string>): TreeNode[] {
	return nodes
		.filter((node) => !ids.has(node.id))
		.map((node) => ({ ...node, children: removeNodes(node.children, ids) }));
}

function normalizeTree(nodes: SessionTreeNode[]): TreeNode[] {
	return nodes.map((n) => ({
		id: n.entry.id,
		label: n.label ?? n.entry.label ?? undefined,
		role: (n.entry.message?.role === "tool" ? "toolResult" : n.entry.message?.role) ?? "other",
		type: n.entry.type,
		children: normalizeTree(n.children),
	}));
}

export const useSessionTreeStore = create<SessionTreeState>((set) => ({
	tree: [],
	leafId: null,
	expanded: new Set<string>(),
	focusedId: null,
	setTree: (tree, leafId) => set({ tree: normalizeTree(tree), leafId }),
	setFlatTree: (nodes, leafId) => {
		const byId = new Map<string, TreeNode>();
		for (const node of nodes) byId.set(node.id, toTreeNode(node));
		const roots: TreeNode[] = [];
		for (const node of nodes) {
			const treeNode = byId.get(node.id);
			if (!treeNode) continue;
			const parent = node.parentId ? byId.get(node.parentId) : undefined;
			if (parent) parent.children.push(treeNode);
			else roots.push(treeNode);
		}
		set({ tree: roots, leafId });
	},
	applyTreeDelta: (delta) =>
		set((state) => {
			let tree = state.tree;
			if (delta.removed?.length) tree = removeNodes(tree, new Set(delta.removed));
			for (const node of delta.added ?? []) {
				if (findNode(tree, node.id)) continue;
				const treeNode = toTreeNode(node);
				const parent = node.parentId ? findNode(tree, node.parentId) : undefined;
				if (parent) parent.children.push(treeNode);
				else tree = [...tree, treeNode];
			}
			for (const node of delta.updated ?? []) {
				const existing = findNode(tree, node.id);
				if (!existing) continue;
				existing.label = node.label;
				if (node.messageRole) {
					existing.role = ((node.messageRole === "tool" ? "toolResult" : node.messageRole) ?? "other") as TreeNodeRole;
				}
			}
			// `tree` may share nested objects with the previous state; a new
			// top-level array is enough for the tree view (rows are unmemoized).
			const changed = Boolean(delta.added?.length || delta.updated?.length || delta.removed?.length);
			return { tree: changed ? [...tree] : tree, leafId: delta.leafId ?? state.leafId };
		}),
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

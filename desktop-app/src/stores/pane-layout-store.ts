/**
 * Pane layout store — tracks the current Dockview-style layout tree.
 *
 * The tree is a SplitNode (row/column) of GroupNodes (tabbed panes).
 * Each pane is a content area: chat, file tree, preview, terminal, etc.
 */

import { create } from "zustand";
import type { LayoutNode, GroupNode, SplitNode, DropPosition } from "../lib/pane-layout";
import { group, split, insertAtGroup, removePane, setActivePane, setSplitWeights, normalize } from "../lib/pane-layout";

export type PaneKind =
	| "chat"
	| "file-tree"
	| "preview"
	| "terminal"
	| "subagents"
	| "todos"
	| "tasks"
	| "logs"
	| "settings";

export interface PaneContent {
	kind: PaneKind;
	title: string;
	closable?: boolean;
	minimizable?: boolean;
}

/** Default layout: chat full-width, no sidebars. */
function createDefaultLayout(): LayoutNode {
	return group(["chat"]);
}

interface PaneLayoutState {
	/** The layout tree. */
	tree: LayoutNode;
	/** Pane content configs. */
	panes: Map<string, PaneContent>;
	/** Active pane in each group (derived from tree, but tracked for quick access). */
	activePane: string;

	// Actions
	/** Replace the entire tree. */
	setTree: (tree: LayoutNode) => void;
	/** Add a pane to a group (or create a new group). */
	addPane: (paneId: string, content: PaneContent, target?: { groupId: string; pos: DropPosition }) => void;
	/** Remove a pane from the tree. */
	removePane: (paneId: string) => void;
	/** Set the active pane in a group. */
	setActive: (groupId: string, paneId: string) => void;
	/** Update split weights (resize). */
	setWeights: (splitId: string, weights: number[]) => void;
	/** Get the pane content for an id. */
	getPane: (paneId: string) => PaneContent | undefined;
	/** Reset to default layout. */
	reset: () => void;
}

export const usePaneLayoutStore = create<PaneLayoutState>((set, get) => ({
	tree: createDefaultLayout(),
	panes: new Map([
		["chat", { kind: "chat", title: "Chat", closable: false }],
	]),
	activePane: "chat",

	setTree: (tree) => {
		const normalized = normalize(tree);
		if (normalized) {
			set({ tree: normalized });
		}
	},

	addPane: (paneId, content, target) => {
		const { tree, panes } = get();

		// Add to content map.
		const newPanes = new Map(panes);
		newPanes.set(paneId, content);

		// Find target group or use root.
		let newTree: LayoutNode | null;
		if (target) {
			newTree = insertAtGroup(tree, target.groupId, paneId, target.pos);
		} else {
			// Add to root group.
			const rootGroup = tree.type === "group" ? tree : (tree.children[0] as GroupNode | undefined);
			if (rootGroup && rootGroup.type === "group") {
				newTree = insertAtGroup(tree, rootGroup.id, paneId, "center");
			} else {
				// Create a new group with this pane.
				newTree = insertAtGroup(tree, (tree as SplitNode).children[0]?.id ?? "unknown", paneId, "center");
			}
		}

		if (newTree) {
			set({ tree: newTree, panes: newPanes, activePane: paneId });
		}
	},

	removePane: (paneId) => {
		const { tree, panes } = get();
		const newTree = removePane(tree, paneId);
		const newPanes = new Map(panes);
		newPanes.delete(paneId);

		if (newTree) {
			set({ tree: newTree, panes: newPanes });
		}
	},

	setActive: (groupId, paneId) => {
		const { tree } = get();
		const newTree = setActivePane(tree, groupId, paneId);
		set({ tree: newTree, activePane: paneId });
	},

	setWeights: (splitId, weights) => {
		const { tree } = get();
		const newTree = setSplitWeights(tree, splitId, weights);
		set({ tree: newTree });
	},

	getPane: (paneId) => get().panes.get(paneId),

	reset: () => {
		set({
			tree: createDefaultLayout(),
			panes: new Map([
				["chat", { kind: "chat", title: "Chat", closable: false }],
			]),
			activePane: "chat",
		});
	},
}));
/**
 * Layout tree model — simplified Dockview-style structure.
 *
 * Two node kinds:
 * - `split`: children laid out along an orientation with fractional weights.
 * - `group`: a stack of panes (tabs) with one active; may be minimized.
 *
 * All operations are pure and return new trees; `normalize` keeps the structure
 * canonical (no empty groups, no single-child or same-orientation nested splits).
 */

export type Orientation = 'row' | 'column';

export interface SplitNode {
	type: 'split';
	id: string;
	orientation: Orientation;
	children: LayoutNode[];
	/** Parallel to children; relative flex weights. */
	weights: number[];
}

export interface GroupNode {
	type: 'group';
	id: string;
	/** Pane ids stacked in this group (rendered as tabs when > 1). */
	panes: string[];
	/** The visible pane. */
	active: string;
	/** Collapsed to header strip (chevron restores). */
	minimized?: boolean;
}

export type LayoutNode = SplitNode | GroupNode;

/** Where a dragged pane lands relative to a target group. */
export type DropPosition = 'center' | 'left' | 'right' | 'top' | 'bottom';

let seq = 0;
export const nodeId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const group = (panes: string[], options?: Partial<Omit<GroupNode, 'type' | 'panes'>>): GroupNode => ({
	type: 'group',
	id: options?.id ?? nodeId('g'),
	panes,
	active: options?.active ?? panes[0] ?? '',
	minimized: options?.minimized,
});

export const split = (
	orientation: Orientation,
	children: LayoutNode[],
	weights?: number[],
	id?: string,
): SplitNode => ({
	type: 'split',
	id: id ?? nodeId('s'),
	orientation,
	children,
	weights: weights ?? children.map(() => 1),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findGroup(node: LayoutNode, groupId: string): GroupNode | null {
	if (node.type === 'group') {
		return node.id === groupId ? node : null;
	}

	for (const child of node.children) {
		const hit = findGroup(child, groupId);
		if (hit) return hit;
	}

	return null;
}

export function findGroupOfPane(node: LayoutNode, paneId: string): GroupNode | null {
	if (node.type === 'group') {
		return node.panes.includes(paneId) ? node : null;
	}

	for (const child of node.children) {
		const hit = findGroupOfPane(child, paneId);
		if (hit) return hit;
	}

	return null;
}

export function allPaneIds(node: LayoutNode): string[] {
	return node.type === 'group' ? [...node.panes] : node.children.flatMap(allPaneIds);
}

/** The split whose DIRECT child carries `childId`, or null. */
export function findParentSplit(node: LayoutNode, childId: string): SplitNode | null {
	if (node.type !== 'split') {
		return null;
	}

	if (node.children.some((child) => child.id === childId)) {
		return node;
	}

	for (const child of node.children) {
		const hit = findParentSplit(child, childId);
		if (hit) return hit;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Structural edits (pure)
// ---------------------------------------------------------------------------

/**
 * Canonical form: unwrap single-child splits, flatten same-orientation
 * nesting, and prune empty groups.
 */
export function normalize(node: LayoutNode): LayoutNode | null {
	if (node.type === 'group') {
		if (node.panes.length === 0) {
			return null;
		}

		const active = node.panes.includes(node.active) ? node.active : node.panes[0];
		if (active === node.active) return node;
		return { ...node, active };
	}

	const children: LayoutNode[] = [];
	const weights: number[] = [];

	node.children.forEach((child, i) => {
		const kept = normalize(child);
		if (!kept) return;

		if (kept.type === 'split' && kept.orientation === node.orientation) {
			// Flatten: distribute this slot's weight across the flattened children.
			const total = kept.weights.reduce((a, b) => a + b, 0) || 1;
			kept.children.forEach((grandchild, j) => {
				children.push(grandchild);
				weights.push((node.weights[i] ?? 1) * ((kept.weights[j] ?? 1) / total));
			});
			return;
		}

		children.push(kept);
		weights.push(node.weights[i] ?? 1);
	});

	if (children.length === 0) return null;
	if (children.length === 1) return children[0];

	return { ...node, children, weights };
}

/** Remove a pane wherever it lives. */
export function removePane(node: LayoutNode, paneId: string): LayoutNode | null {
	const walk = (n: LayoutNode): LayoutNode => {
		if (n.type === 'group') {
			const at = n.panes.indexOf(paneId);
			if (at === -1) return n;

			const panes = n.panes.filter((p) => p !== paneId);
			return {
				...n,
				panes,
				active: n.active === paneId ? (panes[Math.min(at, panes.length - 1)] ?? '') : n.active,
			};
		}

		return { ...n, children: n.children.map(walk) };
	};

	return normalize(walk(node));
}

/**
 * Insert `paneId` at `target` group: `center` joins the stack; an edge splits
 * the group in that direction.
 */
export function insertAtGroup(
	node: LayoutNode,
	targetGroupId: string,
	paneId: string,
	pos: DropPosition,
	activate: boolean = true,
	edgeWeights?: readonly [number, number],
): LayoutNode | null {
	const walk = (n: LayoutNode): LayoutNode => {
		if (n.type === 'group') {
			if (n.id !== targetGroupId) return n;

			if (pos === 'center') {
				const panes = [...n.panes, paneId];
				const active = activate || n.panes.length === 0 ? paneId : n.active;
				return { ...n, panes, active };
			}

			const orientation: Orientation = pos === 'left' || pos === 'right' ? 'row' : 'column';
			const leading = pos === 'left' || pos === 'top';
			const added = group([paneId]);
			const children = leading ? [added, n] : [n, added];
			const [targetWeight, addedWeight] = edgeWeights ?? [1, 1];

			return split(orientation, children, leading ? [addedWeight, targetWeight] : [targetWeight, addedWeight]);
		}

		return { ...n, children: n.children.map(walk) };
	};

	return normalize(walk(node));
}

/** Move = remove + insert. */
export function movePane(
	root: LayoutNode,
	paneId: string,
	target: { groupId: string; pos: DropPosition },
): LayoutNode {
	const from = findGroupOfPane(root, paneId);

	// No-op: dropping a pane onto its own single-pane group.
	if (from && from.id === target.groupId && from.panes.length === 1) {
		return root;
	}

	const without = removePane(root, paneId);
	if (!without || !findGroup(without, target.groupId)) {
		return root;
	}

	return insertAtGroup(without, target.groupId, paneId, target.pos) ?? root;
}

// ---------------------------------------------------------------------------
// Attribute edits
// ---------------------------------------------------------------------------

function mapGroups(node: LayoutNode, fn: (g: GroupNode) => GroupNode): LayoutNode {
	return node.type === 'group' ? fn(node) : { ...node, children: node.children.map((c) => mapGroups(c, fn)) };
}

export function setActivePane(root: LayoutNode, groupId: string, paneId: string): LayoutNode {
	return mapGroups(root, (g) => (g.id === groupId && g.panes.includes(paneId) ? { ...g, active: paneId } : g));
}

export function setGroupMinimized(root: LayoutNode, groupId: string, minimized: boolean): LayoutNode {
	return mapGroups(root, (g) => (g.id === groupId ? { ...g, minimized } : g));
}

export function setSplitWeights(root: LayoutNode, splitId: string, weights: number[]): LayoutNode {
	if (root.type === 'split') {
		if (root.id === splitId) {
			return { ...root, weights };
		}
		return { ...root, children: root.children.map((c) => setSplitWeights(c, splitId, weights)) };
	}
	return root;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isLayoutNode(value: unknown): value is LayoutNode {
	if (!value || typeof value !== 'object') return false;
	const n = value as Record<string, unknown>;

	if (n.type === 'group') {
		return (
			typeof n.id === 'string' &&
			Array.isArray(n.panes) &&
			n.panes.every((p) => typeof p === 'string') &&
			typeof n.active === 'string'
		);
	}

	if (n.type === 'split') {
		return (
			typeof n.id === 'string' &&
			(n.orientation === 'row' || n.orientation === 'column') &&
			Array.isArray(n.children) &&
			n.children.length > 0 &&
			n.children.every(isLayoutNode) &&
			Array.isArray(n.weights) &&
			n.weights.length === n.children.length &&
			n.weights.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0)
		);
	}

	return false;
}
/**
 * PaneLayout — renders a Dockview-style layout tree.
 *
 * Splits render as flex row/column containers with resizable sashes.
 * Groups render as tabbed panels with one active pane visible.
 * Supports minimize/restore, drag-drop, and weight-based resizing.
 */

import { useCallback, useRef, useState } from 'react';

import type { GroupNode, LayoutNode, SplitNode } from '../lib/pane-layout';
import { setActivePane, setSplitWeights } from '../lib/pane-layout';
import { ChevronDown, X } from 'lucide-react';

export interface PaneConfig {
	id: string;
	title: string;
	icon?: React.ReactNode;
	render: () => React.ReactNode;
	closable?: boolean;
	minimizable?: boolean;
}

interface PaneLayoutProps {
	tree: LayoutNode;
	panes: Map<string, PaneConfig>;
	onTreeChange: (tree: LayoutNode) => void;
	onPaneClose?: (paneId: string) => void;
	className?: string;
}

export function PaneLayout({ tree, panes, onTreeChange, onPaneClose, className }: PaneLayoutProps) {
	return (
		<div className={`flex h-full w-full overflow-hidden ${className ?? ''}`}>
			<RenderNode
				node={tree}
				panes={panes}
				onTreeChange={onTreeChange}
				onPaneClose={onPaneClose}
				depth={0}
			/>
		</div>
	);
}

interface RenderNodeProps {
	node: LayoutNode;
	panes: Map<string, PaneConfig>;
	onTreeChange: (tree: LayoutNode) => void;
	onPaneClose?: (paneId: string) => void;
	depth: number;
}

function RenderNode({ node, panes, onTreeChange, onPaneClose, depth }: RenderNodeProps) {
	if (node.type === 'split') {
		return (
			<SplitContainer
				node={node}
				panes={panes}
				onTreeChange={onTreeChange}
				onPaneClose={onPaneClose}
				depth={depth}
			/>
		);
	}

	return (
		<GroupContainer
			node={node}
			panes={panes}
			onTreeChange={onTreeChange}
			onPaneClose={onPaneClose}
		/>
	);
}

interface SplitContainerProps {
	node: SplitNode;
	panes: Map<string, PaneConfig>;
	onTreeChange: (tree: LayoutNode) => void;
	onPaneClose?: (paneId: string) => void;
	depth: number;
}

function SplitContainer({ node, panes, onTreeChange, onPaneClose, depth }: SplitContainerProps) {
	const [resizing, setResizing] = useState<number | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const handlePointerDown = useCallback(
		(index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
			e.preventDefault();
			setResizing(index);

			const container = containerRef.current;
			if (!container) return;

			const handle = e.currentTarget;
			const pointerId = e.pointerId;
			const startX = e.clientX;
			const startY = e.clientY;

			const isRow = node.orientation === 'row';
			const totalSize = isRow ? container.clientWidth : container.clientHeight;
			const startWeights = [...node.weights];

			handle.setPointerCapture?.(pointerId);
			document.body.style.cursor = isRow ? 'col-resize' : 'row-resize';
			document.body.style.userSelect = 'none';

			const handleMove = (moveEvent: PointerEvent) => {
				const delta = isRow ? moveEvent.clientX - startX : moveEvent.clientY - startY;
				const deltaWeight = (delta / totalSize) * 2; // Scale for better feel

				const newWeights = [...startWeights];
				const clampedDelta = Math.max(
					0.1 - startWeights[index],
					Math.min(startWeights[index + 1] - 0.1, deltaWeight),
				);
				newWeights[index] = startWeights[index] + clampedDelta;
				newWeights[index + 1] = startWeights[index + 1] - clampedDelta;

				// Normalize weights to sum to 1
				const sum = newWeights.reduce((a, b) => a + b, 0);
				const normalized = newWeights.map((w) => w / sum);

				onTreeChange(setSplitWeights(node, node.id, normalized));
			};

			const cleanup = () => {
				setResizing(null);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				handle.releasePointerCapture?.(pointerId);
				window.removeEventListener('pointermove', handleMove, true);
				window.removeEventListener('pointerup', cleanup, true);
				window.removeEventListener('pointercancel', cleanup, true);
			};

			window.addEventListener('pointermove', handleMove, true);
			window.addEventListener('pointerup', cleanup, true);
			window.addEventListener('pointercancel', cleanup, true);
		},
		[node, onTreeChange],
	);

	const isRow = node.orientation === 'row';

	return (
		<div
			ref={containerRef}
			className={`flex h-full w-full ${isRow ? 'flex-row' : 'flex-col'}`}
		>
			{node.children.map((child, i) => (
				<div key={child.id} className="flex h-full w-full" style={{ flex: node.weights[i] }}>
					<RenderNode
						node={child}
						panes={panes}
						onTreeChange={onTreeChange}
						onPaneClose={onPaneClose}
						depth={depth + 1}
					/>
					{/* Resize handle between children (not after last) */}
					{i < node.children.length - 1 && (
						<div
							className={`
								${isRow ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}
								${resizing === i ? 'bg-[var(--pi-accent)]' : 'bg-transparent hover:bg-[var(--pi-border)]'}
								transition-colors
							`}
							onPointerDown={handlePointerDown(i)}
						/>
					)}
				</div>
			))}
		</div>
	);
}

interface GroupContainerProps {
	node: GroupNode;
	panes: Map<string, PaneConfig>;
	onTreeChange: (tree: LayoutNode) => void;
	onPaneClose?: (paneId: string) => void;
}

function GroupContainer({ node, panes, onTreeChange, onPaneClose }: GroupContainerProps) {
	const [hoveredTab, setHoveredTab] = useState<string | null>(null);

	const activePane = panes.get(node.active);
	const visiblePanes = node.panes.map((id) => panes.get(id)).filter(Boolean) as PaneConfig[];

	if (node.minimized) {
		return (
			<div className="flex h-full w-full items-center justify-center border border-[var(--pi-border)] bg-[var(--pi-surface)]">
				<button
					className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-[var(--pi-text-muted)] transition-colors hover:bg-[var(--pi-surface-raised)] hover:text-[var(--pi-text)]"
					onClick={() => onTreeChange({ ...node, minimized: false })}
				>
					{activePane?.icon}
					<span>{activePane?.title ?? node.active}</span>
					<ChevronDown className="size-3" />
				</button>
			</div>
		);
	}

	if (visiblePanes.length === 0) {
		return (
			<div className="flex h-full w-full items-center justify-center text-xs text-[var(--pi-text-muted)]">
				No panes
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden border border-[var(--pi-border)] bg-[var(--pi-surface)]">
			{/* Tab strip (only show if > 1 pane) */}
			{visiblePanes.length > 1 && (
				<div className="flex shrink-0 items-center gap-0.5 border-b border-[var(--pi-border)] bg-[var(--pi-bg)] px-1 py-0.5">
					{visiblePanes.map((pane) => (
						<button
							key={pane.id}
							className={`
								flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium
								${pane.id === node.active
									? 'bg-[var(--pi-surface)] text-[var(--pi-text)]'
									: 'text-[var(--pi-text-muted)] hover:bg-[var(--pi-surface-raised)] hover:text-[var(--pi-text)]'
								}
							`}
							onClick={() => onTreeChange(setActivePane(node, node.id, pane.id))}
							onMouseEnter={() => setHoveredTab(pane.id)}
							onMouseLeave={() => setHoveredTab(null)}
						>
							{pane.icon}
							<span className="max-w-[100px] truncate">{pane.title}</span>
							{pane.closable !== false && hoveredTab === pane.id && onPaneClose && (
								<span
									className="ml-0.5 rounded hover:bg-[var(--pi-error-soft)] hover:text-[var(--pi-error)]"
									onClick={(e) => {
										e.stopPropagation();
										onPaneClose(pane.id);
									}}
								>
									<X className="size-2.5" />
								</span>
							)}
						</button>
					))}
				</div>
			)}

			{/* Tab content */}
			<div className="min-h-0 flex-1 overflow-auto">
				{activePane?.render() ?? (
					<div className="flex h-full items-center justify-center text-xs text-[var(--pi-text-muted)]">
						Pane not found: {node.active}
					</div>
				)}
			</div>
		</div>
	);
}
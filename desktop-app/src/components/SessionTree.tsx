import {
	ChevronDown,
	ChevronRight,
	CornerUpRight,
	Filter,
	GitBranch,
	MessageSquare,
	MoreHorizontal,
	Pencil,
	Sparkles,
} from "lucide-react";
import { useState } from "react";
import * as rpc from "../lib/rpc";
import { useSessionStore } from "../stores/session-store";
import { useSessionTreeStore } from "../stores/session-tree-store";
import type { TreeNode } from "../stores/session-tree-store";
import { useSettingsStore } from "../stores/settings-store";
import type { TreeFilterMode } from "../lib/settings.types";

const FILTER_MODES: { value: TreeFilterMode; label: string }[] = [
	{ value: "default", label: "All" },
	{ value: "no-tools", label: "No tools" },
	{ value: "user-only", label: "User only" },
	{ value: "labeled-only", label: "Labeled" },
	{ value: "all", label: "Everything" },
];

export function SessionTree() {
	const { tree, leafId } = useSessionTreeStore();
	const { messages } = useSessionStore();
	const { cliGlobalSettings, patchCliSettings } = useSettingsStore();
	const filterMode = cliGlobalSettings.treeFilterMode ?? "default";
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [renamingId, setRenamingId] = useState<string | null>(null);

	const toggle = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const handleFork = async (entryId: string) => {
		try {
			await rpc.sendCommand({ type: "fork", entryId });
		} catch (e) {
			console.error("Failed to fork", e);
		}
	};

	const handleSwitch = async (entryId: string) => {
		try {
			await rpc.sendCommand({ type: "switch_session", sessionPath: entryId });
		} catch (e) {
			console.error("Failed to navigate", e);
		}
	};

	// Re-fetch the tree after a backend-only mutation (e.g. entry label rename)
	// that doesn't emit a session_start event.
	const refreshTree = async () => {
		try {
			const res = (await rpc.getTree()) as {
				tree: rpc.SessionTreeNode[];
				leafId: string | null;
			} | undefined;
			if (res?.tree) useSessionTreeStore.getState().setTree(res.tree, res.leafId);
		} catch {
			/* ignore */
		}
	};

	const handleRename = async (entryId: string, label: string) => {
		const trimmed = label.trim();
		try {
			await rpc.setEntryLabel(entryId, trimmed.length ? trimmed : undefined);
			await refreshTree();
		} catch (e) {
			console.error("Failed to rename entry", e);
		} finally {
			setRenamingId(null);
		}
	};

	const filteredTree = applyFilter(tree, filterMode);

	if (tree.length === 0) {
		return (
			<p className="px-2 py-1 text-[11.5px] text-pi-text-faint">
				Branches will appear once the engine reports them.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-1">
			{/* Metadata header + filter */}
			<div className="flex items-center justify-between px-2.5 py-0.5">
				<div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wide text-pi-text-faint">
					<span>
						{messages.length} msg{messages.length === 1 ? "" : "s"}
					</span>
					{leafId && (
						<>
							<Sep />
							<span className="flex items-center gap-1 text-pi-accent">
								<span className="h-1 w-1 rounded-full bg-pi-accent shadow-[0_0_4px_var(--pi-accent)]" />
								active
							</span>
						</>
					)}
				</div>
				<FilterMenu
					mode={filterMode}
					onChange={(mode) => {
						patchCliSettings("global", { treeFilterMode: mode });
						rpc.sendCommand({ type: "set_tree_filter_mode", mode }).catch(() => {});
					}}
				/>
			</div>

			{filteredTree.map((node) => (
				<TreeItem
					key={node.id}
					node={node}
					depth={0}
					expanded={expanded}
					toggle={toggle}
					leafId={leafId}
					onFork={handleFork}
					onSwitch={handleSwitch}
					onStartRename={(id) => setRenamingId(id)}
					renamingId={renamingId}
					onCommitRename={handleRename}
					onCancelRename={() => setRenamingId(null)}
				/>
			))}
		</div>
	);
}

function FilterMenu({
	mode,
	onChange,
}: {
	mode: TreeFilterMode;
	onChange: (mode: TreeFilterMode) => void;
}) {
	const [open, setOpen] = useState(false);
	const current = FILTER_MODES.find((m) => m.value === mode) ?? FILTER_MODES[0];
	return (
		<div className="relative">
			<button
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1 rounded p-1 text-[10.5px] text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
				title="Filter tree"
			>
				<Filter className="h-3 w-3" />
				<span className="hidden sm:inline">{current.label}</span>
				<ChevronDown className={`h-3 w-3 transition-smooth ${open ? "rotate-180" : ""}`} />
			</button>
			{open && (
				<div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-pi-border bg-pi-surface py-1 shadow-card">
					{FILTER_MODES.map((m) => (
						<button
							key={m.value}
							onClick={() => {
								onChange(m.value);
								setOpen(false);
							}}
							className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] transition-hover ${
								mode === m.value
									? "bg-pi-surface-raised text-pi-text"
									: "text-pi-text-secondary hover:bg-pi-surface-raised"
							}`}
						>
							<span>{m.label}</span>
							{mode === m.value && <span className="h-1.5 w-1.5 rounded-full bg-pi-accent" />}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function applyFilter(nodes: TreeNode[], mode: TreeFilterMode): TreeNode[] {
	switch (mode) {
		case "no-tools":
			return nodes
				.filter((n) => n.role !== "toolResult")
				.map((n) => ({ ...n, children: applyFilter(n.children, mode) }));
		case "user-only":
			return nodes
				.filter((n) => n.role === "user")
				.map((n) => ({ ...n, children: applyFilter(n.children, mode) }));
		case "labeled-only":
			return nodes
				.filter((n) => !!n.label)
				.map((n) => ({ ...n, children: applyFilter(n.children, mode) }));
		case "all":
		default:
			return nodes;
	}
}

interface TreeItemProps {
	node: TreeNode;
	depth: number;
	expanded: Set<string>;
	toggle: (id: string) => void;
	leafId: string | null;
	onFork: (id: string) => void;
	onSwitch: (id: string) => void;
	renamingId: string | null;
	onStartRename: (id: string) => void;
	onCommitRename: (id: string, label: string) => void;
	onCancelRename: () => void;
}

function TreeItem({
	node,
	depth,
	expanded,
	toggle,
	leafId,
	onFork,
	onSwitch,
	renamingId,
	onStartRename,
	onCommitRename,
	onCancelRename,
}: TreeItemProps) {
	const hasChildren = node.children.length > 0;
	const branchCount = node.children.length;
	const isMultiBranch = branchCount > 1;
	const isExpanded = expanded.has(node.id);
	const isLeaf = leafId === node.id;
	const isRenaming = renamingId === node.id;
	const Icon = node.role === "assistant" ? Sparkles : MessageSquare;

	return (
		<div className="select-none">
			<div
				className={`group flex h-7 items-center gap-1 rounded-md pr-1 text-[12px] transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
					isLeaf
						? "bg-pi-accent-soft text-pi-accent"
						: "text-pi-text-secondary hover:bg-pi-surface-raised hover:text-pi-text"
				}`}
				style={{ paddingLeft: `${depth * 12 + 6}px` }}
			>
				{hasChildren ? (
					<button
						onClick={() => toggle(node.id)}
						className="text-pi-text-muted hover:text-pi-text"
					>
						{isExpanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)}
					</button>
				) : (
					<span className="w-3" />
				)}

				<Icon
					className={`h-3 w-3 shrink-0 ${isLeaf ? "text-pi-accent" : "text-pi-text-muted"}`}
				/>

				{isRenaming ? (
					<RenameInput
						initial={node.label ?? ""}
						onCommit={(v) => onCommitRename(node.id, v)}
						onCancel={onCancelRename}
					/>
				) : (
					<button
						onClick={() => onSwitch(node.id)}
						className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
						title={node.label ?? node.id}
					>
						<span className="truncate">{node.label ?? node.id.slice(0, 8)}</span>
						{isMultiBranch && (
							<span className="flex shrink-0 items-center gap-0.5 rounded px-1 text-[9.5px] font-medium text-pi-text-faint bg-pi-surface-overlay">
								<GitBranch className="h-2.5 w-2.5" />
								{branchCount}
							</span>
						)}
					</button>
				)}

				{!isRenaming && (
					<NodeMenu
						isLeaf={isLeaf}
						onSwitch={() => onSwitch(node.id)}
						onFork={() => onFork(node.id)}
						onRename={() => onStartRename(node.id)}
					/>
				)}
			</div>

			{hasChildren && isExpanded && (
				<div className="ml-[11px] border-l border-pi-border/50">
					{node.children.map((child) => (
						<TreeItem
							key={child.id}
							node={child}
							depth={depth + 1}
							expanded={expanded}
							toggle={toggle}
							leafId={leafId}
							onFork={onFork}
							onSwitch={onSwitch}
							renamingId={renamingId}
							onStartRename={onStartRename}
							onCommitRename={onCommitRename}
							onCancelRename={onCancelRename}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function NodeMenu({
	isLeaf,
	onSwitch,
	onFork,
	onRename,
}: {
	isLeaf: boolean;
	onSwitch: () => void;
	onFork: () => void;
	onRename: () => void;
}) {
	const [open, setOpen] = useState(false);
	const run = (fn: () => void) => {
		setOpen(false);
		fn();
	};
	return (
		<div className="relative shrink-0">
			<button
				onClick={() => setOpen((v) => !v)}
				className="flex h-5 w-5 items-center justify-center rounded text-pi-text-faint opacity-0 transition-all hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:opacity-100 focus-visible:bg-pi-surface-overlay focus-visible:text-pi-text group-hover:opacity-100"
				title="More actions"
				aria-label="More actions"
			>
				<MoreHorizontal className="h-3.5 w-3.5" />
			</button>
			{open && (
				<>
					<button
						className="fixed inset-0 z-10 cursor-default"
						onClick={() => setOpen(false)}
						aria-hidden
						tabIndex={-1}
					/>
					<div className="absolute right-0 top-full z-20 mt-0.5 w-40 overflow-hidden rounded-lg border border-pi-border bg-pi-surface py-1 shadow-card">
						<MenuItem icon={CornerUpRight} label="Switch here" onClick={() => run(onSwitch)} />
						<MenuItem icon={GitBranch} label="Fork from here" onClick={() => run(onFork)} />
						<MenuItem
							icon={Pencil}
							label={isLeaf ? "Rename" : "Label branch"}
							onClick={() => run(onRename)}
						/>
					</div>
				</>
			)}
		</div>
	);
}

function MenuItem({
	icon: IconCmp,
	label,
	onClick,
}: {
	icon: typeof CornerUpRight;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
		>
			<IconCmp className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
			{label}
		</button>
	);
}

function RenameInput({
	initial,
	onCommit,
	onCancel,
}: {
	initial: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<input
			autoFocus
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					onCommit(value);
				} else if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
			onBlur={() => onCommit(value)}
			className="min-w-0 flex-1 rounded border border-pi-border bg-pi-surface px-1.5 py-0.5 text-[12px] text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
			placeholder="Branch label"
		/>
	);
}

function Sep() {
	return <span className="mx-1 h-2 w-px bg-pi-border" />;
}
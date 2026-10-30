/**
 * Explorer: workspace file tree from the Tauri `list_directory` command.
 * Directories expand inline (the command returns a depth-limited tree, so
 * expansions are pure view state). Git-aware: modified/untracked files carry
 * the status letter + tint that VS Code users expect. Context menu: new
 * file/folder, rename, delete (inline edit rows, VS Code style). Refreshes
 * when the agent mutates files (`a-coder:agent-files-changed`) and
 * auto-reveals the active editor file.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
	ChevronRight,
	FileCode2,
	FileJson,
	FilePlus2,
	FileText,
	FileImage,
	Folder,
	FolderPlus,
	RefreshCw,
	Trash2,
	Type,
} from "lucide-react";

import type { DirEntry } from "../../lib/rpc.ts";
import {
	gitStatus,
	listDirectory,
	createDirectory,
	createFile,
	deletePath,
	renamePath,
} from "../../lib/rpc.ts";
import { openWorkspaceFile, writeTextFile } from "../../lib/ide.ts";
import { toast } from "../../stores/toast-store";
import { useIdeStore } from "../../stores/ide-store";
import { cn } from "../../lib/cn.ts";

const CODE_EXTS = new Set([
	"ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
	"c", "h", "cpp", "cc", "hpp", "cs", "swift", "sh", "bash", "zsh", "sql", "php", "lua",
	"vue", "svelte", "dart", "toml",
]);
const JSON_EXTS = new Set(["json", "jsonc", "json5", "lock"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "heic"]);
/** The tree command's depth cap; one deeper guard keeps nested renders safe. */
const TREE_MAX_DEPTH = 8;

/** Seti-flavored icon/color per file type. */
function iconFor(name: string): { Icon: typeof FileText; className: string } {
	const ext = name.split(".").at(-1)?.toLowerCase() ?? "";
	if (JSON_EXTS.has(ext)) return { Icon: FileJson, className: "text-amber-400/80" };
	if (CODE_EXTS.has(ext)) return { Icon: FileCode2, className: "text-sky-400/80" };
	if (IMAGE_EXTS.has(ext)) return { Icon: FileImage, className: "text-fuchsia-300/80" };
	return { Icon: FileText, className: "text-pi-text-faint" };
}

interface CreateEdit {
	kind: "create";
	/** Parent directory (absolute). */
	parent: string;
	isFolder: boolean;
}

interface RenameEdit {
	kind: "rename";
	/** Absolute path of the entry being renamed. */
	path: string;
	name: string;
}

type EditState = CreateEdit | RenameEdit | null;

interface ContextMenuState {
	x: number;
	y: number;
	path: string;
	isDir: boolean;
	name: string;
	/** The workspace root: no rename/delete offered. */
	isRoot: boolean;
}

interface MenuItem {
	label: string;
	Icon: typeof Type;
	run: () => void;
	danger?: boolean;
}

interface ExplorerProps {
	root: string;
}

export function ExplorerTree({ root }: ExplorerProps): ReactNode {
	const [tree, setTree] = useState<DirEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [gitByPath, setGitByPath] = useState<Map<string, string>>(new Map());
	const [edit, setEdit] = useState<EditState>(null);
	const [menu, setMenu] = useState<ContextMenuState | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const activePath = useIdeStore((s) => s.activePath);

	const refresh = useCallback(async () => {
		try {
			const entries = await listDirectory(root, TREE_MAX_DEPTH);
			setTree(entries);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setTree(null);
		}
		try {
			const status = await gitStatus(root);
			const map = new Map<string, string>();
			for (const change of status.staged) map.set(change.path, "M");
			for (const change of status.unstaged) map.set(change.path, (map.get(change.path) ?? "") + "M");
			for (const change of status.untracked) map.set(change.path, "U");
			setGitByPath(map);
		} catch {
			setGitByPath(new Map());
		}
	}, [root]);

	useEffect(() => {
		setExpanded(new Set());
		setEdit(null);
		setMenu(null);
		void refresh();
	}, [refresh]);

	// The agent's file tools announce themselves through the shared pipeline.
	useEffect(() => {
		const handler = () => void refresh();
		window.addEventListener("a-coder:agent-files-changed", handler);
		return () => window.removeEventListener("a-coder:agent-files-changed", handler);
	}, [refresh]);

	// Auto-reveal the active file: expand its ancestor chain, scroll into view.
	useEffect(() => {
		if (!activePath || !tree || !activePath.startsWith(root)) return;
		const chain = ancestorChain(tree, activePath);
		if (chain.length > 0) {
			setExpanded((prev) => {
				const next = new Set(prev);
				for (const dir of chain) next.add(dir);
				return next;
			});
		}
		const timer = setTimeout(() => {
			const escaped = typeof CSS !== "undefined" ? CSS.escape(activePath) : activePath.replace(/["\\]/g, "\\$&");
			document
				.querySelector(`[data-ide-entry="${escaped}"]`)
				?.scrollIntoView({ block: "nearest" });
		}, 40);
		return () => clearTimeout(timer);
	}, [activePath, tree, root]);

	function toggleDir(path: string): void {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}

	async function commitCreate(parent: string, isFolder: boolean, rawName: string): Promise<void> {
		const name = rawName.trim();
		setEdit(null);
		if (!name) return;
		const target = `${parent.replace(/\/+$/, "")}/${name}`;
		try {
			if (isFolder) {
				await createDirectory(target);
				setExpanded((prev) => new Set(prev).add(target));
			} else {
				await createFile(target);
				await writeTextFile(target, "");
				await openWorkspaceFile(root, target);
			}
			toast.success("Created", name);
		} catch (e) {
			toast.error("Create failed", e instanceof Error ? e.message : String(e));
		}
		void refresh();
	}

	async function commitRename(path: string, oldName: string, rawName: string): Promise<void> {
		const name = rawName.trim();
		setEdit(null);
		if (!name || name === oldName) return;
		const parent = path.split(/[/\\]/).slice(0, -1).join("/");
		const to = `${parent}/${name}`;
		try {
			await renamePath(path, to);
			const store = useIdeStore.getState();
			store.closeTab(path);
			if (store.activePath === path) await openWorkspaceFile(root, to);
			toast.success("Renamed", name);
		} catch (e) {
			toast.error("Rename failed", e instanceof Error ? e.message : String(e));
		}
		void refresh();
	}

	async function deleteEntry(target: ContextMenuState): Promise<void> {
		setMenu(null);
		setConfirmDelete(false);
		try {
			await deletePath(target.path, target.isDir);
			const store = useIdeStore.getState();
			const prefix = target.path.endsWith("/") ? target.path : `${target.path}/`;
			for (const tab of [...store.openTabs]) {
				if (tab.path === target.path || tab.path.startsWith(prefix)) store.closeTab(tab.path);
			}
			toast.success("Deleted", target.name);
		} catch (e) {
			toast.error("Delete failed", e instanceof Error ? e.message : String(e));
		}
		void refresh();
	}

	/** Ancestor dir paths of `relPath` within the loaded tree (to auto-expand). */
	function ancestorChain(entries: DirEntry[], relPath: string): string[] {
		for (const entry of entries) {
			if (!entry.is_dir) continue;
			if (relPath === entry.path) return [];
			if (relPath.startsWith(`${entry.path}/`)) {
				if (entry.children.some((child) => child.path === relPath)) return [entry.path];
				const deeper = ancestorChain(entry.children, relPath);
				if (deeper.length > 0) return [entry.path, ...deeper];
			}
		}
		return [];
	}

	function openMenu(state: ContextMenuState): void {
		setConfirmDelete(false);
		setMenu(state);
	}

	function closeMenu(): void {
		setMenu(null);
		setConfirmDelete(false);
	}

	function menuItemsFor(state: ContextMenuState): MenuItem[] {
		const items: MenuItem[] = [];
		if (state.isDir) {
			items.push(
				{
					label: "New file",
					Icon: FilePlus2,
					run: () => {
						setMenu(null);
						setEdit({ kind: "create", parent: state.path, isFolder: false });
						setExpanded((prev) => new Set(prev).add(state.path));
					},
				},
				{
					label: "New folder",
					Icon: FolderPlus,
					run: () => {
						setMenu(null);
						setEdit({ kind: "create", parent: state.path, isFolder: true });
						setExpanded((prev) => new Set(prev).add(state.path));
					},
				},
			);
		} else {
			items.push({
				label: "Open",
				Icon: FileText,
				run: () => {
					closeMenu();
					void openWorkspaceFile(root, state.path);
				},
			});
		}
		if (!state.isRoot) {
			items.push(
				{
					label: "Rename",
					Icon: Type,
					run: () => {
						setMenu(null);
						setEdit({ kind: "rename", path: state.path, name: state.name });
						if (state.isDir) setExpanded((prev) => new Set(prev).add(state.path));
					},
				},
				{
					label: confirmDelete ? "Confirm delete" : "Delete",
					Icon: Trash2,
					danger: true,
					run: () => {
						if (confirmDelete) void deleteEntry(state);
						else setConfirmDelete(true);
					},
				},
			);
		}
		return items;
	}

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-pi-border px-3">
				<span className="text-2xs font-semibold uppercase tracking-widest text-pi-text-muted">
					Explorer
				</span>
				<button
					onClick={() => setEdit({ kind: "create", parent: root, isFolder: false })}
					className="ml-auto flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:text-pi-text"
					aria-label="New file"
					title="New file"
				>
					<FilePlus2 className="size-3" />
				</button>
				<button
					onClick={() => setEdit({ kind: "create", parent: root, isFolder: true })}
					className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:text-pi-text"
					aria-label="New folder"
					title="New folder"
				>
					<FolderPlus className="size-3" />
				</button>
				<button
					onClick={() => void refresh()}
					className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:text-pi-text"
					aria-label="Refresh file tree"
				>
					<RefreshCw className="size-3" />
				</button>
			</div>
			<div
				className="min-h-0 flex-1 overflow-auto py-1.5 pr-1"
				onClick={closeMenu}
			>
				{error && <div className="px-3 py-2 text-xs text-pi-error">{error}</div>}
				{tree === null && !error && (
					<div className="px-3 py-2 text-xs text-pi-text-faint">Reading…</div>
				)}
				{edit?.kind === "create" && edit.parent === root && (
					<EditRow
						depth={0}
						isFolder={edit.isFolder}
						onCancel={() => setEdit(null)}
						onCommit={(name) => void commitCreate(root, edit.isFolder, name)}
					/>
				)}
				{tree?.map((entry) => (
					<Entry
						key={entry.path}
						entry={entry}
						depth={0}
						expanded={expanded}
						activePath={activePath}
						gitByPath={gitByPath}
						root={root}
						edit={edit}
						onToggleDir={toggleDir}
						onEdit={setEdit}
						onCommitCreate={commitCreate}
						onCommitRename={commitRename}
						onMenu={openMenu}
					/>
				))}
			</div>

			{menu && (
				<div
					className="fixed inset-0 z-50"
					onClick={closeMenu}
					onContextMenu={(e) => e.preventDefault()}
				>
					<ContextMenuBox items={menuItemsFor(menu)} state={menu} />
				</div>
			)}
		</div>
	);
}

interface EditRowProps {
	depth: number;
	isFolder: boolean;
	onCancel: () => void;
	onCommit: (name: string) => void;
}

/** Inline name-entry row (VS Code style) for create/rename. */
function EditRow({ depth, isFolder, onCancel, onCommit }: EditRowProps): ReactNode {
	const [value, setValue] = useState("");
	const committed = { current: false };
	return (
		<div
			className="flex items-center gap-1 py-0.5 pr-2"
			style={{ paddingLeft: 8 + depth * 12 }}
			onClick={(e) => e.stopPropagation()}
		>
			{isFolder ? (
				<Folder className="size-3.5 shrink-0 text-pi-accent" />
			) : (
				<FileText className="size-3.5 shrink-0 text-pi-text-faint" />
			)}
			<input
				/* eslint-disable-next-line jsx-a11y/no-autofocus */
				autoFocus
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						committed.current = true;
						onCommit(value);
					} else if (e.key === "Escape") {
						committed.current = true;
						onCancel();
					}
				}}
				onBlur={() => {
					if (!committed.current) onCommit(value);
				}}
				placeholder={isFolder ? "folder name" : "file name"}
				className="min-w-0 flex-1 rounded border border-pi-accent bg-pi-surface-raised px-1.5 py-0.5 text-xs text-pi-text outline-none"
			/>
		</div>
	);
}

interface ContextMenuBoxProps {
	items: MenuItem[];
	state: ContextMenuState;
}

function ContextMenuBox({ items, state }: ContextMenuBoxProps): ReactNode {
	const left = Math.min(state.x, window.innerWidth - 190);
	const top = Math.min(state.y, window.innerHeight - items.length * 30 - 16);
	return (
		<div
			className="fixed w-44 overflow-hidden rounded-lg border border-pi-border-strong bg-pi-surface-raised py-1 shadow-xl"
			style={{ left, top }}
			onClick={(e) => e.stopPropagation()}
		>
			{items.map((item) => (
				<button
					key={item.label}
					onClick={(e) => {
						e.stopPropagation();
						item.run();
					}}
					className={cn(
						"flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-smooth hover:bg-pi-surface-raised",
						item.danger
							? "text-pi-error hover:text-pi-error"
							: "text-pi-text-secondary hover:text-pi-text",
					)}
				>
					<item.Icon className="size-3.5" />
					{item.label}
				</button>
			))}
		</div>
	);
}

interface EntryProps {
	entry: DirEntry;
	depth: number;
	expanded: Set<string>;
	activePath: string | null;
	gitByPath: Map<string, string>;
	root: string;
	edit: EditState;
	onToggleDir: (path: string) => void;
	onEdit: (state: EditState) => void;
	onCommitCreate: (parent: string, isFolder: boolean, name: string) => void;
	onCommitRename: (path: string, oldName: string, name: string) => void;
	onMenu: (state: ContextMenuState) => void;
}

function Entry({
	entry,
	depth,
	expanded,
	activePath,
	gitByPath,
	root,
	edit,
	onToggleDir,
	onEdit,
	onCommitCreate,
	onCommitRename,
	onMenu,
}: EntryProps): ReactNode {
	const isOpen = expanded.has(entry.path);
	const active = activePath === entry.path;
	const status = gitByPath.get(entry.path);
	const { Icon, className } = iconFor(entry.name);

	if (edit?.kind === "rename" && edit.path === entry.path) {
		return (
			<EditRow
				depth={depth}
				isFolder={entry.is_dir}
				onCancel={() => onEdit(null)}
				onCommit={(name) => onCommitRename(entry.path, edit.name, name)}
			/>
		);
	}

	return (
		<>
			<button
				data-ide-entry={entry.path}
				onClick={() =>
					entry.is_dir ? onToggleDir(entry.path) : void openWorkspaceFile(root, entry.path)
				}
				onContextMenu={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onMenu({
						x: e.clientX,
						y: e.clientY,
						path: entry.path,
						isDir: entry.is_dir,
						name: entry.name,
						isRoot: false,
					});
				}}
				className={cn(
					"flex w-full cursor-pointer items-center gap-1 rounded py-1 pr-2 text-left text-xs transition-smooth",
					active
						? "bg-pi-accent-soft text-pi-text"
						: "text-pi-text-secondary hover:bg-pi-surface-raised hover:text-pi-text",
				)}
				style={{ paddingLeft: 8 + depth * 12 }}
			>
				{entry.is_dir ? (
					<ChevronRight
						className={cn("size-3 shrink-0 text-pi-text-faint transition-smooth", isOpen && "rotate-90")}
					/>
				) : (
					<span className="w-3 shrink-0" />
				)}
				{entry.is_dir ? (
					<Folder className={cn("size-3.5 shrink-0", status ? "text-pi-warning" : "text-pi-accent")} />
				) : (
					<Icon className={cn("size-3.5 shrink-0", className)} />
				)}
				<span className={cn("truncate", !entry.is_dir && status !== undefined && status !== "U" && "text-pi-warning")}>
					{entry.name}
				</span>
				{status && (
					<span
						className={cn(
							"ml-auto shrink-0 font-mono font-semibold",
							status === "U" ? "text-pi-text-muted" : "text-pi-warning",
						)}
					>
						{status}
					</span>
				)}
			</button>
			{entry.is_dir && isOpen && edit?.kind === "create" && edit.parent === entry.path && (
				<EditRow
					depth={depth + 1}
					isFolder={edit.isFolder}
					onCancel={() => onEdit(null)}
					onCommit={(name) => onCommitCreate(entry.path, edit.isFolder, name)}
				/>
			)}
			{entry.is_dir &&
				isOpen &&
				depth + 1 < TREE_MAX_DEPTH &&
				entry.children.map((child) => (
					<Entry
						key={child.path}
						entry={child}
						depth={depth + 1}
						expanded={expanded}
						activePath={activePath}
						gitByPath={gitByPath}
						root={root}
						edit={edit}
						onToggleDir={onToggleDir}
						onEdit={onEdit}
						onCommitCreate={onCommitCreate}
						onCommitRename={onCommitRename}
						onMenu={onMenu}
					/>
				))}
		</>
	);
}
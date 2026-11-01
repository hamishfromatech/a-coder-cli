/**
 * Explorer: a keyboard-first, lazy file tree.
 *
 * - One `ide_list_dir` per expansion; children cached, refreshes debounced.
 * - Arrow keys move a selection, →/← expand/collapse (and walk into children /
 *   back to the parent), Enter opens, F2 renames, Delete deletes.
 * - Rows reveal hover actions (new file/folder, rename, delete); the context
 *   menu mirrors them plus copy path and reveal.
 * - Git decorations use repo-relative paths; folders show a dot when anything
 *   below them changed. Expansion persists per workspace.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
	ChevronRight,
	Copy,
	Database,
	FileArchive,
	FileCode2,
	FileImage,
	FileJson,
	FilePlus2,
	FileText,
	Folder,
	FolderOpen,
	FolderPlus,
	ListCollapse,
	Palette,
	Pencil,
	RefreshCw,
	Search,
	Settings2,
	Terminal,
	Trash2,
	type LucideIcon,
} from "lucide-react";

import {
	gitStatus,
	listDir,
	createDirectory,
	createFile,
	deletePath,
	revealPath,
	renamePath,
	type IdeDirEntry,
} from "../../lib/rpc.ts";
import { openWorkspaceFile, writeTextFile } from "../../lib/ide.ts";
import { invalidateQuickOpenIndex } from "./QuickOpen";
import {
	decorationFor,
	fileKind,
	flattenVisible,
	parentOf,
	relativeToRoot,
	type FileKind,
} from "../../lib/explorer.ts";
import { toast } from "../../stores/toast-store";
import { confirm } from "../../stores/confirm-store";
import { useIdeStore } from "../../stores/ide-store";
import { Tip } from "../ui/Tip";
import { cn } from "../../lib/cn.ts";

const KIND_ICON: Record<FileKind, { Icon: LucideIcon; className: string }> = {
	code: { Icon: FileCode2, className: "text-sky-400/85" },
	json: { Icon: FileJson, className: "text-amber-400/85" },
	markdown: { Icon: FileText, className: "text-pi-text-muted" },
	image: { Icon: FileImage, className: "text-fuchsia-300/85" },
	style: { Icon: Palette, className: "text-rose-300/85" },
	data: { Icon: Database, className: "text-teal-300/85" },
	shell: { Icon: Terminal, className: "text-emerald-300/85" },
	config: { Icon: Settings2, className: "text-pi-text-muted" },
	archive: { Icon: FileArchive, className: "text-orange-300/80" },
	text: { Icon: FileText, className: "text-pi-text-faint" },
};

const STATUS_TINT: Record<string, string> = {
	M: "text-pi-warning",
	A: "text-pi-success",
	D: "text-pi-error",
	R: "text-pi-accent",
	U: "text-pi-text-muted",
};

interface CreateEdit {
	kind: "create";
	/** Parent directory (absolute). */
	parent: string;
	isFolder: boolean;
}

interface RenameEdit {
	kind: "rename";
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
}

interface MenuItem {
	label: string;
	Icon: LucideIcon;
	run: () => void;
	danger?: boolean;
}

interface ExplorerProps {
	root: string;
}

export function ExplorerTree({ root }: ExplorerProps): ReactNode {
	const [children, setChildren] = useState<Map<string, IdeDirEntry[]>>(new Map());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
	const [errors, setErrors] = useState<Map<string, string>>(new Map());
	const [filter, setFilter] = useState("");
	const [gitByPath, setGitByPath] = useState<Map<string, string>>(new Map());
	const [edit, setEdit] = useState<EditState>(null);
	const [menu, setMenu] = useState<ContextMenuState | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const activePath = useIdeStore((s) => s.activePath);

	const treeRef = useRef<HTMLDivElement | null>(null);
	const childrenRef = useRef(children);
	const expandedRef = useRef(expanded);
	const selectedRef = useRef(selectedPath);
	childrenRef.current = children;
	expandedRef.current = expanded;
	selectedRef.current = selectedPath;

	const rows = useMemo(
		() => flattenVisible(children, expanded, root, filter),
		[children, expanded, root, filter],
	);
	const rowsRef = useRef(rows);
	rowsRef.current = rows;

	const persistExpanded = useCallback(
		(next: Set<string>) => {
			useIdeStore.getState().setExplorerExpanded(root, [...next]);
		},
		[root],
	);

	const loadDir = useCallback(
		async (path: string): Promise<void> => {
			setLoadingDirs((prev) => new Set(prev).add(path));
			try {
				const entries = await listDir(path);
				setChildren((prev) => new Map(prev).set(path, entries));
				setErrors((prev) => {
					if (!prev.has(path)) return prev;
					const next = new Map(prev);
					next.delete(path);
					return next;
				});
			} catch (e) {
				setErrors((prev) =>
					new Map(prev).set(path, e instanceof Error ? e.message : String(e)),
				);
			} finally {
				setLoadingDirs((prev) => {
					const next = new Set(prev);
					next.delete(path);
					return next;
				});
			}
		},
		[],
	);

	const refreshGit = useCallback(async (): Promise<void> => {
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

	/** Reload every folder already on screen; nothing unopened is touched. */
	const refreshLoaded = useCallback(async (): Promise<void> => {
		const loaded = [...childrenRef.current.keys()];
		await Promise.all([...loaded.map((dir) => loadDir(dir)), refreshGit()]);
	}, [loadDir, refreshGit]);

	const expand = useCallback(
		(path: string, nextExpanded = true): void => {
			setExpanded((prev) => {
				if (prev.has(path) === nextExpanded) return prev;
				const next = new Set(prev);
				if (nextExpanded) next.add(path);
				else next.delete(path);
				persistExpanded(next);
				return next;
			});
			if (nextExpanded && !childrenRef.current.has(path)) void loadDir(path);
		},
		[loadDir, persistExpanded],
	);

	// Root (re)load on workspace change; restore that workspace's expansion.
	useEffect(() => {
		const persisted = useIdeStore.getState().explorerExpanded[root] ?? [];
		const base = root.replace(/[/\\]+$/, "");
		const restored = new Set(
			persisted.filter((path) => path === base || path.startsWith(`${base}/`)),
		);
		setChildren(new Map());
		setErrors(new Map());
		setExpanded(restored);
		setEdit(null);
		setMenu(null);
		setFilter("");
		setSelectedPath(useIdeStore.getState().activePath);
		void loadDir(root);
		void refreshGit();
		for (const dir of restored) {
			if (dir !== root) void loadDir(dir);
		}
	}, [root, loadDir, refreshGit, persistExpanded]);

	// Agent writes: debounce a refresh so a burst of tool edits is one pass.
	useEffect(() => {
		let timer: number | null = null;
		const handler = (): void => {
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = null;
				void refreshLoaded();
			}, 250);
		};
		window.addEventListener("a-coder:agent-files-changed", handler);
		return () => {
			window.removeEventListener("a-coder:agent-files-changed", handler);
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [refreshLoaded]);

	const scrollToRow = useCallback((path: string, focus = true): void => {
		requestAnimationFrame(() => {
			const escaped = typeof CSS !== "undefined" ? CSS.escape(path) : path.replace(/["\\]/g, "\\$&");
			const element = treeRef.current?.querySelector<HTMLElement>(`[data-ide-entry="${escaped}"]`);
			element?.scrollIntoView({ block: "nearest" });
			if (focus) element?.focus({ preventScroll: true });
		});
	}, []);

	// Auto-reveal the active file: expand ancestors (loading each level), select
	// and reveal the row without taking focus from the editor.
	useEffect(() => {
		if (!activePath || !activePath.startsWith(root)) return;
		let cancelled = false;
		const reveal = async (): Promise<void> => {
			const relative = relativeToRoot(activePath, root);
			const segments = relative.split(/[/\\]/).slice(0, -1);
			let dir = root;
			for (const segment of segments) {
				dir = `${dir.replace(/[/\\]+$/, "")}/${segment}`;
				if (cancelled) return;
				if (!childrenRef.current.has(dir)) await loadDir(dir);
				if (cancelled) return;
				if (!expandedRef.current.has(dir)) expand(dir, true);
			}
			setSelectedPath(activePath);
			scrollToRow(activePath, false);
		};
		void reveal();
		return () => {
			cancelled = true;
		};
	}, [activePath, root, loadDir, expand, scrollToRow]);

	function selectRow(path: string | null, focus = true): void {
		setSelectedPath(path);
		if (path && focus) scrollToRow(path);
	}

	function moveSelection(direction: 1 | -1): void {
		const list = rowsRef.current;
		if (list.length === 0) return;
		const index = list.findIndex((row) => row.entry.path === selectedRef.current);
		const next = index < 0 ? (direction > 0 ? 0 : list.length - 1) : index + direction;
		selectRow(list[Math.min(Math.max(next, 0), list.length - 1)]?.entry.path ?? null);
	}

	function handleKeyDown(event: React.KeyboardEvent): void {
		const list = rowsRef.current;
		const index = list.findIndex((row) => row.entry.path === selectedRef.current);
		const current = index >= 0 ? list[index] : null;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			moveSelection(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			moveSelection(-1);
		} else if (event.key === "Home") {
			event.preventDefault();
			selectRow(list[0]?.entry.path ?? null);
		} else if (event.key === "End") {
			event.preventDefault();
			selectRow(list.at(-1)?.entry.path ?? null);
		} else if (event.key === "ArrowRight") {
			if (!current) return;
			event.preventDefault();
			if (current.entry.is_dir && !expandedRef.current.has(current.entry.path)) {
				expand(current.entry.path, true);
			} else if (index + 1 < list.length && list[index + 1].depth > current.depth) {
				selectRow(list[index + 1].entry.path);
			}
		} else if (event.key === "ArrowLeft") {
			if (!current) return;
			event.preventDefault();
			if (current.entry.is_dir && expandedRef.current.has(current.entry.path)) {
				expand(current.entry.path, false);
			} else {
				const parent = parentOf(current.entry.path);
				if (parent.startsWith(root) && parent !== current.entry.path) {
					selectRow(parent === root ? null : parent, parent !== root);
				}
			}
		} else if (event.key === "Enter") {
			if (!current) return;
			event.preventDefault();
			if (current.entry.is_dir) expand(current.entry.path, !expandedRef.current.has(current.entry.path));
			else void openWorkspaceFile(root, current.entry.path);
		} else if (event.key === "F2") {
			if (!current || current.entry.path === root) return;
			event.preventDefault();
			setEdit({ kind: "rename", path: current.entry.path, name: current.entry.name });
		} else if (event.key === "Delete" || event.key === "Backspace") {
			if (!current || current.entry.path === root) return;
			event.preventDefault();
			void requestDelete({
				path: current.entry.path,
				isDir: current.entry.is_dir,
				name: current.entry.name,
			});
		} else if (event.key === "Escape") {
			if (filter) {
				setFilter("");
				event.preventDefault();
			} else if (selectedRef.current) {
				selectRow(null, false);
			}
		}
	}

	async function commitCreate(parent: string, isFolder: boolean, rawName: string): Promise<void> {
		const name = rawName.trim();
		setEdit(null);
		if (!name) return;
		const target = `${parent.replace(/[/\\]+$/, "")}/${name}`;
		try {
			if (isFolder) {
				await createDirectory(target);
				expand(target, true);
			} else {
				await createFile(target);
				await writeTextFile(target, "");
				await openWorkspaceFile(root, target);
			}
			toast.success("Created", name);
		} catch (e) {
			toast.error("Create failed", e instanceof Error ? e.message : String(e));
		}
		invalidateQuickOpenIndex(root);
		await loadDir(parent);
	}

	async function commitRename(path: string, oldName: string, rawName: string): Promise<void> {
		const name = rawName.trim();
		setEdit(null);
		if (!name || name === oldName) return;
		const parent = parentOf(path);
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
		invalidateQuickOpenIndex(root);
		await loadDir(parent);
	}

	function requestDelete(target: { path: string; isDir: boolean; name: string }): void {
		void confirm({
			title: `Delete “${target.name}”?`,
			message: target.isDir
				? "The folder and everything inside it is removed from disk."
				: "The file is removed from disk.",
			confirmLabel: "Delete",
			danger: true,
			onConfirm: async () => {
				await deletePath(target.path, target.isDir);
				const store = useIdeStore.getState();
				const prefix = `${target.path.replace(/[/\\]+$/, "")}/`;
				for (const tab of [...store.openTabs]) {
					if (tab.path === target.path || tab.path.startsWith(prefix)) store.closeTab(tab.path);
				}
				invalidateQuickOpenIndex(root);
				void loadDir(parentOf(target.path) || root);
				void loadDir(root);
				toast.success("Deleted", target.name);
			},
		});
	}

	function openMenu(state: ContextMenuState): void {
		setMenu(state);
	}

	const menuItemsFor = (state: ContextMenuState): MenuItem[] => {
		const items: MenuItem[] = [];
		const createIn = state.isDir ? state.path : parentOf(state.path);
		if (state.isDir) {
			items.push(
				{
					label: "New file",
					Icon: FilePlus2,
					run: () => {
						setMenu(null);
						setEdit({ kind: "create", parent: state.path, isFolder: false });
						expand(state.path, true);
					},
				},
				{
					label: "New folder",
					Icon: FolderPlus,
					run: () => {
						setMenu(null);
						setEdit({ kind: "create", parent: state.path, isFolder: true });
						expand(state.path, true);
					},
				},
			);
		} else {
			items.push(
				{
					label: "Open",
					Icon: FileText,
					run: () => {
						setMenu(null);
						void openWorkspaceFile(root, state.path);
					},
				},
				{
					label: "New file beside",
					Icon: FilePlus2,
					run: () => {
						setMenu(null);
						setEdit({ kind: "create", parent: createIn, isFolder: false });
						expand(createIn, true);
					},
				},
			);
		}
		items.push(
			{
				label: "Copy relative path",
				Icon: Copy,
				run: () => {
					setMenu(null);
					const relative = relativeToRoot(state.path, root);
					void navigator.clipboard
						.writeText(relative)
						.then(() => toast.success("Path copied", relative))
						.catch(() => {});
				},
			},
			{
				label: "Reveal in file manager",
				Icon: FolderOpen,
				run: () => {
					setMenu(null);
					void revealPath(state.path).catch((e) =>
						toast.error("Could not reveal", e instanceof Error ? e.message : String(e)),
					);
				},
			},
		);
		if (state.path !== root) {
			items.push(
				{
					label: "Rename",
					Icon: Pencil,
					run: () => {
						setMenu(null);
						setEdit({ kind: "rename", path: state.path, name: state.name });
					},
				},
				{
					label: "Delete",
					Icon: Trash2,
					danger: true,
					run: () => {
						setMenu(null);
						setSelectedPath(state.path);
						requestDelete(state);
					},
				},
			);
		}
		return items;
	};

	const rootError = errors.get(root);
	const filtering = filter.trim().length > 0;
	const showEditAt = (parent: string): boolean => edit?.kind === "create" && edit.parent === parent;

	// Insert points for the inline create row (after the parent row, or first).
	const rootEditRow = showEditAt(root) ? (
		<EditRow
			key="edit-root"
			depth={0}
			isFolder={(edit as CreateEdit).isFolder}
			onCancel={() => setEdit(null)}
			onCommit={(name) => void commitCreate(root, (edit as CreateEdit).isFolder, name)}
		/>
	) : null;

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-pi-border px-3">
				<span className="text-2xs font-semibold uppercase tracking-widest text-pi-text-muted">
					Explorer
				</span>
				<div className="ml-auto flex items-center gap-0.5">
					<Tip content="New file" placement="toolbar">
						<button
							onClick={() => {
								setEdit({ kind: "create", parent: root, isFolder: false });
								setSelectedPath(null);
							}}
							className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:bg-pi-surface-raised hover:text-pi-text"
							aria-label="New file"
						>
							<FilePlus2 className="size-3" />
						</button>
					</Tip>
					<Tip content="New folder" placement="toolbar">
						<button
							onClick={() => {
								setEdit({ kind: "create", parent: root, isFolder: true });
								setSelectedPath(null);
							}}
							className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:bg-pi-surface-raised hover:text-pi-text"
							aria-label="New folder"
						>
							<FolderPlus className="size-3" />
						</button>
					</Tip>
					<Tip content="Collapse all" placement="toolbar">
						<button
							onClick={() => {
								setExpanded(new Set());
								persistExpanded(new Set());
							}}
							className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:bg-pi-surface-raised hover:text-pi-text"
							aria-label="Collapse all folders"
						>
							<ListCollapse className="size-3" />
						</button>
					</Tip>
					<Tip content="Refresh" placement="toolbar">
						<button
							onClick={() => void refreshLoaded()}
							className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:bg-pi-surface-raised hover:text-pi-text"
							aria-label="Refresh file tree"
						>
							<RefreshCw className="size-3" />
						</button>
					</Tip>
				</div>
			</div>

			<div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-pi-border px-2">
				<Search className="size-3 shrink-0 text-pi-text-faint" />
				<input
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") setFilter("");
						if (event.key === "ArrowDown") {
							event.preventDefault();
							event.currentTarget.blur();
							treeRef.current?.focus();
							moveSelection(1);
						}
					}}
					placeholder="Filter files…"
					aria-label="Filter files"
					spellCheck={false}
					className="h-full min-w-0 flex-1 bg-transparent text-2xs text-pi-text outline-none placeholder:text-pi-text-faint"
				/>
				{filtering && (
					<button
						type="button"
						onClick={() => setFilter("")}
						className="cursor-pointer rounded px-1 text-3xs text-pi-text-faint hover:text-pi-text"
					>
						clear
					</button>
				)}
			</div>

			<div
				ref={treeRef}
				role="tree"
				aria-label="Workspace files"
				aria-multiselectable={false}
				tabIndex={0}
				onKeyDown={handleKeyDown}
				onClick={(event) => {
					setMenu(null);
					if (event.target === event.currentTarget) selectRow(null, false);
				}}
				onContextMenu={(event) => {
					if (event.target !== event.currentTarget) return;
					event.preventDefault();
					openMenu({
						x: event.clientX,
						y: event.clientY,
						path: root,
						isDir: true,
						name: root.split(/[/\\]/).filter(Boolean).at(-1) ?? root,
					});
				}}
				className="min-h-0 flex-1 overflow-auto py-1 outline-none"
			>
				{rootError && (
					<div className="mx-2 mb-1 flex items-center gap-2 rounded border border-pi-error/40 bg-pi-error-soft px-2 py-1.5 text-2xs text-pi-error">
						<span className="min-w-0 flex-1 truncate">{rootError}</span>
						<button
							type="button"
							onClick={() => void loadDir(root)}
							className="shrink-0 cursor-pointer rounded px-1 py-0.5 hover:bg-pi-error/10"
						>
							Retry
						</button>
					</div>
				)}
				{children.size === 0 && !rootError && (
					<div className="px-3 py-2 text-xs text-pi-text-faint">Reading…</div>
				)}
				{children.get(root)?.length === 0 && (
					<div className="px-3 py-3 text-2xs leading-relaxed text-pi-text-faint">
						This folder is empty. Create a file or folder with the buttons above.
					</div>
				)}
				{rootEditRow}
				{rows.map((row) => {
					const { entry, depth } = row;
					const isOpen = expanded.has(entry.path);
					const selected = selectedPath === entry.path;
					const isActive = activePath === entry.path;
					const { letter, dirtyDir } = decorationFor(entry.path, entry.is_dir, root, gitByPath);
					const kind = entry.is_dir
						? null
						: KIND_ICON[fileKind(entry.name)];
					if (edit?.kind === "rename" && edit.path === entry.path) {
						return (
							<EditRow
								key={entry.path}
								depth={depth}
								isFolder={entry.is_dir}
								initial={edit.name}
								onCancel={() => setEdit(null)}
								onCommit={(name) => void commitRename(entry.path, edit.name, name)}
							/>
						);
					}
					const afterRow =
						entry.is_dir && isOpen && showEditAt(entry.path) ? (
							<EditRow
								key={`edit:${entry.path}`}
								depth={depth + 1}
								isFolder={(edit as CreateEdit).isFolder}
								onCancel={() => setEdit(null)}
								onCommit={(name) => void commitCreate(entry.path, (edit as CreateEdit).isFolder, name)}
							/>
						) : null;
					const isEmptyDir =
						entry.is_dir &&
						isOpen &&
						(children.get(entry.path)?.length ?? 0) === 0 &&
						!loadingDirs.has(entry.path) &&
						!errors.has(entry.path);
					const dirError = entry.is_dir && isOpen ? errors.get(entry.path) : undefined;
					return (
						<div key={entry.path}>
							<div
								role="treeitem"
								aria-level={depth + 1}
								aria-selected={selected}
								aria-expanded={entry.is_dir ? isOpen : undefined}
								tabIndex={-1}
								data-ide-entry={entry.path}
								onClick={(event) => {
									event.stopPropagation();
									setSelectedPath(entry.path);
									event.currentTarget.focus({ preventScroll: true });
									if (entry.is_dir) expand(entry.path, !isOpen);
									else void openWorkspaceFile(root, entry.path);
								}}
								onContextMenu={(event) => {
									event.preventDefault();
									event.stopPropagation();
									selectRow(entry.path, false);
									openMenu({
										x: event.clientX,
										y: event.clientY,
										path: entry.path,
										isDir: entry.is_dir,
										name: entry.name,
									});
								}}
								className={cn(
									"group relative flex h-6 cursor-pointer items-center gap-1 pr-1.5 text-xs transition-smooth",
									selected
										? "bg-pi-accent-soft text-pi-text shadow-[inset_0_0_0_1px_var(--pi-accent-ring)]"
										: isActive
											? "bg-pi-surface-raised/70 text-pi-text"
											: "text-pi-text-secondary hover:bg-pi-surface-raised/70 hover:text-pi-text",
								)}
								style={{ paddingLeft: 6 + depth * 12 }}
							>
								{/* Indent guides: one hairline per ancestor level. */}
								{Array.from({ length: depth }, (_, level) => (
									<span
										key={level}
										aria-hidden
										className="absolute inset-y-0 w-px bg-pi-border/60"
										style={{ left: 11 + level * 12 }}
									/>
								))}
								{entry.is_dir ? (
									<ChevronRight
										className={cn(
											"size-3 shrink-0 text-pi-text-faint transition-transform duration-100",
											isOpen && "rotate-90",
										)}
									/>
								) : (
									<span className="w-3 shrink-0" />
								)}
								{entry.is_dir ? (
									isOpen ? (
										<FolderOpen className={cn("size-3.5 shrink-0", dirtyDir ? "text-pi-warning" : "text-pi-accent")} />
									) : (
										<Folder className={cn("size-3.5 shrink-0", dirtyDir ? "text-pi-warning" : "text-pi-accent")} />
									)
								) : (
									kind && <kind.Icon className={cn("size-3.5 shrink-0", kind.className)} />
								)}
								<span className={cn("min-w-0 flex-1 truncate", letter === "D" && "text-pi-text-faint line-through")}>
									{entry.name}
								</span>
								{letter && (
									<span className={cn("shrink-0 font-mono text-2xs font-semibold", STATUS_TINT[letter] ?? "text-pi-warning")}>
										{letter}
									</span>
								)}
								{dirtyDir && <span className="size-1.5 shrink-0 rounded-full bg-pi-warning/80" aria-label="changes inside" />}
								{/* Hover actions: discoverable without the context menu. */}
								<span className="flex shrink-0 items-center gap-px opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
									{entry.is_dir && (
										<RowAction
											label="New file"
											onClick={() => {
												setEdit({ kind: "create", parent: entry.path, isFolder: false });
												expand(entry.path, true);
											}}
										>
											<FilePlus2 className="size-3" />
										</RowAction>
									)}
									{entry.path !== root && (
										<>
											<RowAction
												label="Rename"
												onClick={() => setEdit({ kind: "rename", path: entry.path, name: entry.name })}
											>
												<Pencil className="size-3" />
											</RowAction>
											<RowAction
												label="Delete"
												danger
												onClick={() => requestDelete({ path: entry.path, isDir: entry.is_dir, name: entry.name })}
											>
												<Trash2 className="size-3" />
											</RowAction>
										</>
									)}
								</span>
							</div>
							{afterRow}
							{isEmptyDir && (
								<div
									className="py-0.5 text-3xs italic text-pi-text-faint"
									style={{ paddingLeft: 26 + (depth + 1) * 12 }}
								>
									Empty folder
								</div>
							)}
							{dirError && (
								<div
									className="flex items-center gap-2 py-0.5 pr-2 text-3xs text-pi-error"
									style={{ paddingLeft: 26 + (depth + 1) * 12 }}
								>
									<span className="min-w-0 flex-1 truncate">{dirError}</span>
									<button
										type="button"
										onClick={() => void loadDir(entry.path)}
										className="shrink-0 cursor-pointer rounded px-1 hover:bg-pi-error/10"
									>
										Retry
									</button>
								</div>
							)}
							{entry.is_dir && isOpen && loadingDirs.has(entry.path) && (
								<div
									className="py-0.5 text-3xs text-pi-text-faint"
									style={{ paddingLeft: 26 + (depth + 1) * 12 }}
								>
									Reading…
								</div>
							)}
						</div>
					);
				})}
				{filtering && rows.length === 0 && (
					<div className="px-3 py-2 text-2xs text-pi-text-faint">
						No loaded files match. Expand a folder or use search to scan the workspace.
					</div>
				)}
				{filtering && rows.length > 0 && (
					<div className="px-3 pb-1 pt-2 text-3xs text-pi-text-faint">
						Filtering loaded folders — expand a folder to search inside it.
					</div>
				)}
			</div>

			{menu && (
				<div className="fixed inset-0 z-50" onClick={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()}>
					<ContextMenuBox items={menuItemsFor(menu)} state={menu} />
				</div>
			)}
		</div>
	);
}

function RowAction({
	label,
	danger,
	onClick,
	children,
}: {
	label: string;
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}): ReactNode {
	return (
		<Tip content={label} placement="toolbar">
			<button
				type="button"
				aria-label={label}
				onClick={(event) => {
					event.stopPropagation();
					onClick();
				}}
				onMouseDown={(event) => event.stopPropagation()}
				className={cn(
					"flex h-4 w-4 items-center justify-center rounded transition-smooth",
					danger
						? "text-pi-text-faint hover:bg-pi-error/15 hover:text-pi-error"
						: "text-pi-text-faint hover:bg-pi-border/40 hover:text-pi-text",
				)}
			>
				{children}
			</button>
		</Tip>
	);
}

interface EditRowProps {
	depth: number;
	isFolder: boolean;
	/** Prefilled value for renames. */
	initial?: string;
	onCancel: () => void;
	onCommit: (name: string) => void;
}

/** Inline name-entry row (VS Code style) for create/rename. */
function EditRow({ depth, isFolder, initial = "", onCancel, onCommit }: EditRowProps): ReactNode {
	const [value, setValue] = useState(initial);
	const committed = useRef(false);
	return (
		<div
			className="flex items-center gap-1 py-0.5 pr-2"
			style={{ paddingLeft: 6 + depth * 12 + 16 }}
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
				onFocus={(event) => {
					const dot = value.lastIndexOf(".");
					event.currentTarget.setSelectionRange(0, dot > 0 ? dot : value.length);
				}}
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
				aria-label={isFolder ? "New folder name" : "New file name"}
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
	const left = Math.min(state.x, window.innerWidth - 220);
	const top = Math.min(state.y, window.innerHeight - items.length * 30 - 16);
	return (
		<div
			className="fixed w-56 overflow-hidden rounded-lg border border-pi-border-strong bg-pi-surface-raised py-1 shadow-xl"
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
						"flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-smooth hover:bg-pi-surface-overlay",
						item.danger ? "text-pi-error hover:text-pi-error" : "text-pi-text-secondary hover:text-pi-text",
					)}
				>
					<item.Icon className="size-3.5" />
					{item.label}
				</button>
			))}
		</div>
	);
}

/**
 * Editor group: Monaco with one tab per open file. Models are created per
 * workspace path (URI-keyed) and reused between tab switches; ⌘S writes the
 * active model back to disk, ⌘⌥S saves every dirty tab, ⌘G jumps to a line,
 * ⌥⌘←/→ cycles editors, and closing a dirty tab asks before discarding.
 *
 * Dirty state is tracked as a small path set and only re-renders when a file
 * flips between clean and dirty, so typing does not repaint the tab strip on
 * every keystroke. Models are disposed when their tab closes.
 */

import { getMonacoWorker } from "../../lib/monaco-workers.ts";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
	Check,
	FolderOpen,
	Search,
	SlidersHorizontal,
	SquareTerminal,
	X,
} from "lucide-react";

import { languageForPath, readTextFile, writeTextFile } from "../../lib/ide.ts";
import { ensureMonacoTheme } from "../../lib/monaco-theme.ts";
import { toast } from "../../stores/toast-store";
import { useIdeStore } from "../../stores/ide-store";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { Tip } from "../ui/Tip";
import { cn } from "../../lib/cn.ts";

// Monaco web workers (vite: relative-in-node_modules wrapper). TS/JS rides
// the ts worker, so TypeScript is IntelliSense-complete with no LSP setup.
self.MonacoEnvironment = {
	getWorker(_workerId: string, label: string) {
		return getMonacoWorker(label);
	},
};


/** Selection context sent to the composer is capped; the file may be huge. */
const AI_CONTEXT_LIMIT = 12_000;

interface EditorGroupProps {
	workspaceRoot: string;
}

interface CursorStatus {
	line: number;
	column: number;
	selected: number;
}

export function EditorGroup({ workspaceRoot }: EditorGroupProps): ReactNode {
	const openTabs = useIdeStore((s) => s.openTabs);
	const activePath = useIdeStore((s) => s.activePath);
	const setActive = useIdeStore((s) => s.setActive);
	const moveTab = useIdeStore((s) => s.moveTab);
	const pendingReveal = useIdeStore((s) => s.pendingReveal);
	const fontSize = useIdeStore((s) => s.editorFontSize);
	const minimap = useIdeStore((s) => s.editorMinimap);
	const wordWrap = useIdeStore((s) => s.editorWordWrap);
	const renderWhitespace = useIdeStore((s) => s.editorRenderWhitespace);
	const setFontSize = useIdeStore((s) => s.setEditorFontSize);
	const setMinimap = useIdeStore((s) => s.setEditorMinimap);
	const setWordWrap = useIdeStore((s) => s.setEditorWordWrap);
	const setRenderWhitespace = useIdeStore((s) => s.setEditorRenderWhitespace);

	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
	/** The path whose model is attached; content listeners read this. */
	const currentPathRef = useRef<string | null>(activePath);
	/** Editor commands outlive renders; AI prompts must use the current root. */
	const workspaceRootRef = useRef(workspaceRoot);
	workspaceRootRef.current = workspaceRoot;

	const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
	const dirtyRef = useRef(dirtyPaths);
	dirtyRef.current = dirtyPaths;

	const [cursor, setCursor] = useState<CursorStatus>({ line: 1, column: 1, selected: 0 });
	const [pendingClose, setPendingClose] = useState<string[] | null>(null);
	const [goToLineOpen, setGoToLineOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [dragPath, setDragPath] = useState<string | null>(null);

	/** Recompute one model's dirty flag, re-rendering only when it flips. */
	const refreshDirty = useCallback((path: string) => {
		const model = modelsRef.current.get(path);
		if (!model) return;
		const tab = useIdeStore.getState().openTabs.find((entry) => entry.path === path);
		if (!tab) return;
		const isDirty = model.getValue() !== tab.lastSaved;
		setDirtyPaths((prev) => {
			if (prev.has(path) === isDirty) return prev;
			const next = new Set(prev);
			if (isDirty) next.add(path);
			else next.delete(path);
			return next;
		});
	}, []);

	const savePath = useCallback(async (path: string): Promise<boolean> => {
		const model = modelsRef.current.get(path);
		if (!model) return true;
		const value = model.getValue();
		try {
			await writeTextFile(path, value);
			useIdeStore.getState().setSaved(path, value);
			setDirtyPaths((prev) => {
				if (!prev.has(path)) return prev;
				const next = new Set(prev);
				next.delete(path);
				return next;
			});
			return true;
		} catch (e) {
			toast.error("Save failed", e instanceof Error ? e.message : String(e));
			return false;
		}
	}, []);

	const saveActive = useCallback(async (): Promise<void> => {
		const path = useIdeStore.getState().activePath;
		if (!path) return;
		if (await savePath(path)) toast.success("Saved", displayName(path));
	}, [savePath]);

	const saveAll = useCallback(async (): Promise<void> => {
		const paths = [...dirtyRef.current];
		if (paths.length === 0) {
			toast.info("Nothing to save", "No unsaved editors.");
			return;
		}
		let saved = 0;
		for (const path of paths) {
			if (await savePath(path)) saved += 1;
		}
		if (saved > 0) toast.success("Saved", `${saved} file${saved === 1 ? "" : "s"}`);
	}, [savePath]);

	/** Close one or more tabs, asking first when any of them is dirty. */
	const requestClose = useCallback(
		(paths: string[]): void => {
			const remaining = paths.filter((path) => useIdeStore.getState().openTabs.some((tab) => tab.path === path));
			if (remaining.length === 0) return;
			if (!remaining.some((path) => dirtyRef.current.has(path))) {
				for (const path of remaining) useIdeStore.getState().closeTab(path);
				return;
			}
			setPendingClose(remaining);
		},
		[],
	);

	const cycleEditor = useCallback((direction: 1 | -1): void => {
		const { openTabs: tabs, activePath: current, setActive: activate } = useIdeStore.getState();
		if (tabs.length < 2) return;
		const index = tabs.findIndex((tab) => tab.path === current);
		const next = tabs[(index + direction + tabs.length) % tabs.length];
		if (next) activate(next.path);
	}, []);

	// Create the editor once. A bad custom theme must never blank the surface:
	// fall back to stock vs-dark.
	useEffect(() => {
		const theme = ensureMonacoTheme();
		let editor: monaco.editor.IStandaloneCodeEditor;
		try {
			editor = monaco.editor.create(containerRef.current!, {
				theme,
				automaticLayout: true,
				fontSize: useIdeStore.getState().editorFontSize,
				fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Code", monospace',
				minimap: { enabled: useIdeStore.getState().editorMinimap, renderCharacters: false },
				scrollBeyondLastLine: false,
				smoothScrolling: true,
				renderLineHighlight: "all",
				renderWhitespace: useIdeStore.getState().editorRenderWhitespace ? "all" : "selection",
				stickyScroll: { enabled: true },
				tabSize: 2,
				padding: { top: 10 },
				scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
			});
		} catch {
			editor = monaco.editor.create(containerRef.current!, {
				theme: "vs-dark",
				automaticLayout: true,
				fontSize: 13,
			});
		}
		editorRef.current = editor;

		const contentListener = editor.onDidChangeModelContent(() => {
			const path = currentPathRef.current;
			if (path) refreshDirty(path);
		});
		// Cursor/selection updates are coalesced to one per frame: a fast typist
		// would otherwise repaint the status bar on every keystroke.
		let frame: number | null = null;
		let pending: CursorStatus = { line: 1, column: 1, selected: 0 };
		const flush = (): void => {
			frame = null;
			setCursor(pending);
		};
		const cursorListener = editor.onDidChangeCursorSelection((event) => {
			const model = editor.getModel();
			pending = {
				line: event.selection.positionLineNumber,
				column: event.selection.positionColumn,
				selected: model ? model.getValueLengthInRange(event.selection) : 0,
			};
			if (frame === null) frame = requestAnimationFrame(flush);
		});

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveActive());
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyS, () => void saveAll());
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => setGoToLineOpen(true));
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow, () =>
			cycleEditor(-1),
		);
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.RightArrow, () =>
			cycleEditor(1),
		);
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () =>
			askAICoder(editor, "Explain this file.", workspaceRootRef.current),
		);
		editor.addAction({
			id: "a-coder.explain",
			label: "A-Coder: Explain selection",
			contextMenuGroupId: "a-coder",
			contextMenuOrder: 1,
			run: (instance) => askAICoder(instance, "Explain the selected code.", workspaceRootRef.current),
		});
		editor.addAction({
			id: "a-coder.fix",
			label: "A-Coder: Fix or improve selection",
			contextMenuGroupId: "a-coder",
			contextMenuOrder: 2,
			run: (instance) =>
				askAICoder(instance, "Fix bugs and improve this code. Keep the behavior intact.", workspaceRootRef.current),
		});
		editor.addAction({
			id: "a-coder.tests",
			label: "A-Coder: Add tests",
			contextMenuGroupId: "a-coder",
			contextMenuOrder: 3,
			run: (instance) => askAICoder(instance, "Write focused tests for this code.", workspaceRootRef.current),
		});
		editor.addAction({
			id: "a-coder.refactor",
			label: "A-Coder: Refactor selection",
			contextMenuGroupId: "a-coder",
			contextMenuOrder: 4,
			run: (instance) =>
				askAICoder(instance, "Refactor this code for clarity without changing behavior.", workspaceRootRef.current),
		});

		return () => {
			if (frame !== null) cancelAnimationFrame(frame);
			contentListener.dispose();
			cursorListener.dispose();
			editor.dispose();
			editorRef.current = null;
			for (const model of modelsRef.current.values()) model.dispose();
			modelsRef.current.clear();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Editor preferences.
	useEffect(() => {
		editorRef.current?.updateOptions({
			fontSize,
			minimap: { enabled: minimap, renderCharacters: false },
			wordWrap: wordWrap ? "on" : "off",
			renderWhitespace: renderWhitespace ? "all" : "selection",
		});
	}, [fontSize, minimap, wordWrap, renderWhitespace]);

	// Load content for tabs that have no model yet (opened from the explorer),
	// and focus the active model.
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;
		for (const tab of openTabs) {
			void ensureModel(tab.path);
		}
		const active = activePath != null ? modelsRef.current.get(activePath) : undefined;
		if (active && editor.getModel() !== active) {
			editor.setModel(active);
		} else if (!activePath) {
			editor.setModel(null);
		}
		currentPathRef.current = activePath;
		if (activePath) refreshDirty(activePath);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activePath, openTabPathsKey(openTabs)]);

	// Dispose models whose tab closed (after the switch effect detached them).
	useEffect(() => {
		const open = new Set(useIdeStore.getState().openTabs.map((tab) => tab.path));
		for (const [path, model] of [...modelsRef.current.entries()]) {
			if (open.has(path)) continue;
			if (editorRef.current?.getModel() === model) editorRef.current.setModel(null);
			model.dispose();
			modelsRef.current.delete(path);
		}
		for (const path of [...dirtyRef.current]) {
			if (!open.has(path)) {
				setDirtyPaths((prev) => {
					const next = new Set(prev);
					next.delete(path);
					return next;
				});
			}
		}
	}, [openTabs]);

	async function ensureModel(path: string): Promise<void> {
		if (modelsRef.current.has(path)) return;
		let content: string;
		try {
			content = await readTextFile(path);
		} catch (e) {
			toast.error("Could not open file", e instanceof Error ? e.message : String(e));
			useIdeStore.getState().closeTab(path);
			return;
		}
		// A disposed tab may have closed while the read was in flight.
		if (!useIdeStore.getState().openTabs.some((tab) => tab.path === path)) return;
		const language = languageForPath(path) ?? "plaintext";
		const model = monaco.editor.createModel(content, language, monaco.Uri.file(path));
		model.updateOptions({ tabSize: 2 });
		modelsRef.current.set(path, model);
		useIdeStore.getState().setSaved(path, content);
		if (useIdeStore.getState().activePath === path) editorRef.current?.setModel(model);
	}

	// Agent freshness from the engine's file tools (event, immediate) + a slow
	// poll as a safety net: un-dirty models refresh; dirty user edits never
	// get clobbered.
	const refreshCleanModels = useCallback(async () => {
		const { openTabs: tabs } = useIdeStore.getState();
		for (const tab of tabs) {
			const model = modelsRef.current.get(tab.path);
			if (!model) continue;
			if (model.getValue() !== tab.lastSaved) continue;
			let disk: string | null = null;
			try {
				disk = await readTextFile(tab.path);
			} catch {
				continue;
			}
			if (disk === null || disk === tab.lastSaved) continue;
			model.setValue(disk);
			useIdeStore.getState().setSaved(tab.path, disk);
			refreshDirty(tab.path);
		}
	}, [refreshDirty]);

	useEffect(() => {
		const handler = (): void => void refreshCleanModels();
		window.addEventListener("a-coder:agent-files-changed", handler);
		const timer = setInterval(handler, 4000);
		return () => {
			window.removeEventListener("a-coder:agent-files-changed", handler);
			clearInterval(timer);
		};
	}, [refreshCleanModels]);

	// ⌘W closes the active editor (when this surface is mounted), ⌥⌘←/→ cycle
	// even while focus sits in the sidebar, ⌘⇧S is Save All like many editors.
	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.defaultPrevented) return;
			const mod = event.metaKey || event.ctrlKey;
			if (!mod) return;
			const active = useIdeStore.getState().activePath;
			if (event.key.toLowerCase() === "w" && !event.shiftKey && !event.altKey) {
				if (!active) return;
				event.preventDefault();
				requestClose([active]);
				return;
			}
			if (event.shiftKey && event.key.toLowerCase() === "s") {
				// Leave the shortcut to the app when the IDE has no unsaved work.
				if (dirtyRef.current.size === 0) return;
				event.preventDefault();
				void saveAll();
				return;
			}
			if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
				event.preventDefault();
				cycleEditor(event.key === "ArrowRight" ? 1 : -1);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [requestClose, saveAll, cycleEditor]);

	// Word wrap etc. are editor-wide, not model-owned; the settings effect above
	// handles them. Consume the store's reveal request (search results land here).
	useEffect(() => {
		if (!pendingReveal) return;
		if (pendingReveal.path !== activePath) return;
		const model = modelsRef.current.get(pendingReveal.path);
		const editor = editorRef.current;
		if (!model || !editor || editor.getModel() !== model) return;
		editor.revealLineInCenter(pendingReveal.line);
		editor.setPosition({ lineNumber: pendingReveal.line, column: 1 });
		editor.focus();
		useIdeStore.getState().setPendingReveal(null);
	}, [pendingReveal, activePath, openTabs]);

	const activeModel = activePath != null ? modelsRef.current.get(activePath) : undefined;
	const activeDirty = activePath != null && dirtyPaths.has(activePath);

	const finishClose = useCallback(
		async (mode: "save" | "discard" | "cancel"): Promise<void> => {
			const paths = pendingClose;
			if (!paths) return;
			if (mode === "cancel") {
				setPendingClose(null);
				return;
			}
			if (mode === "save") {
				for (const path of paths) {
					if (dirtyRef.current.has(path) && !(await savePath(path))) return;
				}
			}
			setPendingClose(null);
			for (const path of paths) useIdeStore.getState().closeTab(path);
		},
		[pendingClose, savePath],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{activePath && (
				<div className="flex h-6 shrink-0 items-center gap-1 border-b border-pi-border bg-pi-surface px-3 font-mono text-2xs text-pi-text-faint">
					{relativeToRoot(activePath, workspaceRoot)
						.split("/")
						.filter(Boolean)
						.map((segment, index, segments) => (
							<span key={`${segment}:${index}`} className="flex items-center gap-1">
								<span className={index === segments.length - 1 ? "text-pi-text-secondary" : undefined}>
									{segment}
								</span>
								{index < segments.length - 1 && <span className="text-pi-border-strong">›</span>}
							</span>
						))}
					{activeDirty && <span className="ml-1 size-1.5 rounded-full bg-pi-accent" title="Unsaved changes" />}
				</div>
			)}
			<div className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-pi-border bg-pi-surface px-1 pt-1">
				{openTabs.length === 0 && (
					<div className="px-2 pb-1.5 text-xs text-pi-text-faint">
						No files open — ⌘P to jump to one, or browse the explorer
					</div>
				)}
				{openTabs.map((tab) => {
					const isDirty = dirtyPaths.has(tab.path);
					const isActive = tab.path === activePath;
					return (
						<div
							key={tab.path}
							draggable
							onDragStart={() => setDragPath(tab.path)}
							onDragEnd={() => setDragPath(null)}
							onDragOver={(event) => {
								if (dragPath) event.preventDefault();
							}}
							onDrop={(event) => {
								event.preventDefault();
								if (dragPath && dragPath !== tab.path) moveTab(dragPath, tab.path);
								setDragPath(null);
							}}
							onClick={() => setActive(tab.path)}
							onAuxClick={(event) => {
								if (event.button === 1) {
									event.preventDefault();
									requestClose([tab.path]);
								}
							}}
							className={cn(
								"group flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-3 text-xs transition-smooth",
								isActive
									? "border-pi-accent bg-pi-surface-raised text-pi-text"
									: "border-transparent text-pi-text-muted hover:bg-pi-surface-raised/60 hover:text-pi-text",
								dragPath === tab.path && "opacity-50",
							)}
						>
							<span className="max-w-40 truncate">{displayName(tab.path)}</span>
							{isDirty && <span className="size-1.5 shrink-0 rounded-full bg-pi-accent" />}
							<button
								onClick={(event) => {
									event.stopPropagation();
									requestClose([tab.path]);
								}}
								className={cn(
									"flex h-4 w-4 items-center justify-center rounded hover:bg-pi-border/40",
									isDirty ? "opacity-100" : "opacity-0 group-hover:opacity-100",
								)}
								aria-label={`Close ${displayName(tab.path)}`}
							>
								<X className="size-3" />
							</button>
						</div>
					);
				})}
			</div>
			<div className="relative min-h-0 flex-1">
				<div ref={containerRef} className="h-full" />
				{goToLineOpen && (
					<GoToLine
						maxLine={activeModel?.getLineCount() ?? 1}
						onClose={() => setGoToLineOpen(false)}
						onGo={(line) => {
							const editor = editorRef.current;
							if (!editor) return;
							editor.revealLineInCenter(line);
							editor.setPosition({ lineNumber: line, column: 1 });
							editor.focus();
						}}
					/>
				)}
				{openTabs.length === 0 && (
					<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 bg-pi-bg/60 text-center">
						<div className="pointer-events-auto flex flex-col items-center gap-1">
							<p className="text-sm text-pi-text-muted">Nothing open</p>
							<div className="mt-2 grid grid-cols-1 gap-1 text-2xs text-pi-text-faint">
								<span className="flex items-center justify-center gap-2">
									<Search className="size-3" /> ⌘P — quick open a file
								</span>
								<span className="flex items-center justify-center gap-2">
									<SquareTerminal className="size-3" /> Ctrl+` — toggle terminal
								</span>
								<span className="flex items-center justify-center gap-2">
									<FolderOpen className="size-3" /> browse the explorer to open files
								</span>
							</div>
						</div>
					</div>
				)}
			</div>
			<div className="relative flex h-6 shrink-0 items-center gap-3 border-t border-pi-border bg-pi-surface px-3 font-mono text-2xs text-pi-text-muted">
				{activeModel ? (
					<>
						<span className="max-w-56 truncate text-pi-text-faint">
							{relativeToRoot(activePath ?? "", workspaceRoot) || displayName(activePath ?? "")}
							{activeDirty ? " •" : ""}
						</span>
						<span className="uppercase">{languageLabelFor(activeModel.getLanguageId())}</span>
						<span>UTF-8</span>
						<span>{activeModel.getEOL() === "\r\n" ? "CRLF" : "LF"}</span>
						<span>Spaces: {activeModel.getOptions().tabSize}</span>
						<span>{formatBytes(activeModel.getValueLength())}</span>
						<span className="ml-auto">
							{cursor.selected > 0
								? `${cursor.selected} selected`
								: `Ln ${cursor.line}, Col ${cursor.column}`}
						</span>
						<button
							onClick={() => setWordWrap(!wordWrap)}
							title="Toggle word wrap (⌥Z)"
							className={cn("cursor-pointer hover:text-pi-text", wordWrap && "text-pi-accent")}
						>
							Wrap
						</button>
						<button onClick={() => void saveActive()} className="cursor-pointer hover:text-pi-text">
							Save
						</button>
						<Tip content="Editor settings" placement="control">
							<button
								onClick={() => setSettingsOpen((value) => !value)}
								className="flex h-4 w-4 cursor-pointer items-center justify-center rounded hover:text-pi-text"
								aria-label="Editor settings"
							>
								<SlidersHorizontal className="size-3" />
							</button>
						</Tip>
					</>
				) : (
					<span className="truncate text-pi-text-faint">{displayName(workspaceRoot)}</span>
				)}
				{settingsOpen && (
					<EditorSettingsPopover
						onClose={() => setSettingsOpen(false)}
						fontSize={fontSize}
						onFontSize={setFontSize}
						minimap={minimap}
						onMinimap={setMinimap}
						wordWrap={wordWrap}
						onWordWrap={setWordWrap}
						renderWhitespace={renderWhitespace}
						onRenderWhitespace={setRenderWhitespace}
						onSaveAll={() => void saveAll()}
						onCloseAll={() => requestClose(openTabs.map((tab) => tab.path))}
					/>
				)}
			</div>

			{pendingClose && (
				<ModalBackdrop onClick={() => void finishClose("cancel")}>
					<ModalPanel className="max-w-sm">
						<div className="border-b border-pi-border px-4 py-2.5">
							<h2 className="text-sm font-medium text-pi-text">
								{pendingClose.length === 1
									? `Save changes to ${displayName(pendingClose[0])}?`
									: `Save changes to ${pendingClose.length} files?`}
							</h2>
						</div>
						<p className="px-4 py-3 text-xs text-pi-text-muted">
							Your edits will be lost if you close without saving.
						</p>
						<div className="flex justify-end gap-2 border-t border-pi-border px-4 py-2.5">
							<button
								type="button"
								onClick={() => void finishClose("cancel")}
								className="cursor-pointer rounded-md border border-pi-border px-2.5 py-1 text-xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void finishClose("discard")}
								className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-pi-error transition-hover hover:bg-pi-error-soft"
							>
								Don't save
							</button>
							<button
								type="button"
								onClick={() => void finishClose("save")}
								className="cursor-pointer rounded-md bg-pi-accent px-2.5 py-1 text-xs font-medium text-pi-accent-foreground transition-hover hover:bg-pi-accent-hover"
							>
								Save
							</button>
						</div>
					</ModalPanel>
				</ModalBackdrop>
			)}
		</div>
	);
}

/** Ask about the selection (or file): prefill the composer with capped context. */
function askAICoder(editor: monaco.editor.ICodeEditor, instruction: string, workspaceRoot: string): void {
	const model = editor.getModel();
	if (!model) return;
	const selection = editor.getSelection();
	const hasSelection = Boolean(selection && !selection.isEmpty());
	const code = hasSelection && selection ? model.getValueInRange(selection) : model.getValue();
	const clipped =
		code.length > AI_CONTEXT_LIMIT
			? `${code.slice(0, AI_CONTEXT_LIMIT)}\n… (truncated ${code.length - AI_CONTEXT_LIMIT} characters)`
			: code;
	const absolute = useIdeStore.getState().activePath ?? "";
	const path = absolute.startsWith(workspaceRoot)
		? absolute.slice(workspaceRoot.length).replace(/^[/\\]/, "")
		: absolute;
	const language = model.getLanguageId();
	const range = hasSelection && selection ? `lines ${selection.startLineNumber}–${selection.endLineNumber}` : "whole file";
	const prompt = `In \`${path}\` (${range}):\n\n\`\`\`${language}\n${clipped}\n\`\`\`\n\n${instruction}`;
	window.dispatchEvent(new CustomEvent("a-coder:set-editor-text", { detail: { text: prompt, append: true } }));
	toast.info("Context sent to the composer", "Review the message, then send it.");
}

function GoToLine({
	maxLine,
	onClose,
	onGo,
}: {
	maxLine: number;
	onClose: () => void;
	onGo: (line: number) => void;
}): ReactNode {
	const [value, setValue] = useState("");
	const submit = (): void => {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed)) return;
		onGo(Math.min(Math.max(parsed, 1), Math.max(1, maxLine)));
		onClose();
	};
	return (
		<div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-lg border border-pi-border bg-pi-surface-overlay px-2 py-1 shadow-overlay">
			<span className="font-mono text-3xs text-pi-text-faint">Go to line</span>
			<input
				autoFocus
				value={value}
				onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ""))}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						submit();
					} else if (event.key === "Escape") {
						onClose();
					}
				}}
				placeholder={`1–${maxLine}`}
				className="h-6 w-20 rounded border border-pi-border bg-pi-bg px-1.5 font-mono text-xs text-pi-text outline-none focus:border-pi-accent"
			/>
		</div>
	);
}

function EditorSettingsPopover({
	onClose,
	fontSize,
	onFontSize,
	minimap,
	onMinimap,
	wordWrap,
	onWordWrap,
	renderWhitespace,
	onRenderWhitespace,
	onSaveAll,
	onCloseAll,
}: {
	onClose: () => void;
	fontSize: number;
	onFontSize: (size: number) => void;
	minimap: boolean;
	onMinimap: (value: boolean) => void;
	wordWrap: boolean;
	onWordWrap: (value: boolean) => void;
	renderWhitespace: boolean;
	onRenderWhitespace: (value: boolean) => void;
	onSaveAll: () => void;
	onCloseAll: () => void;
}): ReactNode {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const onDown = (event: MouseEvent): void => {
			if (ref.current && !ref.current.contains(event.target as Node)) onClose();
		};
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [onClose]);
	const check = (checked: boolean, label: string, onChange: (value: boolean) => void): ReactNode => (
		<button
			type="button"
			onClick={() => onChange(!checked)}
			className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
		>
			<span
				className={cn(
					"flex h-3 w-3 items-center justify-center rounded-[3px] border",
					checked ? "border-pi-accent bg-pi-accent text-pi-accent-foreground" : "border-pi-border-strong",
				)}
			>
				{checked && <Check className="h-2 w-2" />}
			</span>
			{label}
		</button>
	);
	return (
		<div
			ref={ref}
			className="absolute bottom-full right-2 z-30 mb-1.5 w-56 rounded-lg border border-pi-border bg-pi-surface-overlay p-1 shadow-overlay"
			role="dialog"
			aria-label="Editor settings"
		>
			<div className="flex items-center justify-between px-2 py-1">
				<span className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Font size</span>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => onFontSize(fontSize - 1)}
						className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-muted hover:bg-pi-surface-raised hover:text-pi-text"
						aria-label="Decrease font size"
					>
						−
					</button>
					<span className="w-6 text-center font-mono text-xs tabular-nums text-pi-text">{fontSize}</span>
					<button
						type="button"
						onClick={() => onFontSize(fontSize + 1)}
						className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-muted hover:bg-pi-surface-raised hover:text-pi-text"
						aria-label="Increase font size"
					>
						+
					</button>
				</div>
			</div>
			<div className="my-1 h-px bg-pi-border" />
			{check(minimap, "Minimap", onMinimap)}
			{check(wordWrap, "Word wrap", onWordWrap)}
			{check(renderWhitespace, "Render whitespace", onRenderWhitespace)}
			<div className="my-1 h-px bg-pi-border" />
			<button
				type="button"
				onClick={onSaveAll}
				className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
			>
				Save all <span className="ml-auto font-mono text-3xs text-pi-text-faint">⌘⇧S</span>
			</button>
			<button
				type="button"
				onClick={onCloseAll}
				className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-pi-text-secondary transition-hover hover:bg-pi-error-soft hover:text-pi-error"
			>
				Close all editors
			</button>
		</div>
	);
}

function openTabPathsKey(tabs: { path: string }[]): string {
	return tabs.map((tab) => tab.path).join("\u0000");
}

function displayName(path: string): string {
	return path.split(/[/\\]/).at(-1) ?? path;
}

function relativeToRoot(path: string, root: string): string {
	if (!path || !root) return "";
	if (path.startsWith(root)) return path.slice(root.length).replace(/^[/\\]/, "");
	return path;
}

function languageLabelFor(languageId: string): string {
	if (!languageId || languageId === "plaintext") return "text";
	return languageId;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

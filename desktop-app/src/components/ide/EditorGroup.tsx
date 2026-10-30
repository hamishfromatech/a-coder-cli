/**
 * Editor group: Monaco with one tab per open file. Models are created per
 * workspace path (URI-keyed) and reused between tab switches; ⌘S writes the
 * active model's current value back to disk.
 */

import { getMonacoWorker } from "../../lib/monaco-workers.ts";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Search, SquareTerminal, X } from "lucide-react";

import { languageForPath, readTextFile, tokenColor, tokenColorAlpha, writeTextFile } from "../../lib/ide.ts";
import { toast } from "../../stores/toast-store";
import { useIdeStore } from "../../stores/ide-store";
import { cn } from "../../lib/cn.ts";

// Monaco web workers (vite: relative-in-node_modules wrapper). TS/JS rides
// the ts worker, so TypeScript is IntelliSense-complete with no LSP setup.
self.MonacoEnvironment = {
	getWorker(_workerId: string, label: string) {
		return getMonacoWorker(label);
	},
};

/** Runtime palette pass: pick the closest VS Code theme from the app tokens. */
let themeRegistered = false;
function ensureMonacoTheme(): string {
	if (themeRegistered) return "a-coder-dark";
	try {
		monaco.editor.defineTheme("a-coder-dark", {
			base: "vs-dark",
			inherit: true,
			rules: [],
			colors: {
				"editor.background": tokenColor("--pi-bg", "#16181d"),
				"editor.foreground": tokenColor("--pi-text", "#d6dbe4"),
				"editorLineNumber.foreground": tokenColor("--pi-text-faint", "#4b5058"),
				"editorGutter.background": tokenColor("--pi-bg", "#16181d"),
				"editor.lineHighlightBackground": tokenColorAlpha("--pi-accent", 0.1, "#4f7dd9"),
				"editorCursor.foreground": tokenColor("--pi-accent", "#4f7dd9"),
				"editorIndentGuide.background1": tokenColor("--pi-border", "#2a2e35"),
				"editor.selectionBackground": tokenColorAlpha("--pi-accent", 0.25, "#4f7dd9"),
			},
		});
		themeRegistered = true;
	} catch {
		return IDE_DEFAULT_FALLBACK;
	}
	return "a-coder-dark";
}
const IDE_DEFAULT_FALLBACK = "vs-dark";

interface EditorGroupProps {
	workspaceRoot: string;
}

export function EditorGroup({ workspaceRoot }: EditorGroupProps) {
	const openTabs = useIdeStore((s) => s.openTabs);
	const activePath = useIdeStore((s) => s.activePath);
	const closeTab = useIdeStore((s) => s.closeTab);
	const setActive = useIdeStore((s) => s.setActive);
	const pendingReveal = useIdeStore((s) => s.pendingReveal);

	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
	/** The tab state value this render painted with — dirty flags derive from it. */
	const [tick, setTick] = useState(0);
	const [cursor, setCursor] = useState({ line: 1, column: 1 });
	const [wordWrap, setWordWrap] = useState(false);

	// Create the editor once. A bad custom theme must never blank the surface:
	// fall back to stock vs-dark.
	useEffect(() => {
		const theme = ensureMonacoTheme();
		let editor: monaco.editor.IStandaloneCodeEditor;
		try {
			editor = monaco.editor.create(containerRef.current!, {
				theme,
				automaticLayout: true,
				fontSize: 13,
				fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Code", monospace',
				minimap: { enabled: true, renderCharacters: false },
				scrollBeyondLastLine: false,
				smoothScrolling: true,
				renderLineHighlight: "all",
				renderWhitespace: "selection",
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

		const contentListener = editor.onDidChangeModelContent(() => setTick((t) => t + 1));
		const cursorListener = editor.onDidChangeCursorPosition((e) =>
			setCursor({ line: e.position.lineNumber, column: e.position.column }),
		);
		// ⌘S saves the active model; ⌥Z toggles word wrap. The commands die
		// with the editor, no explicit dispose exists for addCommand ids.
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveActive());
		editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () =>
			setWordWrap((value) => !value),
		);

		return () => {
			contentListener.dispose();
			cursorListener.dispose();
			editor.dispose();
			editorRef.current = null;
			for (const model of modelsRef.current.values()) model.dispose();
			modelsRef.current.clear();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Save helper (stable identity via store actions).
	async function saveActive(): Promise<void> {
		const path = useIdeStore.getState().activePath;
		const editor = editorRef.current;
		if (!path || !editor) return;
		const model = modelsRef.current.get(path);
		if (!model) return;
		const value = model.getValue();
		try {
			await writeTextFile(path, value);
			useIdeStore.getState().setSaved(path, value);
			setTick((t) => t + 1);
			toast.success("Saved", displayName(path));
		} catch (e) {
			toast.error("Save failed", e instanceof Error ? e.message : String(e));
		}
	}

	// Load content for tabs that have no model yet (opened from the explorer),
	// and focus the active model.
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;
		for (const tab of openTabs) {
			if (modelsRef.current.has(tab.path)) continue;
			// Content was handed to the store on open; for tabs whose store
			// content is a sentinel (opened from session restore), refetch.
		void ensureModel(tab.path);
		}
		const active = activePath != null ? modelsRef.current.get(activePath) : undefined;
		if (active) editor.setModel(active);
		else if (!activePath) editor.setModel(null);
		setTick((t) => t + 1);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activePath, openTabPathsKey(openTabs)]);

	async function ensureModel(path: string): Promise<void> {
		if (modelsRef.current.has(path)) return;
		let content: string;
		try {
			// Always read from disk: the store only carries the save snapshot.
			content = await readTextFile(path);
		} catch (e) {
			toast.error("Could not open file", e instanceof Error ? e.message : String(e));
			useIdeStore.getState().closeTab(path);
			return;
		}
		const language = languageForPath(path) ?? "plaintext";
		const model = monaco.editor.createModel(content, language, monaco.Uri.file(path));
		model.updateOptions({ tabSize: 2 });
		modelsRef.current.set(path, model);
		const store = useIdeStore.getState();
		store.setSaved(path, content);
		const activeNow = useIdeStore.getState().activePath;
		if (activeNow === path) editorRef.current?.setModel(model);
		setTick((t) => t + 1);
	}

	// Agent freshness from the engine's file tools (event, immediate) + a slow
	// poll as a safety net: un-dirty models refresh; dirty user edits never
	// get clobbered.
	const refreshCleanModels = useCallback(async () => {
		const { openTabs, activePath } = useIdeStore.getState();
		for (const tab of openTabs) {
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
			if (tab.path === activePath) setTick((t) => t + 1);
		}
	}, []);

	useEffect(() => {
		const handler = () => void refreshCleanModels();
		window.addEventListener("a-coder:agent-files-changed", handler);
		const timer = setInterval(handler, 4000);
		return () => {
			window.removeEventListener("a-coder:agent-files-changed", handler);
			clearInterval(timer);
		};
	}, [refreshCleanModels]);

	const activeModel = activePath != null ? modelsRef.current.get(activePath) : undefined;

	// Word wrap follows the toggle (editor-wide, models don't own it).
	useEffect(() => {
		editorRef.current?.updateOptions({ wordWrap: wordWrap ? "on" : "off" });
	}, [wordWrap]);

	// Consume the store's reveal request (search results land here): when the
	// requested tab is active with a model, jump to the line and focus.
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
	}, [pendingReveal, activePath, tick]);

	const dirty = (path: string): boolean => {
		const tab = openTabs.find((t) => t.path === path);
		const model = modelsRef.current.get(path);
		if (!tab || !model) return false;
		return model.getValue() !== tab.lastSaved;
	};

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
				</div>
			)}
			<div className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-pi-border bg-pi-surface px-1 pt-1">
				{openTabs.length === 0 && (
					<div className="px-2 pb-1.5 text-xs text-pi-text-faint">
						No files open — ⌘P to jump to one, or browse the explorer
					</div>
				)}
				{openTabs.map((tab) => {
					const isDirty = dirty(tab.path);
					const isActive = tab.path === activePath;
					return (
						<div
							key={tab.path}
							onClick={() => setActive(tab.path)}
							className={cn(
								"group flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-3 text-xs transition-smooth",
								isActive
									? "border-pi-accent bg-pi-surface-raised text-pi-text"
									: "border-transparent text-pi-text-muted hover:bg-pi-surface-raised/60 hover:text-pi-text",
							)}
						>
							<span className="max-w-40 truncate">{displayName(tab.path)}</span>
							{isDirty && <span className="size-1.5 rounded-full bg-pi-accent" />}
							<button
								onClick={(e) => {
									e.stopPropagation();
									closeTab(tab.path);
								}}
								onMouseDown={(e) => {
									if (e.button === 1) {
										e.preventDefault();
										e.stopPropagation();
										closeTab(tab.path);
									}
								}}
								className="flex h-4 w-4 items-center justify-center rounded opacity-0 transition-smooth group-hover:opacity-100 hover:bg-pi-border/40"
								aria-label={`Close ${displayName(tab.path)}`}
							>
								<X className="size-3" />
							</button>
						</div>
					);
				})}
				{openTabs.length === 0 && (
					<div className="px-2 pb-1.5 text-xs text-pi-text-faint">
						Open a file from the explorer — or ask the agent to
					</div>
				)}
			</div>
			<div className="relative min-h-0 flex-1">
				<div ref={containerRef} className="h-full" />
				{openTabs.length === 0 && (
					<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 bg-pi-bg/60 text-center">
						<div className="pointer-events-auto flex flex-col items-center gap-1">
							<p className="text-sm text-pi-text-muted">Nothing open</p>
							<div className="mt-2 grid grid-cols-1 gap-1 text-2xs text-pi-text-faint">
								<span className="flex items-center gap-2 justify-center">
									<Search className="size-3" /> ⌘P — quick open a file
								</span>
								<span className="flex items-center gap-2 justify-center">
									<SquareTerminal className="size-3" /> Ctrl+` — toggle terminal
								</span>
								<span className="flex items-center gap-2 justify-center">
									<FolderOpen className="size-3" /> browse the explorer to open files
								</span>
							</div>
						</div>
					</div>
				)}
			</div>
			<div className="flex h-6 shrink-0 items-center gap-3 border-t border-pi-border bg-pi-surface px-3 font-mono text-2xs text-pi-text-muted">
				{activeModel ? (
					<>
						<span className="truncate text-pi-text-faint">
							{relativeToRoot(activePath ?? "", workspaceRoot) || displayName(activePath ?? "")}
						</span>
						<span className="uppercase">
							{languageLabelFor(activeModel.getLanguageId())}
						</span>
						<span className="ml-auto">
							Line {cursor.line}, Col {cursor.column}
						</span>
						<span>{Math.round(activeModel.getValue().length / 1024)} KB</span>
						<button
							onClick={() => setWordWrap((value) => !value)}
							title="Toggle word wrap (⌥Z)"
							className={cn("cursor-pointer", wordWrap && "text-pi-accent")}
						>
							Wrap ⌥Z
						</button>
						<button onClick={() => void saveActive()} className="cursor-pointer hover:text-pi-text">
							Save ⌘S
						</button>
					</>
				) : (
					<span className="truncate text-pi-text-faint">{displayName(workspaceRoot)}</span>
				)}
			</div>
			{/* keep tick referenced so content edits repaint the dirty dots */}
			<span className="hidden">{tick}</span>
		</div>
	);
}

function openTabPathsKey(tabs: { path: string }[]): string {
	return tabs.map((t) => t.path).join("\u0000");
}

function displayName(path: string): string {
	return path.split(/[/\\]/).at(-1) ?? path;
}

function relativeToRoot(path: string, root: string): string {
	if (!path || !root) return "";
	if (path.startsWith(root)) return path.slice(root.length).replace(/^[/\\]/, "");
	return path;
}

/** Human label for a Monaco language id (they're already lowercase words). */
function languageLabelFor(languageId: string): string {
	if (!languageId || languageId === "plaintext") return "text";
	return languageId;
}
/**
 * Source-control diff: a two-pane Monaco diff for one changed file. Unstaged
 * files compare the index against the working tree; staged files compare HEAD
 * against the index. Read-only, with the actions a diff needs: open the file,
 * stage/unstage, close. Esc closes.
 */

import * as monaco from "monaco-editor";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Minus, Plus, X } from "lucide-react";

import { gitFileContent, gitStage, gitUnstage, type GitFileChange } from "../../lib/rpc.ts";
import { languageForPath, openWorkspaceFile, readTextFile } from "../../lib/ide.ts";
import { ensureMonacoTheme } from "../../lib/monaco-theme.ts";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { toast } from "../../stores/toast-store";
import { cn } from "../../lib/cn.ts";

interface GitDiffDialogProps {
	root: string;
	change: GitFileChange;
	staged: boolean;
	onClose: () => void;
	onChanged: () => void;
}

export function GitDiffDialog({ root, change, staged, onClose, onChanged }: GitDiffDialogProps): ReactNode {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let disposed = false;
		let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
		let originalModel: monaco.editor.ITextModel | null = null;
		let modifiedModel: monaco.editor.ITextModel | null = null;

		void (async () => {
			try {
				const [original, modified] = await Promise.all([
					gitFileContent(root, change.path, staged ? "HEAD" : "index"),
					staged
						? gitFileContent(root, change.path, "index")
						: // A deleted working file has no text; the diff shows it as removed.
							readTextFile(`${root.replace(/[/\\]+$/, "")}/${change.path}`).catch(() => ""),
				]);
				if (disposed || !containerRef.current) return;
				const language = languageForPath(change.path) ?? "plaintext";
				originalModel = monaco.editor.createModel(original ?? "", language, monaco.Uri.parse(`git:/original/${change.path}`));
				modifiedModel = monaco.editor.createModel(
					modified ?? "",
					language,
					monaco.Uri.parse(`git:/modified/${change.path}`),
				);
				diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
					theme: ensureMonacoTheme(),
					automaticLayout: true,
					readOnly: true,
					renderSideBySide: true,
					scrollBeyondLastLine: false,
					fontSize: 12.5,
					fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, monospace',
					minimap: { enabled: false },
					renderOverviewRuler: false,
				});
				diffEditor.setModel({ original: originalModel, modified: modifiedModel });
				setLoading(false);
			} catch (e) {
				if (!disposed) {
					setError(e instanceof Error ? e.message : String(e));
					setLoading(false);
				}
			}
		})();

		return () => {
			disposed = true;
			diffEditor?.dispose();
			originalModel?.dispose();
			modifiedModel?.dispose();
		};
	}, [root, change.path, staged]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	const act = async (kind: "stage" | "unstage"): Promise<void> => {
		try {
			if (kind === "stage") await gitStage(root, [change.path]);
			else await gitUnstage(root, [change.path]);
			toast.success(kind === "stage" ? "Staged" : "Unstaged", fileBase(change.path));
			onChanged();
			onClose();
		} catch (e) {
			toast.error("Git action failed", e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<ModalBackdrop onClick={onClose}>
			<ModalPanel
				className="relative flex h-[80vh] w-[min(1100px,92vw)] max-w-none flex-col p-0"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex shrink-0 items-center gap-2 border-b border-pi-border px-4 py-2.5">
					<span className="truncate font-mono text-xs text-pi-text">{change.path}</span>
					<span className="shrink-0 rounded bg-pi-surface-raised px-1.5 py-0.5 text-3xs uppercase tracking-wide text-pi-text-muted">
						{staged ? "staged" : "working tree"}
					</span>
					<div className="ml-auto flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={() => {
								void openWorkspaceFile(root, change.path);
								onClose();
							}}
							className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-2xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						>
							<ExternalLink className="size-3" /> Open file
						</button>
						<button
							type="button"
							onClick={() => void act(staged ? "unstage" : "stage")}
							className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-2xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						>
							{staged ? <Minus className="size-3" /> : <Plus className="size-3" />}
							{staged ? "Unstage" : "Stage"}
						</button>
						<button
							type="button"
							onClick={onClose}
							className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
							aria-label="Close diff"
						>
							<X className="size-3.5" />
						</button>
					</div>
				</div>
				<div className={cn("relative min-h-0 flex-1 bg-pi-bg", error && "hidden")} ref={containerRef} />
				{loading && !error && (
					<div className="absolute inset-0 flex items-center justify-center text-xs text-pi-text-faint">
						Loading diff…
					</div>
				)}
				{error && (
					<div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs text-pi-error">
						{error}
					</div>
				)}
			</ModalPanel>
		</ModalBackdrop>
	);
}

function fileBase(path: string): string {
	return path.split(/[/\\]/).at(-1) ?? path;
}

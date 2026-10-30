/**
 * Source-control rail panel: branch + changed files (staged / unstaged /
 * untracked) from the Tauri gitStatus command, with per-file stage/unstage/
 * discard (hover buttons, discard is a two-step confirm). Click opens the
 * file in the editor.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GitBranch, Minus, Plus, RotateCcw } from "lucide-react";

import { gitStatus, gitStage, gitUnstage, gitDiscard, type GitFileChange, type GitStatus } from "../../lib/rpc.ts";
import { openWorkspaceFile } from "../../lib/ide.ts";
import { cn } from "../../lib/cn.ts";

const STATUS_BADGE: Record<GitFileChange["status"], { letter: string; color: string }> = {
	modified: { letter: "M", color: "text-pi-warning" },
	added: { letter: "A", color: "text-pi-success" },
	deleted: { letter: "D", color: "text-pi-error" },
	renamed: { letter: "R", color: "text-pi-accent" },
	untracked: { letter: "U", color: "text-pi-text-muted" },
};

interface GitPanelProps {
	root: string;
}

export function GitPanel({ root }: GitPanelProps): ReactNode {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const next = await gitStatus(root);
			setStatus(next);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [root]);

	useEffect(() => {
		setStatus(null);
		setError(null);
		setConfirmDiscard(null);
		void refresh();
	}, [refresh]);

	// Agent edits change the working tree; refresh like the explorer does.
	useEffect(() => {
		const handler = () => void refresh();
		window.addEventListener("a-coder:agent-files-changed", handler);
		return () => window.removeEventListener("a-coder:agent-files-changed", handler);
	}, [refresh]);

	async function act(kind: "stage" | "unstage" | "discard", path: string): Promise<void> {
		try {
			if (kind === "stage") await gitStage(root, [path]);
			else if (kind === "unstage") await gitUnstage(root, [path]);
			else await gitDiscard(root, path);
			setConfirmDiscard(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		void refresh();
	}

	const groups = status
		? ([
				["Staged", status.staged, "staged"],
				["Changes", status.unstaged, "unstaged"],
				["Untracked", status.untracked, "untracked"],
			] as Array<[string, GitFileChange[], "staged" | "unstaged" | "untracked"]>).filter(([, files]) => files.length > 0)
		: [];

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-pi-border px-3">
				<span className="text-2xs font-semibold uppercase tracking-widest text-pi-text-muted">
					Source control
				</span>
				{status?.branch && (
					<span className="ml-auto flex items-center gap-1 font-mono text-2xs text-pi-text-secondary">
						<GitBranch className="size-3" />
						{status.branch.name}
						{status.branch.ahead > 0 && <span className="text-pi-text-muted">↑{status.branch.ahead}</span>}
						{status.branch.behind > 0 && <span className="text-pi-text-muted">↓{status.branch.behind}</span>}
					</span>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-auto py-1.5 pr-1" onClick={() => setConfirmDiscard(null)}>
				{error && <div className="px-3 py-2 text-xs text-pi-error">{error}</div>}
				{status && groups.length === 0 && (
					<div className="px-3 py-2 text-xs text-pi-text-faint">No changes</div>
				)}
				{groups.map(([label, files, group]) => (
					<div key={label} className="mb-2">
						<div className="px-3 py-1 text-2xs font-semibold text-pi-text-faint">
							{label} <span className="text-pi-text-muted">{files.length}</span>
						</div>
						{files.map((change) => {
							const badge = STATUS_BADGE[change.status];
							const discarding = confirmDiscard === change.path;
							return (
								<div
									key={`${change.path}:${change.staged ? "s" : "u"}`}
									className="group flex w-full items-center gap-1 rounded pr-1 pl-3 text-xs text-pi-text-secondary transition-smooth hover:bg-pi-surface-raised hover:text-pi-text"
								>
									<button
										onClick={() => void openWorkspaceFile(root, change.path)}
										className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 py-1 text-left"
									>
										<span className="truncate">{fileBase(change.path)}</span>
										<span className="ml-auto shrink-0 font-mono text-2xs">{dirBase(change.path)}</span>
										<span className={cn("w-3 shrink-0 text-center font-mono font-semibold", badge.color)}>
											{badge.letter}
										</span>
									</button>
									<span className="flex shrink-0 items-center gap-px opacity-0 transition-smooth group-hover:opacity-100">
										{(group === "unstaged" || group === "untracked") && (
											<ActionButton
												tooltip="Stage (+)"
												onClick={() => void act("stage", change.path)}
											>
												<Plus className="size-3" />
											</ActionButton>
										)}
										{group === "staged" && (
											<ActionButton
												tooltip="Unstage (−)"
												onClick={() => void act("unstage", change.path)}
											>
												<Minus className="size-3" />
											</ActionButton>
										)}
										{group === "unstaged" &&
											(discarding ? (
												<ActionButton
													tooltip="Confirm discard"
													danger
													onClick={() => void act("discard", change.path)}
												>
													<span className="text-2xs font-semibold">✓</span>
												</ActionButton>
											) : (
												<ActionButton
													tooltip="Discard changes"
													danger
													onClick={(e) => {
														e.stopPropagation();
														setConfirmDiscard(change.path);
													}}
												>
													<RotateCcw className="size-3" />
												</ActionButton>
											))}
									</span>
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}

function ActionButton({
	tooltip,
	onClick,
	danger,
	children,
}: {
	tooltip: string;
	onClick: (event: React.MouseEvent) => void;
	danger?: boolean;
	children: ReactNode;
}): ReactNode {
	void tooltip;
	return (
		<button
			onClick={onClick}
			title={tooltip}
			aria-label={tooltip}
			className={cn(
				"flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-smooth",
				danger ? "hover:bg-pi-error/10 hover:text-pi-error" : "hover:bg-pi-border/40 hover:text-pi-text",
			)}
		>
			{children}
		</button>
	);
}

function fileBase(path: string): string {
	return path.split(/[/\\]/).at(-1) ?? path;
}

function dirBase(path: string): string {
	const parts = path.split(/[/\\]/);
	return parts.length > 1 ? (parts.at(-2) ?? "") : "";
}
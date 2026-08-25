import { useCallback, useEffect, useState } from "react";
import {
	FileText,
	Loader2,
	Minus,
	Plus,
	RefreshCw,
} from "lucide-react";
import {
	gitDiff,
	gitStatus,
	type GitFileChange,
	type GitStatus,
} from "../../lib/rpc";
import { useUiStore } from "../../stores/ui-store";

interface Props {
	projectPath: string | null;
}

const STATUS_LABEL: Record<GitFileChange["status"], string> = {
	modified: "M",
	added: "A",
	deleted: "D",
	renamed: "R",
	untracked: "U",
};

const STATUS_COLOR: Record<GitFileChange["status"], string> = {
	modified: "text-pi-warning",
	added: "text-pi-success",
	deleted: "text-pi-error",
	renamed: "text-pi-accent",
	untracked: "text-pi-text-muted",
};

export function GitPanel({ projectPath }: Props) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [diff, setDiff] = useState<string | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);
	const [diffError, setDiffError] = useState<string | null>(null);
	const { selectedGitFile, selectedGitStaged, setSelectedGitFile } =
		useUiStore();

	const load = useCallback(async () => {
		if (!projectPath) return;
		setLoading(true);
		setError(null);
		try {
			const s = await gitStatus(projectPath);
			setStatus(s);
		} catch (e) {
			setStatus(null);
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [projectPath]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!projectPath || !selectedGitFile) {
			setDiff(null);
			return;
		}
		setDiffLoading(true);
		setDiffError(null);
		gitDiff(projectPath, selectedGitFile, selectedGitStaged)
			.then((d) => setDiff(d))
			.catch((e) => {
				setDiff(null);
				setDiffError(e instanceof Error ? e.message : String(e));
			})
			.finally(() => setDiffLoading(false));
	}, [projectPath, selectedGitFile, selectedGitStaged]);

	const totalChanges =
		(status?.staged.length ?? 0) +
		(status?.unstaged.length ?? 0) +
		(status?.untracked.length ?? 0);

	if (!projectPath) {
		return (
			<div className="flex flex-1 items-center justify-center p-6 text-center text-2xs text-pi-text-faint">
				No project open.
			</div>
		);
	}

	const hasSelection = !!selectedGitFile;

	return (
		<div className="flex h-full w-full min-w-0 flex-col">
			{error && !status && (
				<div className="m-2 rounded-md bg-pi-error-soft px-3 py-2 text-2xs text-pi-error">
					{error}
				</div>
			)}

			{/* Header */}
			<div className="flex items-center justify-between border-b border-pi-border px-3 py-2">
				<div className="flex items-center gap-2">
					<span className="text-2xs font-semibold tracking-tight">Git</span>
					<span className="rounded bg-pi-surface-overlay px-1.5 py-0.5 font-mono text-3xs text-pi-text-muted">
						{totalChanges}
					</span>
				</div>
				<button
					onClick={() => void load()}
					className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
aria-label="Refresh"
				>
					<RefreshCw className="h-3 w-3" />
				</button>
			</div>

			{/* Body: stacked list + detail below a min-height */}
			<div className="flex min-h-0 flex-1 flex-col">
				{/* File list */}
				<div className="flex min-h-git-empty shrink-0 flex-col border-b border-pi-border">
					<div className="flex-1 overflow-y-auto">
						{totalChanges === 0 && !loading && (
							<EmptyMessage>Working tree clean</EmptyMessage>
						)}

						{status && status.staged.length > 0 && (
							<Group label="Staged" count={status.staged.length}>
								{status.staged.map((f) => (
									<FileRow
										key={`s-${f.path}`}
										change={f}
										selected={selectedGitFile === f.path && selectedGitStaged}
										onClick={() => setSelectedGitFile(f.path, true)}
									/>
								))}
							</Group>
						)}
						{status && status.unstaged.length > 0 && (
							<Group label="Changed" count={status.unstaged.length}>
								{status.unstaged.map((f) => (
									<FileRow
										key={`u-${f.path}`}
										change={f}
										selected={selectedGitFile === f.path && !selectedGitStaged}
										onClick={() => setSelectedGitFile(f.path, false)}
									/>
								))}
							</Group>
						)}
						{status && status.untracked.length > 0 && (
							<Group label="Untracked" count={status.untracked.length}>
								{status.untracked.map((f) => (
									<FileRow
										key={`t-${f.path}`}
										change={f}
										selected={selectedGitFile === f.path && !selectedGitStaged}
										onClick={() => setSelectedGitFile(f.path, false)}
									/>
								))}
							</Group>
						)}
					</div>
				</div>

				{/* Diff viewer */}
				<div className="flex min-h-0 flex-1 flex-col bg-pi-bg/40">
					{!hasSelection && (
						<EmptyMessage>Select a file to view its diff.</EmptyMessage>
					)}
					{hasSelection && (
						<>
							<div className="border-b border-pi-border px-2.5 py-1.5 font-mono text-3xs text-pi-text-muted">
								<div className="truncate" title={selectedGitFile}>
									{selectedGitFile}
								</div>
								<div className="mt-0.5 text-pi-text-faint">
									{selectedGitStaged ? "staged" : "working tree"}
								</div>
							</div>
							<div className="flex-1 overflow-auto p-2 font-mono text-3xs leading-relaxed">
								{diffLoading && (
									<div className="flex items-center gap-1.5 text-pi-text-muted">
										<Loader2 className="h-3 w-3 animate-spin" />
										loading diff…
									</div>
								)}
								{diffError && (
									<div className="text-pi-error">{diffError}</div>
								)}
								{diff !== null && !diffLoading && !diffError && (
									<DiffView diff={diff} />
								)}
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function Group({
	label,
	count,
	children,
}: {
	label: string;
	count: number;
	children: React.ReactNode;
}) {
	return (
		<div className="py-1">
			<div className="flex items-center justify-between px-3 py-1 text-4xs font-semibold uppercase tracking-wider text-pi-text-faint">
				<span>{label}</span>
				<span>{count}</span>
			</div>
			{children}
		</div>
	);
}

function FileRow({
	change,
	selected,
	onClick,
}: {
	change: GitFileChange;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className={`flex w-full items-center gap-1.5 px-3 py-1 text-left font-mono text-3xs transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
				selected
					? "bg-pi-accent-soft text-pi-accent"
					: "text-pi-text-secondary hover:bg-pi-surface-raised hover:text-pi-text"
			}`}
		>
			<span
				className={`flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-4xs font-bold ${STATUS_COLOR[change.status]}`}
			>
				{change.status === "added" ? (
					<Plus className="h-2.5 w-2.5" />
				) : change.status === "deleted" ? (
					<Minus className="h-2.5 w-2.5" />
				) : change.status === "untracked" ? (
					<FileText className="h-2.5 w-2.5" />
				) : (
					STATUS_LABEL[change.status]
				)}
			</span>
			<span className="truncate" title={change.path}>
				{change.path}
			</span>
		</button>
	);
}

function DiffView({ diff }: { diff: string }) {
	if (!diff) {
		return (
			<div className="text-pi-text-faint">
				No diff content (file may be added or binary).
			</div>
		);
	}
	return (
		<pre className="m-0 whitespace-pre">
			{diff.split("\n").map((line, i) => {
				const cls =
					line.startsWith("+") && !line.startsWith("+++")
						? "text-pi-success bg-pi-success/10"
						: line.startsWith("-") && !line.startsWith("---")
							? "text-pi-error bg-pi-error/10"
							: line.startsWith("@@")
								? "text-pi-accent"
								: "text-pi-text-secondary";
				return (
					<div key={i} className={`px-1 ${cls}`}>
						{line || " "}
					</div>
				);
			})}
		</pre>
	);
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex items-center justify-center p-6 text-center text-2xs text-pi-text-faint">
			{children}
		</div>
	);
}

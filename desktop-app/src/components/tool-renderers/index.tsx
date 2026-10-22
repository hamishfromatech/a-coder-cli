import { memo, useMemo, useState } from "react";
import { useSessionViewStore } from "../../stores/session-view-store";
import { formatToolProgress, useToolProgressStore } from "../../stores/tool-progress-store";
import {
	AlertTriangle,
	Check,
	ChevronRight,
	Copy,
	Hammer,
	Loader2,
} from "lucide-react";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { useSessionStore, type UiRequest } from "../../stores/session-store";
import { ToolApprovalBar } from "../ToolApprovalBar";
import { diffStats, EditDiff } from "./EditDiff";

export interface RichToolCallProps {
	toolCall: {
		type: "toolCall";
		id?: string;
		name: string;
		arguments: Record<string, unknown>;
	};
	/** Pending permission request for this tool call, when it is the row awaiting
	 * approval. Undefined means no approval is pending for this row. */
	approvalRequest?: UiRequest;
	/** This call's tool result, resolved once per `messages` change by the list
	 * that owns the transcript (see MessageList's result index). Passing it in
	 * keeps every row from subscribing to the whole message array and scanning
	 * backwards for its own result on every render. */
	result?: ToolResultMessage;
}

type ToolStatus = "pending" | "running" | "success" | "error";

/** One-line human summary of a tool's arguments, keyed by tool name. */
function summarizeArgs(name: string, args: Record<string, unknown>): string {
	const pick = (key: string): string | undefined => {
		const v = args[key];
		return typeof v === "string" && v.length > 0 ? v : undefined;
	};
	const num = (key: string): number | undefined =>
		typeof args[key] === "number" ? (args[key] as number) : undefined;

	switch (name) {
		case "bash":
			return pick("command") ?? pick("c") ?? "";
		case "read":
		case "write":
			return pick("file_path") ?? pick("path") ?? "";
		case "edit":
		case "str_replace_based_edit_tool":
		case "multi_edit": {
			const path = pick("file_path") ?? pick("path") ?? "";
			const edits = num("edits") ?? (Array.isArray(args.edits) ? (args.edits as unknown[]).length : undefined);
			return path ? (edits ? `${path} · ${edits} edit${edits === 1 ? "" : "s"}` : path) : "";
		}
		case "grep":
			return [pick("pattern"), pick("path")].filter(Boolean).join(" · ");
		case "find":
			return [pick("pattern"), pick("path")].filter(Boolean).join(" · ");
		case "ls":
			return pick("path") ?? ".";
		case "todo":
			return Array.isArray(args.todos) ? `${(args.todos as unknown[]).length} tasks` : "";
		default: {
			const firstKey = Object.keys(args)[0];
			if (!firstKey) return "";
			const v = args[firstKey];
			return typeof v === "string" ? v : `${firstKey}: ${JSON.stringify(v)}`;
		}
	}
}

function resultText(result: ToolResultMessage | undefined): string {
	if (!result) return "";
	return result.content
		.map((c) => (c.type === "text" ? c.text : ""))
		.join("")
		.trim();
}

/** Details shape emitted by the edit tool (`details.diff` holds the display diff). */
interface EditToolResultDetails {
	diff?: unknown;
	patch?: unknown;
	firstChangedLine?: unknown;
}

function editResultDiff(result: ToolResultMessage | undefined): string | undefined {
	if (!result || result.isError) return undefined;
	const details = result.details as EditToolResultDetails | undefined;
	if (typeof details?.diff !== "string" || details.diff.trim().length === 0) return undefined;
	return details.diff;
}

// Memoized: the transcript re-renders on every streaming flush, but a row whose
// tool call and result are unchanged (everything above the streaming message)
// should not re-render with it. Props are stable because MessageList resolves
// results from an index built once per `messages` change.
export const RichToolCall = memo(function RichToolCall({
	toolCall,
	approvalRequest,
	result,
}: RichToolCallProps) {
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const open = useSessionViewStore((s) =>
		sessionFile ? (s.expanded[sessionFile] ?? []).includes(toolCall.id ?? "") : false,
	);
	const setOpen = (next: boolean) => {
		if (sessionFile && toolCall.id) {
			useSessionViewStore.getState().setToolExpanded(sessionFile, toolCall.id, next);
		}
	};
	const [copied, setCopied] = useState(false);
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const progress = useToolProgressStore((s) => (toolCall.id ? s.streams[toolCall.id] : undefined));

	const status: ToolStatus = result
		? result.isError
			? "error"
			: "success"
		: isStreaming
			? "running"
			: "pending";

	const argsJson = useMemo(() => JSON.stringify(toolCall.arguments, null, 2), [toolCall.arguments]);
	const summary = useMemo(
		() => summarizeArgs(toolCall.name, toolCall.arguments),
		[toolCall.name, toolCall.arguments],
	);
	const output = useMemo(() => resultText(result), [result]);
	const diff = useMemo(() => editResultDiff(result), [result]);
	const stats = useMemo(() => (diff ? diffStats(diff) : undefined), [diff]);

	const onCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(argsJson);
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		} catch {
			// ignore
		}
	};

	const statusGlyph =
		status === "running" ? (
			<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-pi-accent" />
		) : status === "success" ? (
			<Check className="h-3.5 w-3.5 shrink-0 text-pi-success" strokeWidth={2.5} />
		) : status === "error" ? (
			<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-pi-error" />
		) : (
			<Hammer className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
		);

	return (
		<div className="group/tool w-full overflow-hidden rounded-lg border border-pi-border bg-pi-surface/60 transition-smooth hover:bg-pi-surface">
			<button
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-hover"
			>
				{statusGlyph}
				<span className="font-mono text-2xs font-medium text-pi-text-secondary">
					{toolCall.name}
				</span>
				{summary && (
					<span className="min-w-0 flex-1 truncate font-mono text-2xs text-pi-text-faint">
						{summary}
					</span>
				)}
				{stats && (stats.added > 0 || stats.removed > 0) && (
					<span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-2xs">
						{stats.added > 0 && <span className="text-pi-success">+{stats.added}</span>}
						{stats.removed > 0 && <span className="text-pi-error">−{stats.removed}</span>}
					</span>
				)}
				{status === "running" && progress?.progress && (
					<span
						className="max-w-48 shrink-0 truncate font-mono text-3xs text-pi-text-faint"
						title={formatToolProgress(progress.progress)}
					>
						{formatToolProgress(progress.progress)}
					</span>
				)}
				<span
					onClick={onCopy}
					role="button"
					tabIndex={0}
					className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-3xs text-pi-text-faint opacity-0 transition-hover hover:bg-pi-surface-overlay hover:text-pi-text group-hover/tool:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"

					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							void onCopy(e as unknown as React.MouseEvent);
						}
					}}
				>
					{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
				</span>
				<ChevronRight
					className={`h-3 w-3 shrink-0 text-pi-text-faint transition-transform ${
						open ? "rotate-90" : ""
					}`}
				/>
			</button>
			{open && (
				<div className="border-t border-pi-border bg-pi-bg/40">
					{diff ? (
						<>
							<div className="flex items-center justify-between px-2.5 pt-1.5">
								<span className="text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
									Changes
								</span>
								{stats && (stats.added > 0 || stats.removed > 0) && (
									<span className="font-mono text-2xs">
										{stats.added > 0 && <span className="text-pi-success">+{stats.added}</span>}
										{stats.added > 0 && stats.removed > 0 && (
											<span className="text-pi-text-faint"> </span>
										)}
										{stats.removed > 0 && <span className="text-pi-error">−{stats.removed}</span>}
									</span>
								)}
							</div>
							<EditDiff diff={diff} />
						</>
					) : (
						<>
							{argsJson && (
								<div>
									<div className="px-2.5 pt-1.5 text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
										Args
									</div>
									<pre className="max-h-48 overflow-auto px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-pi-text-secondary">
										{argsJson}
									</pre>
								</div>
							)}
							{!output && progress && (progress.stdout || progress.stderr) && (
								<div>
									<div className="px-2.5 pt-1.5 text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
										{progress.ended ? "Output" : "Live output"}
									</div>
									{progress.stdout && (
										<pre className="max-h-64 overflow-auto px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-pi-text-secondary">
											{progress.stdout}
										</pre>
									)}
									{progress.stderr && (
										<pre className="max-h-40 overflow-auto px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-pi-error">
											{progress.stderr}
										</pre>
									)}
								</div>
							)}
							{output && (
								<div>
									<div className="px-2.5 pt-1.5 text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
										{result?.isError ? "Error" : "Result"}
									</div>
									<pre
										className={`max-h-64 overflow-auto px-2.5 py-1.5 font-mono text-2xs leading-relaxed ${
											result?.isError ? "text-pi-error" : "text-pi-text-secondary"
										}`}
									>
										{output}
									</pre>
								</div>
							)}
						</>
					)}
				</div>
			)}
			{approvalRequest && <ToolApprovalBar request={approvalRequest} surface="inline" />}
		</div>
	);
});
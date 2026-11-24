import { MacosPermissionHint } from "../MacosPermissionHint";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useSessionViewStore } from "../../stores/session-view-store";
import { formatToolProgress, useToolProgressStore } from "../../stores/tool-progress-store";
import {
	AlertTriangle,
	Check,
	ChevronRight,
	Copy,
	FastForward,
	Hammer,
	ImageIcon,
	Loader2,
} from "lucide-react";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { backgroundRunningBash } from "../../lib/bash-background";
import { useSessionStore, type UiRequest } from "../../stores/session-store";
import { Badge } from "../ui/Badge";
import { ToolApprovalBar } from "../ToolApprovalBar";
import { diffStats, EditDiff } from "./EditDiff";
import { ToolResultImage } from "./ToolResultImage";
import {
	parseJsonPayload,
	readToolVerdict,
	resultImages,
	resultText,
	summarizeComputerResult,
	summarizeToolArgs,
} from "./toolResult";

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
		() => summarizeToolArgs(toolCall.name, toolCall.arguments),
		[toolCall.name, toolCall.arguments],
	);
	const output = useMemo(() => resultText(result), [result]);
	const diff = useMemo(() => editResultDiff(result), [result]);
	const stats = useMemo(() => (diff ? diffStats(diff) : undefined), [diff]);
	const images = useMemo(() => resultImages(result), [result]);
	const parsed = useMemo(() => parseJsonPayload(output), [output]);
	const verdict = useMemo(
		() => (toolCall.name === "computer" ? readToolVerdict(result, parsed?.value) : null),
		[toolCall.name, result, parsed],
	);
	const computerResult = useMemo(
		() => (toolCall.name === "computer" ? summarizeComputerResult(result, parsed?.value) : null),
		[toolCall.name, result, parsed],
	);
	const verdictBadge = verdict
		? verdict.decision === "done"
			? { variant: "success" as const, label: "done" }
			: verdict.decision === "escalate"
				? { variant: "error" as const, label: "escalate" }
				: { variant: "warning" as const, label: "verify" }
		: undefined;

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
		) : toolCall.name === "computer" && computerResult?.tone === "warning" ? (
			<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-pi-warning" />
		) : status === "error" || (toolCall.name === "computer" && computerResult?.tone === "error") ? (
			<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-pi-error" />
		) : status === "success" ? (
			<Check className="h-3.5 w-3.5 shrink-0 text-pi-success" strokeWidth={2.5} />
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
				<span className="ml-auto flex shrink-0 items-center gap-1.5">
					{stats && (stats.added > 0 || stats.removed > 0) && (
						<span className="flex items-center gap-1.5 font-mono text-2xs">
							{stats.added > 0 && <span className="text-pi-success">+{stats.added}</span>}
							{stats.removed > 0 && <span className="text-pi-error">−{stats.removed}</span>}
						</span>
					)}
					{status === "running" && progress?.progress && (
						<span
							className="max-w-48 truncate font-mono text-3xs text-pi-text-faint"
							title={formatToolProgress(progress.progress)}
						>
							{formatToolProgress(progress.progress)}
						</span>
					)}
					{verdictBadge && !computerResult && (
						<Badge
							variant={verdictBadge.variant}
							size="sm"
							title={verdict?.hint ?? verdict?.code ?? verdictBadge.label}
						>
							{verdictBadge.label}
						</Badge>
					)}
					{images.length > 0 && (
						<Badge
							variant="muted"
							size="sm"
							icon={ImageIcon}
							title={`${images.length} image${images.length === 1 ? "" : "s"} in the result`}
						>
							{images.length}
						</Badge>
					)}
					{toolCall.name === "bash" && status === "running" && (
						<span
							onClick={(e) => {
								e.stopPropagation();
								void backgroundRunningBash();
							}}
							role="button"
							tabIndex={0}
							title="Background this command — it keeps running and the agent continues"
							className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-3xs text-pi-text-faint opacity-0 transition-hover hover:bg-pi-surface-overlay hover:text-pi-text group-hover/tool:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									e.stopPropagation();
									void backgroundRunningBash();
								}
							}}
						>
							<FastForward className="h-3 w-3" />
							Background
						</span>
					)}
					<span
						onClick={onCopy}
						role="button"
						tabIndex={0}
						className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-3xs text-pi-text-faint opacity-0 transition-hover hover:bg-pi-surface-overlay hover:text-pi-text group-hover/tool:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								void onCopy(e as unknown as React.MouseEvent);
							}
						}}
					>
						{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
					</span>
				</span>
				<ChevronRight
					className={`h-3 w-3 shrink-0 text-pi-text-faint transition-transform ${
						open ? "rotate-90" : ""
					}`}
				/>
			</button>
			{computerResult && (
				<div className="flex items-start gap-2 border-t border-pi-border/60 px-2.5 py-1 text-3xs">
					<span
						className={`shrink-0 font-medium ${
							computerResult.tone === "success"
								? "text-pi-success"
								: computerResult.tone === "warning"
									? "text-pi-warning"
									: computerResult.tone === "error"
										? "text-pi-error"
										: "text-pi-text-faint"
						}`}
					>
						{computerResult.label}
					</span>
					{computerResult.detail && (
						<span className="min-w-0 flex-1 truncate text-pi-text-faint" title={computerResult.detail}>
							{computerResult.detail}
						</span>
					)}
				</div>
			)}
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
							{argsJson && argsJson !== "{}" && (
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
							{(output || images.length > 0) && (
								<div>
									<div className="flex items-center justify-between gap-2 px-2.5 pt-1.5">
										<span className="text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
											{result?.isError ? "Error" : "Result"}
										</span>
										<div className="flex items-center gap-1">
											{parsed && (
												<Badge variant="outline" size="sm">
													json
												</Badge>
											)}
											{output && <CopyTextButton text={output} label="Copy result" />}
										</div>
									</div>
									{images.length > 0 && (
										<div className="flex flex-wrap gap-2 px-2.5 py-1.5">
											{images.map((image, index) => (
												<ToolResultImage
													key={image.attachment?.id ?? `image-${index}`}
													image={image}
													index={index}
												/>
											))}
										</div>
									)}
									{output && (
										<ResultText text={parsed?.pretty ?? output} isError={result?.isError === true} />
									)}
									{result?.isError && <MacosPermissionHint text={output} />}
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
/** Copy-to-clipboard action for a result payload (install commands, JSON, logs). */
function CopyTextButton({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={async (event) => {
				event.stopPropagation();
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1400);
				} catch {
					// Clipboard unavailable: leave the label unchanged.
				}
			}}
			className="flex items-center gap-1 rounded px-1 py-0.5 text-3xs text-pi-text-faint transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
		>
			{copied ? <Check className="h-3 w-3 text-pi-success" /> : <Copy className="h-3 w-3" />}
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

/**
 * Result body: capped height with an explicit expand control instead of a bare
 * scroll area, so a long screenshot element list does not swallow the fold.
 */
function ResultText({ text, isError }: { text: string; isError: boolean }) {
	const ref = useRef<HTMLPreElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [overflowing, setOverflowing] = useState(false);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		setOverflowing(element.scrollHeight > element.clientHeight + 4);
	}, [text, expanded]);

	return (
		<>
			<pre
				ref={ref}
				className={`whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-2xs leading-relaxed ${
					expanded ? "" : "max-h-64 overflow-hidden"
				} ${isError ? "text-pi-error" : "text-pi-text-secondary"}`}
			>
				{text}
			</pre>
			{(overflowing || expanded) && (
				<div className="flex justify-center pb-1.5">
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="rounded px-2 py-0.5 text-3xs text-pi-text-faint transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					>
						{expanded ? "Show less" : "Show all"}
					</button>
				</div>
			)}
		</>
	);
}

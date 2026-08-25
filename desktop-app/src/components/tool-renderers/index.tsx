import { useMemo, useState } from "react";
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

export function RichToolCall({ toolCall, approvalRequest }: RichToolCallProps) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const messages = useSessionStore((s) => s.messages);
	const isStreaming = useSessionStore((s) => s.isStreaming);

	const result = useMemo<ToolResultMessage | undefined>(() => {
		if (!toolCall.id) return undefined;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "toolResult") continue;
			const r = m as ToolResultMessage;
			if (r.toolCallId === toolCall.id) return r;
		}
		return undefined;
	}, [messages, toolCall.id]);

	const status: ToolStatus = result
		? result.isError
			? "error"
			: "success"
		: isStreaming
			? "running"
			: "pending";

	const argsJson = useMemo(() => JSON.stringify(toolCall.arguments, null, 2), [toolCall.arguments]);
	const summary = summarizeArgs(toolCall.name, toolCall.arguments);
	const output = resultText(result);

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
				onClick={() => setOpen((o) => !o)}
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
				</div>
			)}
			{approvalRequest && <ToolApprovalBar request={approvalRequest} surface="inline" />}
		</div>
	);
}
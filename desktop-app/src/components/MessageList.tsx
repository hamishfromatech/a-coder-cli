import { useEffect, useMemo, useRef, useState } from "react";
import type {
	AssistantMessage,
	ImageContent,
	ToolResultMessage,
	UserMessage,
} from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { useSessionStore, type UiRequest } from "../stores/session-store";
import { useSettingsStore } from "../stores/settings-store";
import { ModalBackdrop } from "./ui/Modal";
import {
	Bot,
	Check,
	ChevronRight,
	AlertCircle,
	Copy,
	Image as ImageIcon,
	Pencil,
	RotateCcw,
	Sparkles,
} from "lucide-react";
import * as rpc from "../lib/rpc";
import { MarkdownTextContent } from "./markdown/MarkdownText";
import { RichToolCall } from "./tool-renderers";

/** Find the id of the tool call currently awaiting approval: the last tool call
 * in the transcript that has no result yet and whose name matches the pending
 * permission request. Returns undefined when no approval is pending or no
 * matching pending row exists (the floating fallback covers that case). */
function usePendingApprovalToolCallId(): string | undefined {
	const uiRequests = useSessionStore((s) => s.uiRequests);
	const messages = useSessionStore((s) => s.messages);
	return useMemo(() => {
		const req = uiRequests.find((r) => r.kind === "permission");
		if (!req || !req.toolName) return undefined;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant") continue;
			const parts = Array.isArray(m.content) ? m.content : [];
			const calls = parts.filter((p: { type: string }) => p.type === "toolCall") as Array<{
				type: "toolCall";
				id?: string;
				name: string;
				arguments: Record<string, unknown>;
			}>;
			for (let j = calls.length - 1; j >= 0; j--) {
				const c = calls[j];
				if (!c.id || c.name !== req.toolName) continue;
				const hasResult = messages.some(
					(mm) =>
						mm.role === "toolResult" &&
						(mm as ToolResultMessage).toolCallId === c.id,
				);
				if (!hasResult) return c.id;
			}
		}
		return undefined;
	}, [uiRequests, messages]);
}

export function MessageList() {
	const messages = useSessionStore((s) => s.messages);
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const hideThinkingBlock = useSettingsStore((s) => s.cliGlobalSettings?.hideThinkingBlock ?? false);
	const approvalToolCallId = usePendingApprovalToolCallId();
	const approvalRequest = useSessionStore((s) =>
		s.uiRequests.find((r) => r.kind === "permission"),
	);
	const listRef = useRef<HTMLDivElement>(null);
	const [autoScroll, setAutoScroll] = useState(true);

	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const onScroll = () => {
			const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
			setAutoScroll(distance < 80);
		};
		el.addEventListener("scroll", onScroll);
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		const el = listRef.current;
		if (!el || !autoScroll) return;
		el.scrollTop = el.scrollHeight;
	}, [messages.length, JSON.stringify(messages[messages.length - 1] ?? null), isStreaming, autoScroll]);

	if (messages.length === 0) {
		return <EmptyState />;
	}

	return (
		<div ref={listRef} className="chat-surface flex-1 overflow-y-auto">
			<div className="chat-column mx-auto flex flex-col gap-6 py-8">
				{messages.map((msg, index) => (
					<MessageItem
						key={index}
						message={msg}
						index={index}
						hideThinkingBlock={hideThinkingBlock}
						approvalToolCallId={approvalToolCallId}
						approvalRequest={approvalRequest}
					/>
				))}
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="chat-surface flex flex-1 flex-col items-center justify-center text-center">
			<div className="chat-column flex flex-col items-center">
				<h1 className="mb-1.5 select-none text-[2.75rem] font-bold uppercase leading-[0.9] tracking-[0.08em] text-pi-text/90">
					A-Coder
				</h1>
				<p className="m-0 max-w-md text-center text-[13px] leading-normal tracking-tight text-pi-text-muted">
					Send a task, file, or rough idea. I&rsquo;ll inspect the repo and turn it into the next concrete step.
				</p>
			</div>
		</div>
	);
}

function MessageItem({
	message,
	index,
	hideThinkingBlock,
	approvalToolCallId,
	approvalRequest,
}: {
	message: AgentMessage;
	index: number;
	hideThinkingBlock: boolean;
	approvalToolCallId: string | undefined;
	approvalRequest: UiRequest | undefined;
}) {
	if (message.role === "user") {
		return <UserMessageItem message={message as UserMessage} index={index} />;
	}
	if (message.role === "assistant") {
		return (
			<AssistantMessageItem
				message={message as AssistantMessage}
				index={index}
				hideThinkingBlock={hideThinkingBlock}
				approvalToolCallId={approvalToolCallId}
				approvalRequest={approvalRequest}
			/>
		);
	}
	// Tool results render inside their matching tool-call row (RichToolCall),
	// which looks the result up by toolCallId, so they have no standalone row.
	if (message.role === "toolResult") return null;
	return null;
}

function extractUserMessageText(message: UserMessage): string {
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		return message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	}
	return "";
}

function extractUserImages(message: UserMessage): ImageContent[] {
	if (Array.isArray(message.content)) {
		return message.content.filter((c): c is ImageContent => c.type === "image");
	}
	return [];
}

function UserMessageItem({ message, index }: { message: UserMessage; index: number }) {
	const text = extractUserMessageText(message);
	const images = extractUserImages(message);
	const isStreaming = useSessionStore((s) => s.isStreaming);

	return (
		<div className="group/msg flex items-start justify-end gap-2">
			{text.length > 0 && (
				<UserMessageActions
					text={text}
					messageIndex={index}
					disabled={isStreaming}
				/>
			)}
			<div className="pi-glass max-w-[min(88%,42rem)] min-w-0 space-y-2 break-words rounded-xl border border-pi-border px-3.5 py-2.5 text-[13px] leading-relaxed text-pi-text">
				{text.length > 0 && (
					<MarkdownTextContent text={text} isRunning={false} />
				)}
				{images.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{images.map((img, idx) => (
							<ImageBlock key={idx} image={img} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

/** Resolve the session entry id for a user message so we can fork from it.
 *  Matches the message text against the backend's forkable user-message list;
 *  disambiguates duplicate text by ordinal position. */
async function resolveUserEntryId(
	messageIndex: number,
	text: string,
): Promise<string | undefined> {
	try {
		const { messages: forkMessages } = await rpc.getForkMessages();
		const matches = forkMessages.filter((m) => m.text === text);
		if (matches.length === 1) return matches[0].entryId;
		// Fall back to ordinal among user messages that carry text.
		const msgs = useSessionStore.getState().messages;
		let ordinal = 0;
		for (let i = 0; i < messageIndex; i++) {
			const m = msgs[i];
			if (m.role === "user" && extractUserMessageText(m as UserMessage).length > 0) ordinal++;
		}
		return forkMessages[ordinal]?.entryId;
	} catch {
		return undefined;
	}
}

function UserMessageActions({
	text,
	messageIndex,
	disabled,
}: {
	text: string;
	messageIndex: number;
	disabled: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);

	const onCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		} catch {
			// ignore
		}
	};

	const onEdit = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (disabled || busy) return;
		setBusy(true);
		try {
			const entryId = await resolveUserEntryId(messageIndex, text);
			let loadText = text;
			if (entryId) {
				const res = await rpc.fork(entryId);
				if (res.cancelled) return;
				loadText = res.text || text;
			}
			window.dispatchEvent(
				new CustomEvent("a-coder:set-editor-text", { detail: { text: loadText } }),
			);
		} catch (e) {
			console.error("Failed to edit message", e);
		} finally {
			setBusy(false);
		}
	};

	const onRetry = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (disabled || busy) return;
		setBusy(true);
		try {
			const entryId = await resolveUserEntryId(messageIndex, text);
			if (!entryId) return;
			const res = await rpc.fork(entryId);
			if (res.cancelled) return;
			await rpc.prompt(res.text || text);
		} catch (e) {
			console.error("Failed to retry message", e);
		} finally {
			setBusy(false);
		}
	};

	const btn =
		"flex h-6 w-6 items-center justify-center rounded-md text-pi-text-faint transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent";

	return (
		<div className="mt-0.5 flex items-center gap-0.5 self-start rounded-md border border-transparent opacity-0 transition-hover group-hover/msg:opacity-100 group-focus-within/msg:opacity-100">
			<button
				onClick={onRetry}
				title="Retry from here"
				aria-label="Retry from here"
				disabled={disabled || busy}
				className={btn}
			>
				<RotateCcw className="h-3.5 w-3.5" />
			</button>
			<button
				onClick={onEdit}
				title="Edit message"
				aria-label="Edit message"
				disabled={disabled || busy}
				className={btn}
			>
				<Pencil className="h-3.5 w-3.5" />
			</button>
			<button
				onClick={onCopy}
				title="Copy message"
				aria-label="Copy message"
				className={btn}
			>
				{copied ? <Check className="h-3.5 w-3.5 text-pi-success" /> : <Copy className="h-3.5 w-3.5" />}
			</button>
		</div>
	);
}

function ImageBlock({ image }: { image: ImageContent }) {
	const [open, setOpen] = useState(false);
	const src = `data:${image.mimeType};base64,${image.data}`;
	return (
		<>
			<button
				onClick={() => setOpen(true)}
				className="group relative overflow-hidden rounded-lg"
			>
				<img
					src={src}
					alt="Attached"
					className="max-h-40 max-w-full rounded-lg border border-white/10 object-cover transition-smooth group-hover:brightness-110"
				/>
				<div className="absolute bottom-1 right-1 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
					<ImageIcon className="h-3 w-3" />
				</div>
			</button>
			{open && (
				<ModalBackdrop
					aria-label="Image preview"
					className="bg-black/80"
					onClick={() => setOpen(false)}
				>
					<img
						src={src}
						alt="Attached full size"
						className="max-h-full max-w-full rounded-lg shadow-overlay"
						onClick={(e) => e.stopPropagation()}
					/>
				</ModalBackdrop>
			)}
		</>
	);
}

function AssistantMessageItem({
	message,
	index,
	hideThinkingBlock,
	approvalToolCallId,
	approvalRequest,
}: {
	message: AssistantMessage;
	index: number;
	hideThinkingBlock: boolean;
	approvalToolCallId: string | undefined;
	approvalRequest: UiRequest | undefined;
}) {
	const parts = Array.isArray(message.content) ? message.content : [];
	const thinking = parts.filter(
		(p): p is { type: "thinking"; thinking: string; signature?: string } =>
			p.type === "thinking" && p.thinking.trim().length > 0,
	);
	const text = parts
		.filter((p) => p.type === "text")
		.map((p) => (p as { type: "text"; text: string }).text)
		.join("");
	const toolCalls = parts.filter((p) => p.type === "toolCall") as Array<{
		type: "toolCall";
		id?: string;
		name: string;
		arguments: Record<string, unknown>;
	}>;
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const totalMessages = useSessionStore((s) => s.messages.length);

	return (
		<div className="group/msg flex justify-start gap-3">
			<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pi-accent-soft text-pi-accent">
				<Bot className="h-3.5 w-3.5" />
			</div>
			<div className="relative flex min-w-0 flex-1 flex-col gap-2.5">
				{text.length > 0 && !isStreaming && (
					<CopyReplyButton text={text} />
				)}
				{thinking.length > 0 && !hideThinkingBlock && (
					<ThinkingBlocks thinking={thinking} />
				)}

				{text.length > 0 && (
					<div className="min-w-0 break-words px-1 py-1 text-[13px] leading-relaxed text-pi-text">
						<MarkdownTextContent text={text} isRunning={isStreaming && index === totalMessages - 1} />
					</div>
				)}

				{toolCalls.map((toolCall, i) => (
					<RichToolCall
						key={i}
						toolCall={toolCall}
						approvalRequest={
							approvalToolCallId && toolCall.id === approvalToolCallId
								? approvalRequest
								: undefined
						}
					/>
				))}
				{(message.stopReason === "error" || message.stopReason === "aborted") && message.errorMessage && (
					<AssistantErrorBlock message={message.errorMessage} aborted={message.stopReason === "aborted"} />
				)}
			</div>
		</div>
	);
}

function AssistantErrorBlock({ message, aborted }: { message: string; aborted: boolean }) {
	return (
		<div className="flex items-start gap-2 rounded-lg border border-pi-error/30 bg-pi-error-soft px-3 py-2 text-xs text-pi-error">
			<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
			<div className="min-w-0 flex-1">
				<div className="font-medium">{aborted ? "Generation aborted" : "Model request failed"}</div>
				<p className="mt-0.5 break-words font-mono text-2xs leading-relaxed text-pi-error/80">{message}</p>
			</div>
		</div>
	);
}

function ThinkingBlocks({
	thinking,
}: {
	thinking: Array<{ type: "thinking"; thinking: string; signature?: string }>;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="group/think overflow-hidden rounded-lg border border-pi-border bg-pi-surface/50">
			<button
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-2xs text-pi-text-faint transition-hover hover:text-pi-text-muted focus-visible:shadow-focus focus-visible:outline-none"
			>
				<Sparkles className="h-3 w-3 shrink-0 text-pi-accent" />
				<span className="font-medium uppercase tracking-wide">Thinking</span>
				<span className="font-mono text-3xs text-pi-text-faint">
					{thinking.length} {thinking.length === 1 ? "block" : "blocks"}
				</span>
				<ChevronRight
					className={`ml-auto h-3 w-3 shrink-0 text-pi-text-faint transition-transform duration-150 ${open ? "rotate-90 opacity-80" : "opacity-0 group-hover/think:opacity-80"}`}
				/>
			</button>
			{open && (
				<div className="border-t border-pi-border px-2.5 py-2 font-mono text-2xs leading-relaxed text-pi-text-muted">
					{thinking.map((t, i) => (
						<pre key={i} className="m-0 whitespace-pre-wrap">
							{t.thinking}
						</pre>
					))}
				</div>
			)}
		</div>
	);
}

function CopyReplyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const onCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		} catch {
			// ignore
		}
	};
	return (
		<button
			onClick={onCopy}
			title="Copy reply"
			aria-label="Copy reply"
			className="absolute -top-1 right-0 z-10 flex items-center gap-1 rounded-md border border-pi-border bg-pi-surface px-1.5 py-0.5 text-3xs text-pi-text-muted opacity-0 transition-hover hover:bg-pi-surface-overlay hover:text-pi-text group-hover/msg:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
		>
			{copied ? <Check className="h-3 w-3 text-pi-success" /> : <Copy className="h-3 w-3" />}
			{copied && <span>Copied</span>}
		</button>
	);
}
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
	AssistantMessage,
	ToolResultMessage,
	UserMessage,
} from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { useSessionStore, type UiRequest } from "../stores/session-store";
import { pickLoadingVerb } from "../lib/loading-verbs";
import { loadOlderHistory } from "../lib/history";
import { useSessionViewStore } from "../stores/session-view-store";
import { messageKey } from "../lib/message-key";
import { inlineDataUrl, loadAttachmentDataUrl } from "../lib/attachment-cache";
import { toast } from "../stores/toast-store";
import { Loader } from "./ui/Loader";
import { useSettingsStore } from "../stores/settings-store";
import { ModalBackdrop } from "./ui/Modal";
import {
	Bot,
	Check,
	Loader2,
	ChevronRight,
	ChevronUp,
	AlertCircle,
	Copy,
	Image as ImageIcon,
	Pencil,
	RotateCcw,
	Sparkles,
	GitBranch,
	Scissors,
} from "lucide-react";
import * as rpc from "../lib/rpc";
import { MarkdownTextContent } from "./markdown/MarkdownText";
import { AskUserQuestionCard } from "./tool-renderers/AskUserQuestionCard";
import { RichToolCall } from "./tool-renderers";
import { ErrorBoundary } from "./ErrorBoundary";

/** Index tool results by toolCallId, built ONCE per `messages` change.
 *
 * Previously every tool row (and the approval lookup) subscribed to the whole
 * `messages` array and scanned it backwards on each render, so a streaming
 * flush cost O(rows x messages). One pass per messages change turns that into
 * a single O(messages) walk plus O(1) lookups. Last result for an id wins,
 * matching the old backwards scan (which returned the newest match). */
function useToolResultsById(messages: AgentMessage[]): Map<string, ToolResultMessage> {
	return useMemo(() => {
		const index = new Map<string, ToolResultMessage>();
		for (const message of messages) {
			if (message.role !== "toolResult") continue;
			const result = message as ToolResultMessage;
			if (result.toolCallId) index.set(result.toolCallId, result);
		}
		return index;
	}, [messages]);
}

/** Find the id of the tool call currently awaiting approval: the last tool call
 * in the transcript that has no result yet and whose name matches the pending
 * permission request. Returns undefined when no approval is pending or no
 * matching pending row exists (the floating fallback covers that case). */
function usePendingApprovalToolCallId(
	messages: AgentMessage[],
	toolResults: Map<string, ToolResultMessage>,
): string | undefined {
	const uiRequests = useSessionStore((s) => s.uiRequests);
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
				if (!toolResults.has(c.id)) return c.id;
			}
		}
		return undefined;
	}, [uiRequests, messages, toolResults]);
}

export function MessageList() {
	const messages = useSessionStore((s) => s.messages);
	const streamingMessage = useSessionStore((s) => s.streamingMessage);
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const sessionLoading = useSessionStore((s) => s.sessionLoading);
	const hideThinkingBlock = useSettingsStore((s) => s.cliGlobalSettings?.hideThinkingBlock ?? false);
	const toolResults = useToolResultsById(messages);
	const approvalToolCallId = usePendingApprovalToolCallId(messages, toolResults);
	const approvalRequest = useSessionStore((s) =>
		s.uiRequests.find((r) => r.kind === "permission"),
	);
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const hasMoreOlder = useSessionStore((s) => s.hasMoreOlder);
	const loadingOlder = useSessionStore((s) => s.loadingOlder);
	const listRef = useRef<HTMLDivElement>(null);
	const suppressAutoScrollRef = useRef(false);
	const [autoScroll, setAutoScroll] = useState(true);
	const [transcriptMode, setTranscriptMode] = useState(false);
	const [transcriptEntries, setTranscriptEntries] = useState<rpc.TranscriptEntry[]>([]);
	const [transcriptStart, setTranscriptStart] = useState(0);
	const [transcriptHasMore, setTranscriptHasMore] = useState(false);
	const [transcriptLoading, setTranscriptLoading] = useState(false);

	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const onScroll = () => {
			const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
			setAutoScroll(distance < 80);
			const file = useSessionStore.getState().sessionFile;
			if (file) useSessionViewStore.getState().setScroll(file, el.scrollTop);
		};
		el.addEventListener("scroll", onScroll);
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		if (!transcriptMode) return;
		let cancelled = false;
		setTranscriptLoading(true);
		void rpc
			.getTranscriptPage({ limit: 500 })
			.then((page) => {
				if (cancelled) return;
				setTranscriptEntries(page.entries);
				setTranscriptStart(page.start);
				setTranscriptHasMore(page.hasMore);
			})
			.catch((error) => {
				if (!cancelled) {
					toast.error(
						"Failed to load transcript",
						error instanceof Error ? error.message : String(error),
					);
				}
			})
			.finally(() => {
				if (!cancelled) setTranscriptLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [transcriptMode, sessionFile]);

	const loadOlderTranscript = async () => {
		setTranscriptLoading(true);
		try {
			const page = await rpc.getTranscriptPage({ limit: 200, before: transcriptStart });
			setTranscriptEntries((previous) => [...page.entries, ...previous]);
			setTranscriptStart(page.start);
			setTranscriptHasMore(page.hasMore);
		} catch (error) {
			toast.error("Failed to load older transcript", error instanceof Error ? error.message : String(error));
		} finally {
			setTranscriptLoading(false);
		}
	};

	const lastMessage = streamingMessage ?? messages[messages.length - 1];
	useEffect(() => {
		const el = listRef.current;
		if (!el || !autoScroll || suppressAutoScrollRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [messages.length, lastMessage, isStreaming, autoScroll]);

	// Restore the previous scroll anchor for this session (and recompute whether
	// the view is pinned to the bottom) when the transcript changes identity.
	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const saved = sessionFile ? useSessionViewStore.getState().scroll[sessionFile] : undefined;
		if (saved === undefined) return;
		suppressAutoScrollRef.current = true;
		const restore = () => {
			el.scrollTop = saved;
			setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
			suppressAutoScrollRef.current = false;
		};
		if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
		else setTimeout(restore, 0);
	}, [sessionFile]);

	const handleLoadOlder = async () => {
		const el = listRef.current;
		const previousTop = el?.scrollTop ?? 0;
		const previousHeight = el?.scrollHeight ?? 0;
		suppressAutoScrollRef.current = true;
		try {
			await loadOlderHistory();
		} catch (error) {
			toast.error("Failed to load older messages", error instanceof Error ? error.message : String(error));
		} finally {
			const restore = () => {
				if (el) el.scrollTop = previousTop + (el.scrollHeight - previousHeight);
				suppressAutoScrollRef.current = false;
			};
			if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
			else setTimeout(restore, 0);
		}
	};

	if (messages.length === 0 && !streamingMessage) {
		return sessionLoading ? <SessionLoadingState /> : <EmptyState />;
	}

	return (
		<div ref={listRef} className="chat-surface flex-1 overflow-y-auto">
			<div className="sticky top-0 z-20 flex justify-end px-4 pt-2">
				<button
					type="button"
					onClick={() => setTranscriptMode((value) => !value)}
					aria-pressed={transcriptMode}
					className="rounded-full border border-pi-border bg-pi-surface-overlay/90 px-3 py-1 text-[11px] tracking-tight text-pi-text-muted shadow-ring backdrop-blur-sm transition-colors hover:text-pi-text"
				>
					{transcriptMode ? "Context view" : "Full transcript"}
				</button>
			</div>
			{transcriptMode ? (
				<div className="chat-column mx-auto flex flex-col gap-6 py-6">
					{transcriptHasMore && (
						<div className="flex justify-center">
							<button
								type="button"
								onClick={() => void loadOlderTranscript()}
								disabled={transcriptLoading}
								className="rounded-full border border-pi-border px-3 py-1 text-[11px] tracking-tight text-pi-text-muted transition-colors hover:text-pi-text disabled:opacity-50"
							>
								{transcriptLoading ? "Loading transcript…" : "Load older transcript"}
							</button>
						</div>
					)}
					<TranscriptEntries
						entries={transcriptEntries}
						hideThinkingBlock={hideThinkingBlock}
						approvalRequest={approvalRequest}
					/>
				</div>
			) : (
			<div className="chat-column mx-auto flex flex-col gap-6 py-8">
				{sessionLoading && messages.length > 0 && (
					<div className="sticky top-0 z-10 mx-auto flex items-center gap-2 rounded-full border border-pi-border bg-pi-surface-overlay/90 px-3 py-1 text-2xs text-pi-text-muted shadow-ring backdrop-blur-sm">
						<Loader2 className="h-3 w-3 animate-spin" />
						Loading {useSessionStore.getState().sessionName ?? "session"}…
					</div>
				)}
				{hasMoreOlder && (
					<div className="flex justify-center">
						<button
							type="button"
							onClick={() => void handleLoadOlder()}
							disabled={loadingOlder}
							className="rounded-full border border-pi-border px-3 py-1 text-[11px] tracking-tight text-pi-text-muted transition-colors hover:text-pi-text disabled:opacity-50"
						>
							{loadingOlder ? "Loading older messages…" : "Load older messages"}
						</button>
					</div>
				)}
				{messages.map((msg, index) => (
					<div key={messageKey(msg)} className="chat-row">
						<ErrorBoundary label="message">
							<MessageItem
								message={msg}
								index={index}
								hideThinkingBlock={hideThinkingBlock}
								approvalToolCallId={approvalToolCallId}
								approvalRequest={approvalRequest}
								toolResults={toolResults}
								isStreaming={isStreaming}
								isLast={!streamingMessage && index === messages.length - 1}
							/>
						</ErrorBoundary>
					</div>
				))}
				{streamingMessage && (
					<div key={messageKey(streamingMessage)} className="chat-row">
						<ErrorBoundary label="message">
							<MessageItem
								message={streamingMessage}
								index={messages.length}
								hideThinkingBlock={hideThinkingBlock}
								approvalToolCallId={approvalToolCallId}
								approvalRequest={approvalRequest}
								toolResults={toolResults}
								isStreaming={isStreaming}
								isLast
							/>
						</ErrorBoundary>
					</div>
				)}
			</div>
			)}
		</div>
	);
}

function TranscriptEntries({
	entries,
	hideThinkingBlock,
	approvalRequest,
}: {
	entries: rpc.TranscriptEntry[];
	hideThinkingBlock: boolean;
	approvalRequest: UiRequest | undefined;
}) {
	const messages = useMemo(
		() => entries.filter((entry) => entry.type === "message" && entry.message).map((entry) => entry.message as AgentMessage),
		[entries],
	);
	const toolResults = useToolResultsById(messages);
	let messageIndex = 0;

	return (
		<>
			{entries.map((entry) => {
				if (entry.type === "message" && entry.message) {
					const index = messageIndex++;
					return (
						<div key={entry.id} className="chat-row">
							<ErrorBoundary label="transcript message">
								<MessageItem
									message={entry.message}
									index={index}
									hideThinkingBlock={hideThinkingBlock}
									approvalToolCallId={undefined}
									approvalRequest={approvalRequest}
									toolResults={toolResults}
									readOnly
								/>
							</ErrorBoundary>
						</div>
					);
				}
				if (entry.type === "compaction") {
					return (
						<TranscriptBoundary
							key={entry.id}
							kind="compaction"
							summary={entry.summary ?? ""}
							tokensBefore={entry.tokensBefore}
							firstKeptEntryId={entry.firstKeptEntryId}
						/>
					);
				}
				if (entry.type === "branch_summary") {
					return (
						<TranscriptBoundary
							key={entry.id}
							kind="branch"
							summary={entry.summary ?? ""}
							fromId={entry.fromId}
						/>
					);
				}
				return null;
			})}
		</>
	);
}

function TranscriptBoundary({
	kind,
	summary,
	tokensBefore,
	firstKeptEntryId,
	fromId,
}: {
	kind: "compaction" | "branch";
	summary: string;
	tokensBefore?: number;
	firstKeptEntryId?: string;
	fromId?: string;
}) {
	const Icon = kind === "compaction" ? Scissors : GitBranch;
	return (
		<div className="rounded-xl border border-dashed border-pi-border bg-pi-surface/40 p-3.5">
			<div className="flex items-center gap-2 text-3xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
				<Icon className="h-3 w-3" />
				{kind === "compaction" ? "Compaction boundary" : "Branch summary"}
				{tokensBefore !== undefined && (
					<span className="ml-auto normal-case tracking-normal">
						{tokensBefore.toLocaleString()} tokens before
					</span>
				)}
			</div>
			{summary && (
				<div className="mt-2 text-[12px] leading-relaxed text-pi-text-secondary">
					<MarkdownTextContent text={summary} isRunning={false} />
				</div>
			)}
			<div className="mt-2 text-4xs text-pi-text-faint">
				{kind === "compaction"
					? `Earlier turns remain available above this boundary${firstKeptEntryId ? `; context kept from ${firstKeptEntryId}` : ""}.`
					: `Summarized branch${fromId ? ` from ${fromId}` : ""}.`}
			</div>
		</div>
	);
}

function toolCallIds(message: AgentMessage): string[] {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
	return message.content
		.filter((part) => part.type === "toolCall")
		.map((part) => (part as { id?: string }).id)
		.filter((id): id is string => Boolean(id));
}

function sameMessageItem(
	previous: {
		message: AgentMessage;
		index: number;
		hideThinkingBlock: boolean;
		approvalToolCallId: string | undefined;
		approvalRequest: UiRequest | undefined;
		toolResults: Map<string, ToolResultMessage>;
		readOnly?: boolean;
		isStreaming?: boolean;
		isLast?: boolean;
	},
	next: typeof previous,
): boolean {
	if (
		previous.message !== next.message ||
		previous.index !== next.index ||
		previous.hideThinkingBlock !== next.hideThinkingBlock ||
		previous.approvalToolCallId !== next.approvalToolCallId ||
		previous.approvalRequest !== next.approvalRequest ||
		previous.readOnly !== next.readOnly ||
		previous.isStreaming !== next.isStreaming ||
		previous.isLast !== next.isLast
	) {
		return false;
	}
	if (previous.toolResults === next.toolResults) return true;
	return toolCallIds(previous.message).every(
		(id) => previous.toolResults.get(id) === next.toolResults.get(id),
	);
}

const MessageItem = memo(MessageItemImpl, sameMessageItem);

function SessionLoadingState() {
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const sessionName = useSessionStore((s) => s.sessionName);
	// One whimsical verb per loading screen mount.
	const verb = useMemo(() => pickLoadingVerb(), []);
	const label = sessionName ?? (sessionFile ? sessionFile.split(/[/\\]/).pop() : null);

	return (
		<div className="chat-surface flex flex-1 flex-col items-center justify-center gap-5">
			<div className="chat-column flex flex-col items-center gap-5">
				<Loader
					type="lemniscate-bloom"
					className="text-pi-accent"
					label="Loading session"
					style={{ width: 72, height: 72 }}
				/>
				<div className="flex flex-col items-center gap-1">
					<p className="m-0 text-[15px] font-medium tracking-tight text-pi-text/85">
						{verb}…
					</p>
					{label ? (
						<p className="m-0 max-w-md truncate text-center text-[12px] tracking-tight text-pi-text-muted">
							Loading {label}
						</p>
					) : (
						<p className="m-0 max-w-md text-center text-[12px] tracking-tight text-pi-text-muted">
							Restoring conversation history
						</p>
					)}
				</div>
				<div className="flex w-full max-w-md flex-col gap-3" aria-hidden>
					<div className="h-3 w-2/3 animate-pulse rounded-full bg-pi-text/8" />
					<div className="ml-auto h-3 w-1/2 animate-pulse rounded-full bg-pi-text/8" />
					<div className="h-3 w-3/5 animate-pulse rounded-full bg-pi-text/8" />
				</div>
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

function MessageItemImpl({
	message,
	index,
	hideThinkingBlock,
	approvalToolCallId,
	approvalRequest,
	toolResults,
	readOnly = false,
	isStreaming = false,
	isLast = false,
}: {
	message: AgentMessage;
	index: number;
	hideThinkingBlock: boolean;
	approvalToolCallId: string | undefined;
	approvalRequest: UiRequest | undefined;
	toolResults: Map<string, ToolResultMessage>;
	readOnly?: boolean;
	isStreaming?: boolean;
	isLast?: boolean;
}) {
	if (message.role === "user") {
		return (
			<UserMessageItem
				message={message as UserMessage}
				index={index}
				readOnly={readOnly}
				streaming={isStreaming}
			/>
		);
	}
	if (message.role === "assistant") {
		return (
			<AssistantMessageItem
				message={message as AssistantMessage}
				hideThinkingBlock={hideThinkingBlock}
				approvalToolCallId={approvalToolCallId}
				approvalRequest={approvalRequest}
				toolResults={toolResults}
				isStreaming={isStreaming}
				isLast={isLast}
			/>
		);
	}
	// Tool results render inside their matching tool-call row (RichToolCall),
	// which receives the prebuilt result index, so they have no standalone row.
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

interface DisplayImage {
	type: "image";
	data?: string;
	mimeType?: string;
	bytes?: number;
	attachment?: { id: string; mimeType: string; bytes: number };
}

function extractUserImages(message: UserMessage): DisplayImage[] {
	if (Array.isArray(message.content)) {
		return message.content.filter((c) => c.type === "image") as unknown as DisplayImage[];
	}
	return [];
}

function UserMessageItem({
	message,
	index,
	readOnly = false,
	streaming = false,
}: {
	message: UserMessage;
	index: number;
	readOnly?: boolean;
	streaming?: boolean;
}) {
	const text = extractUserMessageText(message);
	const images = extractUserImages(message);

	return (
		<div className="group/msg flex items-start justify-end gap-2">
			{text.length > 0 && !readOnly && (
				<UserMessageActions
					text={text}
					messageIndex={index}
					disabled={streaming}
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

				aria-label="Retry from here"
				disabled={disabled || busy}
				className={btn}
			>
				<RotateCcw className="h-3.5 w-3.5" />
			</button>
			<button
				onClick={onEdit}

				aria-label="Edit message"
				disabled={disabled || busy}
				className={btn}
			>
				<Pencil className="h-3.5 w-3.5" />
			</button>
			<button
				onClick={onCopy}

				aria-label="Copy message"
				className={btn}
			>
				{copied ? <Check className="h-3.5 w-3.5 text-pi-success" /> : <Copy className="h-3.5 w-3.5" />}
			</button>
		</div>
	);
}

function ImageBlock({ image }: { image: DisplayImage }) {
	const [open, setOpen] = useState(false);
	const [src, setSrc] = useState<string | undefined>(() =>
		image.data ? inlineDataUrl(image.mimeType ?? "image/png", image.data) : undefined,
	);

	useEffect(() => {
		if (src || !image.attachment) return;
		let cancelled = false;
		void loadAttachmentDataUrl(image.attachment)
			.then((url) => {
				if (!cancelled) setSrc(url);
			})
			.catch(() => {
				// Leave the placeholder; the transcript stays readable without the image.
			});
		return () => {
			cancelled = true;
		};
	}, [src, image.attachment]);

	return (
		<>
			<button
				onClick={() => src && setOpen(true)}
				className="group relative overflow-hidden rounded-lg"
			>
				{src ? (
					<img
						src={src}
						alt="Attached"
						className="max-h-40 max-w-full rounded-lg border border-white/10 object-cover transition-smooth group-hover:brightness-110"
					/>
				) : (
					<div className="h-24 w-32 animate-pulse rounded-lg border border-pi-border bg-pi-surface-overlay" />
				)}
				<div className="absolute bottom-1 right-1 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
					<ImageIcon className="h-3 w-3" />
				</div>
			</button>
			{open && src && (
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
	hideThinkingBlock,
	approvalToolCallId,
	approvalRequest,
	toolResults,
	isStreaming,
	isLast,
}: {
	message: AssistantMessage;
	hideThinkingBlock: boolean;
	approvalToolCallId: string | undefined;
	approvalRequest: UiRequest | undefined;
	toolResults: Map<string, ToolResultMessage>;
	isStreaming: boolean;
	isLast: boolean;
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

	return (
		<div className="group/msg flex justify-start gap-3">
			<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pi-accent-soft text-pi-accent">
				<Bot className="h-3.5 w-3.5" />
			</div>
			<div className="relative flex min-w-0 flex-1 flex-col gap-2.5">
				<div className="relative min-w-0">
					{text.length > 0 && !isStreaming && <CopyReplyButton text={text} />}
					{thinking.length > 0 && !hideThinkingBlock && (
						<ThinkingBlocks thinking={thinking} />
					)}

					{text.length > 0 && (
						<div className="min-w-0 break-words px-1 py-1 text-[13px] leading-relaxed text-pi-text">
							<MarkdownTextContent text={text} isRunning={isStreaming && isLast} />
						</div>
					)}
				</div>

				{toolCalls.map((toolCall, i) =>
					toolCall.name === "ask_user_question" ? (
						// Structured questions render as an interactive inline card
						// (hermes-style) instead of the generic collapsed tool row.
						<AskUserQuestionCard
							key={i}
							toolCall={toolCall}
							result={toolCall.id ? toolResults.get(toolCall.id) : undefined}
						/>
					) : (
						<RichToolCall
							key={i}
							toolCall={toolCall}
							result={toolCall.id ? toolResults.get(toolCall.id) : undefined}
							approvalRequest={
								approvalToolCallId && toolCall.id === approvalToolCallId
									? approvalRequest
									: undefined
							}
						/>
					),
				)}
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
	const [copied, setCopied] = useState(false);
	const thinkingText = useMemo(() => thinking.map((t) => t.thinking).join("\n\n"), [thinking]);
	const onCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(thinkingText);
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		} catch {
			// ignore
		}
	};
	return (
		<div className="group/think overflow-hidden rounded-lg border border-pi-border bg-pi-surface/50">
			{/* Sibling buttons, not nested: the label toggles the card, the copy
				button owns the card's content and appears on card hover. */}
			<div className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-2xs text-pi-text-faint">
				<button
					onClick={() => setOpen((o) => !o)}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-hover hover:text-pi-text-muted focus-visible:shadow-focus focus-visible:outline-none"
				>
					<Sparkles className="h-3 w-3 shrink-0 text-pi-accent" />
					<span className="font-medium uppercase tracking-wide">Thinking</span>
					<span className="font-mono text-3xs text-pi-text-faint">
						{thinking.length} {thinking.length === 1 ? "block" : "blocks"}
					</span>
				</button>
				<button
					onClick={onCopy}
					aria-label="Copy thinking"
					className="flex shrink-0 items-center rounded p-0.5 text-pi-text-faint opacity-0 transition-opacity hover:text-pi-text group-hover/think:opacity-100 focus-visible:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
				>
					{copied ? <Check className="h-3 w-3 text-pi-success" /> : <Copy className="h-3 w-3" />}
				</button>
				<ChevronRight
					aria-hidden
					onClick={() => setOpen((o) => !o)}
					className={`h-3 w-3 shrink-0 cursor-pointer text-pi-text-faint transition-transform duration-150 hover:text-pi-text ${open ? "rotate-90 opacity-80" : "opacity-60 group-hover/think:opacity-80"}`}
				/>
			</div>
			{open && (
				<>
					<div className="border-t border-pi-border px-2.5 py-2 font-mono text-2xs leading-relaxed text-pi-text-muted">
						{thinking.map((t, i) => (
							<pre key={i} className="m-0 whitespace-pre-wrap">
								{t.thinking}
							</pre>
						))}
					</div>
					{/* Collapse affordance at the card's foot — the header sits above
						long content, so the way back is where the reading ends. */}
					<button
						onClick={() => setOpen(false)}
						aria-label="Collapse thinking"
						className="flex w-full items-center justify-center border-t border-pi-border py-1 text-pi-text-faint transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					>
						<ChevronUp className="h-3 w-3" />
					</button>
				</>
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

			aria-label="Copy reply"
			className="absolute right-0 top-0 z-10 flex items-center gap-1 rounded-md border border-pi-border bg-pi-surface px-1.5 py-0.5 text-3xs text-pi-text-muted opacity-0 transition-hover hover:bg-pi-surface-overlay hover:text-pi-text group-hover/msg:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
		>
			{copied ? <Check className="h-3 w-3 text-pi-success" /> : <Copy className="h-3 w-3" />}
			{copied && <span>Copied</span>}
		</button>
	);
}
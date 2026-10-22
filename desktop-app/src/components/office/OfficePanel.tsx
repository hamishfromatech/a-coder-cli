/**
 * A-Coder Virtual Office — right-sidebar panel: the roster (coworkers, huddles, errands)
 * plus the open huddle's conversation. The panel is self-contained; engine
 * events keep it live.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	BarChart3,
	Bot,
	Building2,
	CalendarClock,
	ChevronLeft,
	Copy,
	ImagePlus,
	Loader2,
	Maximize2,
	Mic,
	MicOff,
	Minimize2,
	Pencil,
	PhoneCall,
	PhoneOff,
	Pin,
	PinOff,
	Plus,
	Quote,
	Send,
	SkipForward,
	Square,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { Button } from "../ui/Button";
import { officeDeleteErrand, officeRunErrand, officeSearch } from "../../lib/rpc";
import { toast } from "../../stores/toast-store";
import { useOfficeStore } from "../../stores/office-store";
import { useConfirmStore } from "../../stores/confirm-store";
import { isHuddleUnread, useOfficeReadStore } from "../../stores/office-read-store";
import { cn } from "../../lib/cn";
import type { OfficeAttachment, OfficeCoworker, OfficeHuddleSummary, OfficeMessage, OfficePrompt, OfficeSearchHit } from "../../lib/rpc";
import { MarkdownTextContent } from "../markdown/MarkdownText";
import { Face } from "./Face";
import { FloorView } from "./FloorView";
import { CoworkerEditor } from "./CoworkerEditor";
import { CoworkerDetails } from "./CoworkerDetails";
import { HuddleEditor } from "./HuddleEditor";
import { ErrandEditor } from "./ErrandEditor";
import { huddleCall, useHuddleCallStore } from "../../lib/huddle-call";
import { searchOffice, sortCoworkers, sortOfficeRooms } from "../../lib/office-search";
import {
	applyMention,
	copyOfficeText,
	dayLabel,
	filterMentionCandidates,
	findMentionMatch,
	loadOfficeDraft,
	saveOfficeDraft,
} from "../../lib/office-chat";
import { SearchField } from "../ui/SearchField";
import { voiceCall } from "../../lib/voice-call";

function relativeTime(ms: number | undefined): string {
	if (!ms) return "";
	const delta = Date.now() - ms;
	if (delta < 60_000) return "now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
	return `${Math.floor(delta / 86_400_000)}d`;
}

/** Read an image as the data URL the office RPC accepts. */
function readImageAttachment(file: File): Promise<OfficeAttachment | null> {
	if (!file.type.startsWith("image/")) return Promise.resolve(null);
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => {
			const data = typeof reader.result === "string" ? reader.result : "";
			resolve(data ? { name: file.name || "image", kind: "image", data } : null);
		};
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});
}

/** Compact time until a future epoch (errand next run). */
function untilTime(ms: number | undefined): string {
	if (!ms) return "";
	const delta = ms - Date.now();
	if (delta <= 0) return "due";
	if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
	return `${Math.floor(delta / 86_400_000)}d`;
}

interface RosterRowProps {
	label: string;
	sublabel?: string;
	preview?: string;
	active: boolean;
	onClick: () => void;
	face: React.ReactNode;
	working?: boolean;
	needsInput?: boolean;
	unread?: boolean;
	unreadCount?: number;
	mentioned?: boolean;
	age?: string;
	actions?: React.ReactNode;
}

function RosterRow({ label, sublabel, preview, active, onClick, face, working, needsInput, unread, age, actions }: RosterRowProps) {
	return (
		<div className="group/row flex w-full items-center gap-0.5">
			<div
				role="button"
				tabIndex={0}
				onClick={onClick}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") onClick();
				}}
				className={cn(
					"group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition-hover active-press",
					active ? "bg-pi-surface-raised shadow-ring" : "hover:bg-pi-surface-raised",
				)}
			>
				{face}
				<span className="min-w-0 flex-1">
					<span
						className={cn(
							"flex items-center gap-1.5 text-xs font-medium",
							active ? "text-pi-text" : "text-pi-text-secondary group-hover:text-pi-text",
						)}
					>
						<span className="truncate">{label}</span>
						{needsInput && (
							<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-warning" title="Waiting for you" />
						)}
						{unread && (
							<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-accent" title="Unread messages" />
						)}
					</span>
					{sublabel && (
						<span className="block truncate text-2xs text-pi-text-muted">{sublabel}</span>
					)}
					{preview && (
						<span className="block truncate text-2xs text-pi-text-faint">{preview}</span>
					)}
				</span>
				{working ? (
					<Loader2 className="h-3 w-3 shrink-0 animate-spin text-pi-accent" />
				) : (
					age && <span className="shrink-0 text-2xs text-pi-text-faint">{age}</span>
				)}
			</div>
			<div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
				{actions}
			</div>
		</div>
	);
}

function HighlightedSnippet({ text, query }: { text: string; query: string }) {
	const needle = query.trim();
	if (!needle) return <>{text}</>;
	const index = text.toLowerCase().indexOf(needle.toLowerCase());
	if (index < 0) return <>{text}</>;
	return (
		<>
			{text.slice(0, index)}
			<mark className="rounded-sm bg-pi-accent-soft px-0.5 text-pi-text">{text.slice(index, index + needle.length)}</mark>
			{text.slice(index + needle.length)}
		</>
	);
}

function SectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between px-1.5 pb-1 pt-3">
			<span className="text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">{label}</span>
			{action}
		</div>
	);
}

function PromptCard({ prompt }: { prompt: OfficePrompt }) {
	const respond = useOfficeStore((s) => s.respond);
	return (
		<div className="mx-3 mb-2 rounded-lg border border-pi-border bg-pi-surface-raised p-2.5">
			<div className="mb-1 text-2xs font-semibold text-pi-text">
				{prompt.coworkerName} · {prompt.kind === "approval" ? "Approval" : "Question"}
			</div>
			<div className="mb-1 text-xs text-pi-text-secondary">{prompt.title}</div>
			{prompt.message !== prompt.title && (
				<div className="mb-2 text-2xs text-pi-text-muted">{prompt.message}</div>
			)}
			<div className="flex flex-wrap gap-1.5">
				{prompt.choices.map((choice) => (
					<Button
						key={choice}
						variant={choice === "Deny" ? "outline" : "secondary"}
						size="xs"
						onClick={() => void respond(prompt.requestId, choice)}
					>
						{choice}
					</Button>
				))}
			</div>
		</div>
	);
}

const MessageBubble = memo(function MessageBubble({
	message,
	coworker,
	compact = false,
	onReply,
	onDelete,
}: {
	message: OfficeMessage;
	coworker?: OfficeCoworker;
	compact?: boolean;
	onReply?: (message: OfficeMessage) => void;
	onDelete?: (message: OfficeMessage) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	if (message.from.kind === "system") {
		return <div className="px-3 py-1 text-center text-2xs text-pi-text-faint">{message.text}</div>;
	}
	const isUser = message.from.kind === "user";
	const long = message.text.length > 700;
	const copy = async () => {
		if (!(await copyOfficeText(message.text))) {
			toast.error("Could not copy message");
		}
	};
	return (
		<div className={cn("group/message flex gap-2 px-3", compact ? "py-0.5" : "py-1.5", isUser && "flex-row-reverse")}>
			{compact ? (
				<span className="w-6 shrink-0" />
			) : coworker ? (
				<Face handle={coworker.handle} name={coworker.name} face={coworker.face} size={24} />
			) : (
				<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pi-surface-raised text-2xs text-pi-text-muted">
					{isUser ? "You" : "·"}
				</span>
			)}
			<div className={cn("min-w-0 max-w-[85%]", isUser && "text-right")}>
				<div
					className="mb-0.5 text-2xs text-pi-text-faint"
					title={new Date(message.at).toLocaleString()}
				>
					{compact ? relativeTime(message.at) : `${isUser ? "You" : message.from.name} · ${relativeTime(message.at)}`}
				</div>
				<div
					className={cn(
						// Markdown-rendered (chat scale): the CSS var pins the prose
						// typography to the bubble's 12px rhythm.
						"inline-block max-w-full break-words rounded-lg px-2.5 py-1.5 text-xs leading-relaxed [--conversation-text-font-size:0.75rem]",
						long && !expanded && "max-h-40 overflow-hidden",
						isUser
							? "bg-pi-accent-soft text-pi-text"
							: "bg-pi-surface-raised text-pi-text-secondary shadow-ring",
					)}
				>
					<MarkdownTextContent text={message.text} isRunning={false} />
				</div>
				{long && (
					<button
						type="button"
						className="mt-0.5 block text-2xs text-pi-text-faint hover:text-pi-text"
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded ? "Show less" : "Show more"}
					</button>
				)}
				{message.images && message.images.length > 0 && (
					<div className={cn("mt-1 flex flex-wrap gap-1", isUser && "justify-end")}>
						{message.images.map((image) =>
							image.kind === "image" ? (
								<img
									key={image.name}
									src={image.data}
									alt={image.name}
									title={image.name}
									className="h-16 w-16 rounded-md border border-pi-border object-cover"
								/>
							) : (
								<span
									key={image.name}
									className="rounded border border-pi-border px-1.5 py-0.5 text-2xs text-pi-text-muted"
								>
									File: {image.name}
								</span>
							),
						)}
					</div>
				)}
				<div
					className={cn(
						"mt-0.5 hidden items-center gap-0.5 group-focus-within/message:flex group-hover/message:flex",
						isUser && "justify-end",
					)}
				>
					<Button variant="ghost" size="icon-sm" icon={Copy} aria-label="Copy message" title="Copy message" onClick={() => void copy()} />
					{onReply && (
						<Button
							variant="ghost"
							size="icon-sm"
							icon={Quote}
							aria-label="Quote message"
							title="Quote message"
							onClick={() => onReply(message)}
						/>
					)}
					{onDelete && (
						<Button
							variant="ghost"
							size="icon-sm"
							icon={Trash2}
							aria-label="Delete message"
							title="Delete message"
							onClick={() => onDelete(message)}
						/>
					)}
				</div>
			</div>
		</div>
	);
});

function HuddleCallBar({ huddleId }: { huddleId: string }) {
	const call = useHuddleCallStore();
	if (!call.active || call.huddleId !== huddleId) return null;
	const phaseLabel =
		call.phase === "connecting"
			? "Connecting…"
			: call.phase === "transcribing"
				? "Transcribing…"
				: call.phase === "thinking"
					? "The room is thinking…"
					: call.phase === "speaking"
						? `${call.speakingName || "A coworker"} is speaking…`
						: call.muted
							? "Muted"
							: "Listening…";
	const tone =
		call.phase === "speaking"
			? "bg-pi-accent"
			: call.phase === "listening" && !call.muted
				? "bg-emerald-400"
				: "bg-pi-warning";
	return (
		<div className="border-b border-pi-border bg-pi-surface-raised/60 px-3 py-2">
			<div className="flex items-center gap-2">
				<span className={cn("h-2 w-2 shrink-0 rounded-full", tone, call.phase !== "listening" && "animate-pulse")} />
				<span className="min-w-0 flex-1 truncate text-2xs text-pi-text-secondary">
					{phaseLabel}
					{call.transcript && call.phase !== "listening" && (
						<span className="text-pi-text-faint"> · “{call.transcript}”</span>
					)}
				</span>
				<Button
					variant="ghost"
					size="icon-sm"
					icon={call.muted ? MicOff : Mic}
					aria-label={call.muted ? "Unmute mic" : "Mute mic"}
					title={call.muted ? "Unmute the mic" : "Mute the mic (the room keeps talking)"}
					onClick={() => huddleCall.toggleMute()}
				/>
				<Button
					variant="ghost"
					size="icon-sm"
					icon={SkipForward}
					aria-label="Skip the sentence being spoken"
					title="Skip the sentence being spoken"
					disabled={call.phase !== "speaking"}
					onClick={() => huddleCall.skipSentence()}
				/>
				<Button
					variant="ghost"
					size="icon-sm"
					icon={PhoneOff}
					aria-label="End huddle call"
					title="End the huddle call"
					onClick={() => void huddleCall.stop()}
				/>
			</div>
			<div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pi-border/60">
				<div
					className="h-full rounded-full bg-pi-accent transition-[width] duration-100"
					style={{ width: `${Math.round(call.level * 100)}%` }}
				/>
			</div>
			{call.spokenTotal > 1 && (
				<div className="mt-1 flex items-center gap-1">
					{Array.from({ length: call.spokenTotal }, (_, i) => (
						<span
							key={i}
							className={cn(
								"h-0.5 flex-1 rounded-full",
								i < call.spokenIndex
									? "bg-pi-text-muted/60"
									: i === call.spokenIndex
										? "bg-pi-text"
										: "bg-pi-border",
							)}
						/>
					))}
				</div>
			)}
			{call.error && <div className="mt-1 text-2xs text-pi-error">{call.error}</div>}
		</div>
	);
}

function HuddleChat({ huddleId, onEdit }: { huddleId: string; onEdit?: () => void }) {
	const snapshot = useOfficeStore((s) => s.snapshot);
	const huddle = useOfficeStore((s) => s.huddles[huddleId]);
	const send = useOfficeStore((s) => s.send);
	const stop = useOfficeStore((s) => s.stop);
	const focusMessageId = useOfficeStore((s) => s.focusMessageId);
	const clearFocusMessage = useOfficeStore((s) => s.clearFocusMessage);
	const deleteMessage = useOfficeStore((s) => s.deleteMessage);
	const confirm = useConfirmStore((s) => s.ask);
	const [draft, setDraft] = useState(() => loadOfficeDraft(huddleId));
	const [attachments, setAttachments] = useState<OfficeAttachment[]>([]);
	const [sending, setSending] = useState(false);
	const [stick, setStick] = useState(true);
	const [pending, setPending] = useState(0);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const [mention, setMention] = useState<ReturnType<typeof findMentionMatch>>(null);
	const [mentionIndex, setMentionIndex] = useState(0);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const stickRef = useRef(true);
	const lastLengthRef = useRef(0);
	const unreadRef = useRef<{ id: string; at: number }>({ id: "", at: 0 });

	const log = huddle?.data.log ?? [];
	const logLength = log.length;
	const working = huddle?.data.running;
	const coworkers = snapshot?.coworkers ?? [];
	const byId = useMemo(() => new Map(coworkers.map((c) => [c.id, c])), [coworkers]);
	const memberIds = snapshot?.huddles.find((h) => h.id === huddleId)?.members ?? [];
	const memberCoworkers = useMemo(
		() => memberIds.map((id) => byId.get(id)).filter((c): c is OfficeCoworker => Boolean(c)),
		[memberIds, byId],
	);
	const dmTarget = memberIds.length === 1 ? byId.get(memberIds[0]) : undefined;
	const huddleSummary = snapshot?.huddles.find((h) => h.id === huddleId);
	const title = dmTarget ? dmTarget.name : (huddleSummary?.name ?? "Huddle");
	const subtitle = dmTarget ? "Direct message" : memberCoworkers.map((c) => c.name).join(", ") || "No members";
	const callActive = useHuddleCallStore((s) => s.active && s.huddleId === huddleId);
	const typingCoworker = working?.current ? coworkers.find((c) => c.name === working.current) : undefined;
	const mentionCandidates = mention ? filterMentionCandidates(memberCoworkers, mention.query) : [];

	if (unreadRef.current.id !== huddleId) {
		const read = useOfficeReadStore.getState();
		unreadRef.current = { id: huddleId, at: read.readAt[huddleId] ?? read.initializedAt };
	}
	const firstUnreadIndex = useMemo(
		() => log.findIndex((message) => message.at > unreadRef.current.at),
		[log, unreadRef.current.at],
	);

	useEffect(() => {
		saveOfficeDraft(huddleId, draft);
	}, [draft, huddleId]);

	const scrollToBottom = useCallback((smooth = false) => {
		const node = scrollRef.current;
		if (!node) return;
		node.scrollTo({ top: node.scrollHeight, behavior: smooth ? "smooth" : "auto" });
	}, []);

	useLayoutEffect(() => {
		if (stickRef.current) {
			scrollToBottom();
			lastLengthRef.current = logLength;
			setPending(0);
		}
	}, [logLength, working?.current, scrollToBottom]);

	useLayoutEffect(() => {
		if (!focusMessageId) return;
		const container = scrollRef.current;
		if (!container) return;
		const node = container.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`);
		if (!node) return;
		stickRef.current = false;
		setStick(false);
		setPending(0);
		const containerRect = container.getBoundingClientRect();
		const nodeRect = node.getBoundingClientRect();
		container.scrollTop += nodeRect.top - containerRect.top - container.clientHeight / 2 + nodeRect.height / 2;
		setHighlighted(focusMessageId);
		const timer = setTimeout(() => {
			setHighlighted(null);
			clearFocusMessage();
		}, 2_400);
		return () => clearTimeout(timer);
	}, [focusMessageId, logLength, clearFocusMessage]);

	useEffect(() => {
		const added = logLength - lastLengthRef.current;
		if (added > 0 && !stickRef.current) setPending((current) => current + added);
		lastLengthRef.current = logLength;
	}, [logLength]);

	const markRead = useCallback(() => {
		useOfficeReadStore.getState().markRead(huddleId);
	}, [huddleId]);

	useEffect(() => {
		if (stick) markRead();
	}, [logLength, stick, markRead]);

	const jumpToLatest = () => {
		stickRef.current = true;
		setStick(true);
		setPending(0);
		markRead();
		scrollToBottom(true);
	};

	const onScroll = () => {
		const node = scrollRef.current;
		if (!node) return;
		const next = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
		stickRef.current = next;
		setStick(next);
		if (next) {
			setPending(0);
			markRead();
		}
	};

	const updateMention = useCallback(
		(value: string, cursor: number) => {
			const match = findMentionMatch(value, cursor, memberCoworkers);
			setMention(match);
			setMentionIndex(0);
		},
		[memberCoworkers],
	);

	const chooseMention = useCallback(
		(member: OfficeCoworker | undefined) => {
			if (!mention || !member) return;
			const applied = applyMention(draft, mention, member.handle);
			setDraft(applied.text);
			setMention(null);
			requestAnimationFrame(() => {
				const node = textareaRef.current;
				if (!node) return;
				node.focus();
				node.setSelectionRange(applied.cursor, applied.cursor);
			});
		},
		[draft, mention],
	);

	const addFiles = useCallback(
		async (files: File[]) => {
			const images = files.filter((file) => file.type.startsWith("image/"));
			if (images.length === 0) return;
			const room = 4 - attachments.length;
			if (room <= 0) {
				toast.warning("Attachment limit reached", "A huddle message can carry up to 4 attachments.");
				return;
			}
			if (images.length > room) {
				toast.warning("Some attachments skipped", `A huddle message can carry up to 4 attachments.`);
			}
			const parsed = await Promise.all(images.slice(0, room).map(readImageAttachment));
			setAttachments((current) => [...current, ...parsed.filter((item): item is OfficeAttachment => item !== null)].slice(0, 4));
		},
		[attachments.length],
	);

	const quote = useCallback((message: OfficeMessage) => {
		const source = message.from.kind === "user" ? "You" : message.from.name;
		const text = message.text.length > 500 ? `${message.text.slice(0, 500)}…` : message.text;
		const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
		setDraft((current) => `${current}${current.trim() ? "\n\n" : ""}> ${source}:\n${quoted}\n\n`);
		requestAnimationFrame(() => textareaRef.current?.focus());
	}, []);

	const requestDelete = useCallback(
		async (message: OfficeMessage) => {
			const confirmed = await confirm({
				title: "Delete this message?",
				message: "The message is removed from the room log. This cannot be undone.",
				confirmLabel: "Delete",
				danger: true,
			});
			if (!confirmed) return;
			try {
				await deleteMessage(message.id);
			} catch (error) {
				toast.error("Could not delete message", error instanceof Error ? error.message : String(error));
			}
		},
		[confirm, deleteMessage],
	);

	const submit = async () => {
		const text = draft.trim();
		if (sending) return;
		if (text === "/stop") {
			setDraft("");
			await stop();
			return;
		}
		if (text === "/call") {
			setDraft("");
			if (voiceCall.active) await voiceCall.stop();
			await huddleCall.start(huddleId, title);
			return;
		}
		if (text === "/end") {
			setDraft("");
			await huddleCall.stop();
			return;
		}
		if (text === "/mute") {
			setDraft("");
			huddleCall.toggleMute();
			return;
		}
		if (!text && attachments.length === 0) return;
		setSending(true);
		try {
			await send(text, attachments);
			setDraft("");
			setAttachments([]);
			setMention(null);
		} catch (error) {
			toast.error("Could not send to the huddle", error instanceof Error ? error.message : String(error));
		} finally {
			setSending(false);
		}
	};

	const rows: React.ReactNode[] = [];
	let previous: OfficeMessage | undefined;
	let lastDay = "";
	for (let index = 0; index < log.length; index += 1) {
		const message = log[index];
		const day = dayLabel(message.at);
		if (day.key !== lastDay) {
			lastDay = day.key;
			previous = undefined;
			rows.push(
				<div key={`day-${day.key}-${index}`} className="flex items-center gap-2 px-3 py-2">
					<span className="h-px flex-1 bg-pi-border/70" />
					<span className="text-2xs font-medium uppercase tracking-wide text-pi-text-faint">{day.label}</span>
					<span className="h-px flex-1 bg-pi-border/70" />
				</div>,
			);
		}
		if (index === firstUnreadIndex) {
			rows.push(
				<div key="unread" className="flex items-center gap-2 px-3 py-1">
					<span className="h-px flex-1 bg-pi-accent/60" />
					<span className="text-2xs font-medium text-pi-accent">New messages</span>
					<span className="h-px flex-1 bg-pi-accent/60" />
				</div>,
			);
		}
		const compact =
			previous !== undefined &&
			previous.from.kind === message.from.kind &&
			previous.from.id === message.from.id &&
			message.at - previous.at < 5 * 60_000;
		rows.push(
			<div
				key={message.id}
				data-message-id={message.id}
				className={cn(
					"scroll-mt-2 rounded-lg transition-colors duration-500",
					highlighted === message.id && "bg-pi-accent-soft/35",
				)}
			>
				<MessageBubble
					message={message}
					coworker={message.from.id ? byId.get(message.from.id) : undefined}
					compact={compact}
					onReply={quote}
					onDelete={message.from.kind === "user" ? requestDelete : undefined}
				/>
			</div>,
		);
		previous = message;
	}

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-1.5 border-b border-pi-border px-2 py-1.5">
				<Button
					variant="ghost"
					size="icon-sm"
					icon={ChevronLeft}
					aria-label="Back to roster"
					title="Back to roster"
					onClick={() => useOfficeStore.setState({ openHuddleId: null })}
				/>
				{memberCoworkers.length > 0 && (
					<span className="flex shrink-0 -space-x-1.5">
						{memberCoworkers.slice(0, 3).map((member) => (
							<Face
								key={member.id}
								handle={member.handle}
								name={member.name}
								face={member.face}
								size={20}
							/>
						))}
					</span>
				)}
				<div className="min-w-0 flex-1">
					<div className="truncate text-xs font-semibold text-pi-text">{title}</div>
					<div className="truncate text-2xs text-pi-text-faint">{subtitle}</div>
				</div>
				{working && (
					<span className="flex animate-pulse items-center gap-1 text-2xs text-pi-text-muted" title="A turn is running">
						<Loader2 className="h-3 w-3 animate-spin" />
					</span>
				)}
				<Button
					variant="ghost"
					size="icon-sm"
					icon={callActive ? PhoneOff : PhoneCall}
					aria-label={callActive ? "End the huddle call" : "Start a voice call"}
					title={callActive ? "End the huddle call" : "Start a voice call in this huddle"}
					onClick={() => {
						void (async () => {
							if (callActive) {
								await huddleCall.stop();
								return;
							}
							if (voiceCall.active) await voiceCall.stop();
							await huddleCall.start(huddleId, title);
						})();
					}}
				/>
				{working && (
					<Button
						variant="ghost"
						size="icon-sm"
						icon={Square}
						aria-label="Stop the room"
						title="Stop the room"
						onClick={() => void stop()}
					/>
				)}
				{onEdit && (
					<Button
						variant="ghost"
						size="icon-sm"
						icon={Pencil}
						aria-label="Edit huddle"
						title="Edit huddle"
						onClick={onEdit}
					/>
				)}
			</div>

			<HuddleCallBar huddleId={huddleId} />

			<div className="relative min-h-0 flex-1">
				<div
					ref={scrollRef}
					onScroll={onScroll}
					className="h-full overflow-y-auto py-2"
					role="log"
					aria-live="polite"
					aria-relevant="additions"
				>
					{log.length === 0 && (
						<div className="px-4 py-8 text-center text-2xs text-pi-text-faint">
							{dmTarget
								? `Message ${dmTarget.name} — your DM history lives in their own session.`
								: "Say something to get the huddle going."}
						</div>
					)}
					{rows}
					{working?.current && (
						<div className="flex gap-2 px-3 py-1.5">
							{typingCoworker ? (
								<Face
									handle={typingCoworker.handle}
									name={typingCoworker.name}
									face={typingCoworker.face}
									size={24}
								/>
							) : (
								<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pi-surface-raised text-2xs text-pi-text-muted">
									·
								</span>
							)}
							<div>
								<div className="mb-0.5 text-2xs text-pi-text-faint">{working.current} is typing…</div>
								<div className="inline-flex items-center gap-1 rounded-lg bg-pi-surface-raised px-3 py-2 shadow-ring">
									<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pi-text-muted" style={{ animationDelay: "0ms" }} />
									<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pi-text-muted/80" style={{ animationDelay: "150ms" }} />
									<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pi-text-muted/60" style={{ animationDelay: "300ms" }} />
								</div>
							</div>
						</div>
					)}
				</div>
				{(!stick || pending > 0) && (
					<button
						type="button"
						onClick={jumpToLatest}
						className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-pi-border bg-pi-surface-raised/95 px-2.5 py-1 text-2xs text-pi-text shadow-overlay backdrop-blur-sm"
					>
						{pending > 0 ? `New messages (${pending})` : "Jump to latest"} ↓
					</button>
				)}
			</div>

			<div className="border-t border-pi-border p-2">
				{attachments.length > 0 && (
					<div className="mb-1.5 flex flex-wrap gap-1.5">
						{attachments.map((attachment, index) => (
							<div
								key={`${attachment.name}-${index}`}
								className="group/attachment relative rounded-md border border-pi-border bg-pi-surface-raised p-1"
							>
								<img src={attachment.data} alt={attachment.name} className="h-10 w-10 rounded object-cover" />
								<button
									type="button"
									aria-label={`Remove ${attachment.name}`}
									title={`Remove ${attachment.name}`}
									onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
									className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-pi-surface text-pi-text-muted shadow-ring hover:text-pi-text"
								>
									<X className="h-2.5 w-2.5" />
								</button>
							</div>
						))}
					</div>
				)}
				<div className="relative">
					{mention && mentionCandidates.length > 0 && (
						<div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-48 overflow-y-auto rounded-md border border-pi-border bg-pi-surface-raised p-1 shadow-overlay">
							{mentionCandidates.map((member, index) => (
								<button
									key={member.id}
									type="button"
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => chooseMention(member)}
									className={cn(
										"flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs",
										index === mentionIndex ? "bg-pi-surface text-pi-text" : "text-pi-text-secondary hover:bg-pi-surface",
									)}
								>
									<Face handle={member.handle} name={member.name} face={member.face} size={20} />
									<span className="min-w-0 flex-1 truncate">{member.name}</span>
									<span className="text-2xs text-pi-text-faint">@{member.handle}</span>
								</button>
							))}
						</div>
					)}
					<div className="flex items-end gap-1.5">
						<Button
							variant="ghost"
							size="icon-sm"
							icon={ImagePlus}
							aria-label="Attach image"
							title="Attach image"
							onClick={() => fileInputRef.current?.click()}
						/>
						<textarea
							ref={textareaRef}
							value={draft}
							onChange={(event) => {
								setDraft(event.target.value);
								updateMention(event.target.value, event.target.selectionStart);
							}}
							onKeyDown={(event) => {
								if (mention && mentionCandidates.length > 0) {
									if (event.key === "ArrowDown") {
										event.preventDefault();
										setMentionIndex((index) => (index + 1) % mentionCandidates.length);
										return;
									}
									if (event.key === "ArrowUp") {
										event.preventDefault();
										setMentionIndex((index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length);
										return;
									}
									if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
										event.preventDefault();
										chooseMention(mentionCandidates[mentionIndex]);
										return;
									}
									if (event.key === "Escape") {
										event.preventDefault();
										setMention(null);
										return;
									}
								}
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									void submit();
								}
							}}
							onPaste={(event) => {
								const files = Array.from(event.clipboardData.files);
								if (files.some((file) => file.type.startsWith("image/"))) {
									event.preventDefault();
									void addFiles(files);
								}
							}}
							onDrop={(event) => {
								event.preventDefault();
								void addFiles(Array.from(event.dataTransfer.files));
							}}
							onDragOver={(event) => event.preventDefault()}
							placeholder={dmTarget ? `Message @${dmTarget.handle}…` : "Message the huddle… (@handle to address someone)"}
							rows={2}
							className="max-h-28 w-full resize-none rounded-md bg-pi-surface-raised px-2.5 py-1.5 text-xs text-pi-text shadow-ring transition-smooth placeholder:text-pi-text-faint focus:shadow-focus focus:outline-none"
						/>
						<Button
							variant="primary"
							size="icon-sm"
							icon={Send}
							aria-label="Send"
							loading={sending}
							disabled={(!draft.trim() && attachments.length === 0) || sending}
							onClick={() => void submit()}
						/>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						multiple
						className="hidden"
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							event.target.value = "";
							void addFiles(files);
						}}
					/>
				</div>
				<div className="mt-1 flex items-center justify-between gap-2">
					<div className="flex min-w-0 flex-wrap gap-1">
						{coworkers.length > 0 && !dmTarget &&
							coworkers
									.filter((c) => memberIds.includes(c.id))
									.map((c) => (
										<button
											key={c.id}
											type="button"
											onClick={() => {
												const next = `${draft}${draft.endsWith(" ") || draft === "" ? "" : " "}@${c.handle} `;
												setDraft(next);
												setMention(null);
												requestAnimationFrame(() => textareaRef.current?.focus());
											}}
											className="rounded-full bg-pi-surface-raised px-2 py-0.5 text-2xs text-pi-text-muted shadow-ring transition-hover hover:text-pi-text active-press"
										>
											@{c.handle}
										</button>
									))}
					</div>
					<span className="shrink-0 text-2xs text-pi-text-faint">/stop · /call</span>
				</div>
				{working && (
					<div className="mt-1 flex items-center gap-1 text-2xs text-pi-text-faint">
						<Loader2 className="h-2.5 w-2.5 animate-spin" />
						The room is working{working.current ? ` — ${working.current}` : ""}. Your message will queue.
					</div>
				)}
			</div>
		</div>
	);
}

export function OfficePanel() {
	const snapshot = useOfficeStore((s) => s.snapshot);
	const error = useOfficeStore((s) => s.error);
	const openHuddleId = useOfficeStore((s) => s.openHuddleId);
	const openHuddle = useOfficeStore((s) => s.openHuddle);
	const refresh = useOfficeStore((s) => s.refresh);
	const callHuddleId = useHuddleCallStore((s) => (s.active ? s.huddleId : null));
	const pinned = useOfficeStore((s) => s.pinned);
	const togglePinned = useOfficeStore((s) => s.togglePinned);
	const [query, setQuery] = useState("");
	const [searchHits, setSearchHits] = useState<OfficeSearchHit[]>([]);
	const [searching, setSearching] = useState(false);
	const [, setClock] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setClock((value) => value + 1), 30_000);
		return () => clearInterval(timer);
	}, []);
	const readAt = useOfficeReadStore((s) => s.readAt);
	const initializedAt = useOfficeReadStore((s) => s.initializedAt);
	const unread = useOfficeReadStore((s) => s.unread);
	const mentions = useOfficeReadStore((s) => s.mentions);
	const [coworkerEditor, setCoworkerEditor] = useState<{ open: boolean; editing?: OfficeCoworker }>({ open: false });
	const [detailsCoworker, setDetailsCoworker] = useState<OfficeCoworker | null>(null);
	const [huddleEditor, setHuddleEditor] = useState<{ open: boolean; editing?: OfficeHuddleSummary }>({ open: false });
	const [errandEditor, setErrandEditor] = useState(false);
	const [floorExpanded, setFloorExpanded] = useState(false);
	const [floorView, setFloorView] = useState(() => {
		if (typeof window === "undefined") return false;
		try {
			return window.localStorage.getItem("a-coder.office.floorOpen") === "1";
		} catch {
			return false;
		}
	});

	const toggleFloor = (): void => {
		const next = !floorView;
		setFloorView(next);
		if (!next) setFloorExpanded(false);
		try {
			window.localStorage.setItem("a-coder.office.floorOpen", next ? "1" : "0");
		} catch {
			// Storage can be disabled; the in-memory toggle still works.
		}
	};

	useEffect(() => {
		if (!floorExpanded) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setFloorExpanded(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [floorExpanded]);

	useEffect(() => {
		// The engine pushes office_update snapshots; only fetch when we have
		// nothing to paint (first open after launch).
		if (!snapshot) void refresh();
	}, [refresh, snapshot]);

	const coworkers = snapshot?.coworkers ?? [];
	const statuses = snapshot?.statuses ?? {};
	const huddles = snapshot?.huddles ?? [];
	const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
	const lastActiveFor = useMemo(() => {
		const byId = new Map(huddles.map((h) => [h.id, h.lastActive]));
		return (id: string) => byId.get(id);
	}, [huddles]);
	const groupHuddles = sortOfficeRooms(
		huddles.filter((h) => !h.id.startsWith("dm:")),
		pinnedSet,
	);
	const sortedCoworkers = sortCoworkers(coworkers, (id) => lastActiveFor(`dm:${id}`), pinnedSet);
	const errands = snapshot?.errands ?? [];
	const prompts = snapshot?.pendingPrompts ?? [];
	const coworkerById = useMemo(() => new Map(coworkers.map((c) => [c.id, c])), [coworkers]);
	const openSummary = openHuddleId ? huddles.find((h) => h.id === openHuddleId) : undefined;
	useEffect(() => {
		const value = query.trim();
		if (!value) {
			setSearchHits([]);
			setSearching(false);
			return;
		}
		let cancelled = false;
		setSearching(true);
		const timer = setTimeout(() => {
			void officeSearch(value, 30)
				.then((hits) => {
					if (!cancelled) setSearchHits(hits);
				})
				.catch(() => {
					if (!cancelled) {
						const state = useOfficeStore.getState();
						setSearchHits(searchOffice(state.snapshot, state.huddles, value));
					}
				})
				.finally(() => {
					if (!cancelled) setSearching(false);
				});
		}, 180);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query]);

	if (openHuddleId) {
		return (
			<div className="flex h-full flex-col">
				{prompts.map((prompt) => (
					<PromptCard key={prompt.requestId} prompt={prompt} />
				))}
				<HuddleChat
					key={openHuddleId}
					huddleId={openHuddleId}
					onEdit={
						openSummary && !openHuddleId.startsWith("dm:")
							? () => setHuddleEditor({ open: true, editing: openSummary })
							: undefined
					}
				/>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex items-center justify-between border-b border-pi-border px-3 py-2">
				<span className="text-xs font-semibold text-pi-text">A-Coder Virtual Office</span>
				<div className="flex items-center gap-0.5">
					<Button
						variant={floorView ? "default" : "ghost"}
						size="icon-sm"
						icon={Building2}
						aria-label="Floor view"
						aria-pressed={floorView}
						onClick={() => toggleFloor()}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						icon={Plus}
						aria-label="New coworker"
						onClick={() => setCoworkerEditor({ open: true })}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						icon={Users}
						aria-label="New huddle"
						onClick={() => setHuddleEditor({ open: true })}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						icon={CalendarClock}
						aria-label="New errand"
						onClick={() => setErrandEditor(true)}
					/>
				</div>
			</div>

			{!openHuddleId && callHuddleId && <HuddleCallBar huddleId={callHuddleId} />}

			{error && (
				<div className="px-3 py-2 text-2xs text-pi-error">
					{error}{" "}
					<button type="button" className="underline" onClick={() => void refresh()}>
						retry
					</button>
				</div>
			)}

			{floorView ? (
				<div
					className={
						floorExpanded
							? "fixed inset-0 z-[var(--z-modal)] flex flex-col gap-2 bg-pi-bg p-3"
							: "relative flex min-h-0 flex-1 flex-col"
					}
				>
					{floorExpanded && (
						<div className="flex items-center justify-between">
							<span className="text-xs font-semibold text-pi-text">Virtual office floor</span>
							<Button
								variant="ghost"
								size="icon-sm"
								icon={Minimize2}
								aria-label="Close expanded floor"
								title="Close expanded floor"
								onClick={() => setFloorExpanded(false)}
							/>
						</div>
					)}
					<div className="min-h-0 flex-1">
						<FloorView />
					</div>
					{!floorExpanded && (
						<Button
							variant="ghost"
							size="icon-sm"
							icon={Maximize2}
							aria-label="Expand floor"
							title="Expand floor"
							className="absolute left-2 top-10 z-20 bg-pi-surface/80 backdrop-blur-sm"
							onClick={() => setFloorExpanded(true)}
						/>
					)}
				</div>
			) : (
			<div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
				{prompts.length > 0 && (
					<>
						<SectionHeader label="Needs you" />
						{prompts.map((prompt) => (
							<PromptCard key={prompt.requestId} prompt={prompt} />
						))}
					</>
				)}

				<SearchField
					value={query}
					onChange={setQuery}
					placeholder="Search rooms and messages…"
					ariaLabel="Search the office"
					visible={huddles.length > 0 || coworkers.length > 0}
					className="mx-1.5"
				/>
				{query.trim().length > 0 && (
					<>
						<SectionHeader label={searching ? "Searching rooms…" : `Search results (${searchHits.length})`} />
						{searchHits.length === 0 && (
							<div className="px-1.5 py-2 text-2xs text-pi-text-faint">No matches in room names or messages.</div>
						)}
						{searchHits.map((hit) => (
							<button
								key={`${hit.huddleId}:${hit.at}:${hit.snippet}`}
								type="button"
								onClick={() => void openHuddle(hit.huddleId, hit.messageId)}
								className="flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-pi-surface-raised"
							>
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="truncate text-xs text-pi-text">{hit.title}</span>
									<span className="shrink-0 text-2xs text-pi-text-faint">
										{hit.author ?? "Message"} · {relativeTime(hit.at)}
									</span>
								</span>
								<span className="truncate text-2xs text-pi-text-muted">
									<HighlightedSnippet text={hit.snippet} query={query} />
								</span>
							</button>
						))}
					</>
				)}

				<SectionHeader label="Coworkers" />
				{coworkers.length === 0 && (
					<div className="px-1.5 py-2 text-2xs leading-relaxed text-pi-text-faint">
						No coworkers yet. Hire one — give it a name, a role, and a face.
					</div>
				)}
				{sortedCoworkers.map((coworker) => {
					const dmId = `dm:${coworker.id}`;
					const summary = huddles.find((h) => h.id === dmId);
					const status = statuses[coworker.id];
					return (
						<div key={coworker.id}>
							<RosterRow
								label={coworker.name}
								sublabel={coworker.title ?? coworker.description}
								active={openHuddleId === dmId}
								working={status?.working}
								needsInput={status?.needsInput}
								unread={isHuddleUnread(summary?.lastActive, readAt, initializedAt, dmId)}
								unreadCount={unread[dmId] ?? 0}
								mentioned={mentions[dmId] ?? false}
								preview={summary?.preview}
								age={relativeTime(summary?.lastActive)}
								face={
									<Face
										handle={coworker.handle}
										name={coworker.name}
										face={coworker.face}
										size={26}
										working={status?.working}
										needsInput={status?.needsInput}
									/>
								}
								onClick={() => void openHuddle(dmId)}
								actions={
									<>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={pinned.includes(dmId) ? `Unpin ${coworker.name}` : `Pin ${coworker.name}`}
											icon={pinned.includes(dmId) ? PinOff : Pin}
											onClick={(event) => {
												event.stopPropagation();
												togglePinned(dmId);
											}}
										/>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Stats for ${coworker.name}`}
											icon={BarChart3}
											onClick={() => setDetailsCoworker(coworker)}
										/>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Edit ${coworker.name}`}
											icon={Pencil}
											onClick={() => setCoworkerEditor({ open: true, editing: coworker })}
										/>
									</>
								}
							/>
						</div>
					);
				})}

				<SectionHeader
					label="Huddles"
					action={
						<Button variant="ghost" size="xs" icon={Plus} onClick={() => setHuddleEditor({ open: true })}>
							New
						</Button>
					}
				/>
				{groupHuddles.length === 0 && (
					<div className="px-1.5 py-2 text-2xs text-pi-text-faint">
						No huddles. Pull a few coworkers into a room and let them talk.
					</div>
				)}
				{groupHuddles.map((huddle) => (
					<RosterRow
						key={huddle.id}
						label={huddle.name}
						sublabel={huddle.members
							.map((id) => coworkerById.get(id)?.name)
							.filter(Boolean)
							.join(", ")}
						active={openHuddleId === huddle.id}
						unread={isHuddleUnread(huddle.lastActive, readAt, initializedAt, huddle.id)}
						unreadCount={unread[huddle.id] ?? 0}
						mentioned={mentions[huddle.id] ?? false}
						preview={huddle.preview}
						age={relativeTime(huddle.lastActive)}
						face={
							<span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-pi-surface-raised">
								<Users className="h-3 w-3 text-pi-text-muted" />
							</span>
						}
						onClick={() => void openHuddle(huddle.id)}
						actions={
							<>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={pinned.includes(huddle.id) ? `Unpin ${huddle.name}` : `Pin ${huddle.name}`}
									icon={pinned.includes(huddle.id) ? PinOff : Pin}
									onClick={(event) => {
										event.stopPropagation();
										togglePinned(huddle.id);
									}}
								/>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Edit ${huddle.name}`}
									icon={Pencil}
									onClick={() => setHuddleEditor({ open: true, editing: huddle })}
								/>
							</>
						}
					/>
				))}

				<SectionHeader
					label="Errands"
					action={
						<Button variant="ghost" size="xs" icon={Plus} onClick={() => setErrandEditor(true)}>
							New
						</Button>
					}
				/>
				{errands.length === 0 && (
					<div className="px-1.5 py-2 text-2xs text-pi-text-faint">
						No errands. Schedule standing work — with continuity, a coworker learns between runs.
					</div>
				)}
				{errands.map((errand) => {
					const owner = coworkerById.get(errand.coworkerId);
					return (
						<div key={errand.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
							<Face handle={owner?.handle ?? errand.coworkerId} name={owner?.name ?? "?"} face={owner?.face} size={20} />
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5 text-xs text-pi-text-secondary">
									<span className="truncate">{errand.name}</span>
									{!errand.enabled && <span className="text-2xs text-pi-text-faint">(paused)</span>}
								</div>
								<div className="truncate text-2xs text-pi-text-muted">
									{errand.schedule.kind === "every"
										? `every ${errand.schedule.minutes}m`
										: errand.schedule.kind === "daily"
											? `daily ${errand.schedule.time}`
											: "once"}
									{owner ? ` · @${owner.handle}` : ""}
									{errand.lastStatus === "error" ? " · failed" : ""}
									{errand.lastStatus === "timeout" ? " · timed out" : ""}
									{errand.enabled && errand.nextRunAt ? ` · next in ${untilTime(errand.nextRunAt)}` : ""}
								</div>
							</div>
							<Button
								variant="ghost"
								size="xs"
								icon={Bot}
								aria-label="Run now"
								onClick={() => void officeRunErrand(errand.id).catch(() => {})}
							/>
								<Button
									variant="ghost"
									size="xs"
									aria-label="Delete errand"
									onClick={() => void officeDeleteErrand(errand.id)}
								>
									×
								</Button>
						</div>
					);
				})}
			</div>
			)}

			{coworkerEditor.open && (
				<CoworkerEditor
					editing={coworkerEditor.editing}
					onClose={() => setCoworkerEditor({ open: false })}
				/>
			)}
			{huddleEditor.open && (
				<HuddleEditor editing={huddleEditor.editing} onClose={() => setHuddleEditor({ open: false })} />
			)}
			{errandEditor && <ErrandEditor onClose={() => setErrandEditor(false)} />}
			{detailsCoworker && (
				<CoworkerDetails coworker={detailsCoworker} onClose={() => setDetailsCoworker(null)} />
			)}
		</div>
	);
}
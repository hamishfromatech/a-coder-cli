/**
 * A-Coder Virtual Office — right-sidebar panel: the roster (coworkers, huddles, errands)
 * plus the open huddle's conversation. The panel is self-contained; engine
 * events keep it live.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Building2, CalendarClock, Loader2, Pencil, Plus, Send, Square, Users } from "lucide-react";
import { Button } from "../ui/Button";
import { officeDeleteErrand, officeRunErrand } from "../../lib/rpc";
import { useOfficeStore } from "../../stores/office-store";
import { cn } from "../../lib/cn";
import type { OfficeCoworker, OfficeHuddleSummary, OfficeMessage, OfficePrompt } from "../../lib/rpc";
import { Face } from "./Face";
import { FloorView } from "./FloorView";
import { CoworkerEditor } from "./CoworkerEditor";
import { HuddleEditor } from "./HuddleEditor";
import { ErrandEditor } from "./ErrandEditor";

function relativeTime(ms: number | undefined): string {
	if (!ms) return "";
	const delta = Date.now() - ms;
	if (delta < 60_000) return "now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
	return `${Math.floor(delta / 86_400_000)}d`;
}

interface RosterRowProps {
	label: string;
	sublabel?: string;
	active: boolean;
	onClick: () => void;
	face: React.ReactNode;
	working?: boolean;
	needsInput?: boolean;
	age?: string;
	actions?: React.ReactNode;
}

function RosterRow({ label, sublabel, active, onClick, face, working, needsInput, age, actions }: RosterRowProps) {
	return (
		<div className="flex w-full items-center gap-0.5">
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
				</span>
				{sublabel && (
					<span className="block truncate text-2xs text-pi-text-muted">{sublabel}</span>
				)}
			</span>
			{working ? (
				<Loader2 className="h-3 w-3 shrink-0 animate-spin text-pi-accent" />
			) : (
				age && <span className="shrink-0 text-2xs text-pi-text-faint">{age}</span>
			)}
			</div>
			{actions}
		</div>
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

function MessageBubble({ message, coworker }: { message: OfficeMessage; coworker?: OfficeCoworker }) {
	if (message.from.kind === "system") {
		return (
			<div className="px-3 py-1 text-center text-2xs text-pi-text-faint">{message.text}</div>
		);
	}
	const isUser = message.from.kind === "user";
	return (
		<div className={cn("flex gap-2 px-3 py-1.5", isUser && "flex-row-reverse")}>
			{coworker ? (
				<Face handle={coworker.handle} name={coworker.name} face={coworker.face} size={24} />
			) : (
				<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pi-surface-raised text-2xs text-pi-text-muted">
					{isUser ? "You" : "·"}
				</span>
			)}
			<div className={cn("min-w-0 max-w-[85%]", isUser && "text-right")}>
				<div className="mb-0.5 text-2xs text-pi-text-faint">
					{isUser ? "You" : message.from.name} · {relativeTime(message.at)}
				</div>
				<div
					className={cn(
						"inline-block whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-xs leading-relaxed",
						isUser
							? "bg-pi-accent-soft text-pi-text"
							: "bg-pi-surface-raised text-pi-text-secondary shadow-ring",
					)}
				>
					{message.text}
				</div>
				{message.images && message.images.length > 0 && (
					<div className="mt-1 flex flex-wrap gap-1">
						{message.images.map((image) => (
							<span
								key={image.name}
								className="rounded border border-pi-border px-1.5 py-0.5 text-2xs text-pi-text-muted"
							>
								{image.kind === "image" ? "Image" : "File"}: {image.name}
							</span>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function HuddleChat({ huddleId }: { huddleId: string }) {
	const snapshot = useOfficeStore((s) => s.snapshot);
	const huddle = useOfficeStore((s) => s.huddles[huddleId]);
	const send = useOfficeStore((s) => s.send);
	const stop = useOfficeStore((s) => s.stop);
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	const log = huddle?.data.log ?? [];
	const working = huddle?.data.running;
	const coworkers = snapshot?.coworkers ?? [];
	const byId = useMemo(() => new Map(coworkers.map((c) => [c.id, c])), [coworkers]);
	const memberIds = snapshot?.huddles.find((h) => h.id === huddleId)?.members ?? [];
	const dmTarget = memberIds.length === 1 ? byId.get(memberIds[0]) : undefined;

	useEffect(() => {
		const node = scrollRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [log.length, working?.current]);

	const submit = async () => {
		const text = draft.trim();
		if (!text || sending) return;
		setDraft("");
		setSending(true);
		try {
			await send(text);
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-2 border-b border-pi-border px-3 py-2">
				<Button variant="ghost" size="xs" onClick={() => useOfficeStore.setState({ openHuddleId: null })}>
					← Roster
				</Button>
				<span className="min-w-0 flex-1 truncate text-xs font-semibold text-pi-text">
					{dmTarget ? dmTarget.name : snapshot?.huddles.find((h) => h.id === huddleId)?.name}
				</span>
				{working && (
					<span className="flex items-center gap-1 text-2xs text-pi-text-muted">
						<Loader2 className="h-3 w-3 animate-spin" />
						{working.current ? `${working.current} is working…` : "working…"}
					</span>
				)}
				{working && (
					<Button variant="ghost" size="xs" icon={Square} onClick={() => void stop()}>
						Stop
					</Button>
				)}
			</div>

			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-2">
				{log.length === 0 && (
					<div className="px-4 py-8 text-center text-2xs text-pi-text-faint">
						{dmTarget
							? `Message ${dmTarget.name} — your DM history lives in their own session.`
							: "Say something to get the huddle going."}
					</div>
				)}
				{log.map((message) => (
					<MessageBubble
						key={message.id}
						message={message}
						coworker={message.from.id ? byId.get(message.from.id) : undefined}
					/>
				))}
			</div>

			<div className="border-t border-pi-border p-2">
				<div className="flex items-end gap-1.5">
					<textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void submit();
							}
						}}
						placeholder={dmTarget ? `Message @${dmTarget.handle}…` : "Message the huddle… (@handle to address someone)"}
						rows={2}
						className="max-h-28 w-full resize-none rounded-md bg-pi-surface-raised px-2.5 py-1.5 text-xs text-pi-text shadow-ring transition-smooth placeholder:text-pi-text-faint focus:shadow-focus focus:outline-none"
					/>
					<Button
						variant="primary"
						size="icon-sm"
						icon={Send}
						aria-label="Send"
						disabled={!draft.trim() || sending}
						onClick={() => void submit()}
					/>
				</div>
				{coworkers.length > 0 && !dmTarget && (
					<div className="mt-1.5 flex flex-wrap gap-1">
						{coworkers
							.filter((c) => memberIds.includes(c.id))
							.map((c) => (
								<button
									key={c.id}
									type="button"
									onClick={() => setDraft((d) => `${d}${d.endsWith(" ") || d === "" ? "" : " "}@${c.handle} `)}
									className="rounded-full bg-pi-surface-raised px-2 py-0.5 text-2xs text-pi-text-muted shadow-ring transition-hover hover:text-pi-text active-press"
								>
									@{c.handle}
								</button>
							))}
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
	const [coworkerEditor, setCoworkerEditor] = useState<{ open: boolean; editing?: OfficeCoworker }>({ open: false });
	const [huddleEditor, setHuddleEditor] = useState<{ open: boolean; editing?: OfficeHuddleSummary }>({ open: false });
	const [errandEditor, setErrandEditor] = useState(false);
	const [floorView, setFloorView] = useState(false);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const coworkers = snapshot?.coworkers ?? [];
	const statuses = snapshot?.statuses ?? {};
	const huddles = snapshot?.huddles ?? [];
	const groupHuddles = huddles.filter((h) => !h.id.startsWith("dm:"));
	const errands = snapshot?.errands ?? [];
	const prompts = snapshot?.pendingPrompts ?? [];
	const coworkerById = useMemo(() => new Map(coworkers.map((c) => [c.id, c])), [coworkers]);

	if (openHuddleId) {
		return (
			<div className="flex h-full flex-col">
				{prompts.map((prompt) => (
					<PromptCard key={prompt.requestId} prompt={prompt} />
				))}
				<HuddleChat huddleId={openHuddleId} />
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
						onClick={() => setFloorView((v) => !v)}
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

			{error && (
				<div className="px-3 py-2 text-2xs text-pi-error">
					{error}{" "}
					<button type="button" className="underline" onClick={() => void refresh()}>
						retry
					</button>
				</div>
			)}

			{floorView ? (
				<div className="min-h-0 flex-1">
					<FloorView />
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

				<SectionHeader label="Coworkers" />
				{coworkers.length === 0 && (
					<div className="px-1.5 py-2 text-2xs leading-relaxed text-pi-text-faint">
						No coworkers yet. Hire one — give it a name, a role, and a face.
					</div>
				)}
				{coworkers.map((coworker) => {
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
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Edit ${coworker.name}`}
										icon={Pencil}
										onClick={() => setCoworkerEditor({ open: true, editing: coworker })}
									/>
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
						age={relativeTime(huddle.lastActive)}
						face={
							<span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-pi-surface-raised">
								<Users className="h-3 w-3 text-pi-text-muted" />
							</span>
						}
						onClick={() => void openHuddle(huddle.id)}
						actions={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Edit ${huddle.name}`}
								icon={Pencil}
								onClick={() => setHuddleEditor({ open: true, editing: huddle })}
							/>
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
								</div>
							</div>
							<Button
								variant="ghost"
								size="xs"
								icon={Bot}
								aria-label="Run now"
									onClick={() => void officeRunErrand(errand.id)}
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
		</div>
	);
}
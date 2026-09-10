import { Search, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as rpc from "../lib/rpc";
import { useRuntimeStatusStore } from "../stores/runtime-status-store";
import { pickLoadingVerb } from "../lib/loading-verbs";
import { useSessionStore } from "../stores/session-store";
import { useTabsStore } from "../stores/tabs-store";
import { toast } from "../stores/toast-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { triggerHaptic } from "../lib/haptics";

/** Sessions shown before the list is capped (the full history lives behind the
 *  ⌘P picker). */
const MAX_ROWS = 50;

function relativeTime(iso: string): string {
	const d = new Date(iso).getTime();
	if (!Number.isFinite(d)) return "";
	const diffMs = Date.now() - d;
	const mins = Math.floor(diffMs / 60000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	if (days < 30) return `${Math.floor(days / 7)}w`;
	return `${Math.floor(days / 30)}mo`;
}

function sessionTitle(s: rpc.RpcSessionInfo): string {
	const name = s.name?.trim();
	if (name) return name;
	const preview = s.firstMessage.trim().replace(/\s+/g, " ");
	return preview ? (preview.length > 60 ? `${preview.slice(0, 60)}…` : preview) : "Untitled session";
}

function cwdLeaf(cwd: string): string {
	return cwd.split(/[/\\]/).filter(Boolean).at(-1) ?? cwd;
}

/** Calendar-day buckets for the list, Hermes-rail style: the newest group is
 *  "Today", then "Yesterday", "This week" (last 7 days), everything older is
 *  "Earlier". Empty groups are skipped. */
type DateGroup = { label: string; sessions: rpc.RpcSessionInfo[] };

function groupByDate(sessions: rpc.RpcSessionInfo[], now = new Date()): DateGroup[] {
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startOfYesterday = startOfToday - 86_400_000;
	const weekAgo = startOfToday - 6 * 86_400_000;
	const groups: DateGroup[] = [
		{ label: "Today", sessions: [] },
		{ label: "Yesterday", sessions: [] },
		{ label: "Previous 7 days", sessions: [] },
		{ label: "Earlier", sessions: [] },
	];
	for (const s of sessions) {
		const t = new Date(s.modified).getTime();
		if (!Number.isFinite(t)) {
			groups[3]!.sessions.push(s);
		} else if (t >= startOfToday) {
			groups[0]!.sessions.push(s);
		} else if (t >= startOfYesterday) {
			groups[1]!.sessions.push(s);
		} else if (t >= weekAgo) {
			groups[2]!.sessions.push(s);
		} else {
			groups[3]!.sessions.push(s);
		}
	}
	return groups.filter((g) => g.sessions.length > 0);
}

/** Row status dot: what the session needs from the user right now, mirroring
 *  the tab strip's badges — blocked-on-input (amber, pulsing) > turn running
 *  (accent, pulsing) > finished-while-away (green) > quiet (grey). */
function SessionDot({ path }: { path: string }) {
	const needsInput = useRuntimeStatusStore((s) => s.needsInput[path]);
	const running = useRuntimeStatusStore((s) => s.running[path]);
	const finished = useRuntimeStatusStore((s) => s.finishedWhileAway[path]);

	if (needsInput) {
		return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-pi-warning" aria-label="needs your input" />;
	}
	if (running) {
		return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-pi-accent" aria-label="running" />;
	}
	if (finished) {
		return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-success" aria-label="turn finished" />;
	}
	return <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-pi-border-strong/60" aria-hidden />;
}

/**
 * Persistent session rail for the left sidebar — every stored session in the
 * profile with a status dot (blocked / running / finished-unread / idle),
 * readable titles (user-set name → first user message), recency grouping, and
 * type-to-filter. Click resumes (same switch path as the tab strip). The
 * modal picker (⌘P) remains the keyboard-driven "resume any session" surface;
 * this list is the at-a-glance "what sessions exist and what are they doing"
 * answer.
 */
export function SessionList() {
	const [sessions, setSessions] = useState<rpc.RpcSessionInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [pendingPath, setPendingPath] = useState<string | null>(null);
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const activePath = useTabsStore((s) => s.activePath);
	const workspaceCurrent = useWorkspaceStore((s) => s.current);

	const refetch = async () => {
		try {
			const res = await rpc.listSessions();
			setSessions(res.sessions ?? []);
		} catch {
			/* engine restarting or unreachable — keep the stale list */
		} finally {
			setLoading(false);
		}
	};

	// Refresh on mount, whenever the active session changes (covers new
	// sessions + renames riding a session_start), and on window focus. A slow
	// interval keeps modified-time/message-count fresh without polling per
	// status tick.
	useEffect(() => {
		void refetch();
	}, [sessionFile, workspaceCurrent]);

	useEffect(() => {
		const onFocus = () => void refetch();
		window.addEventListener("focus", onFocus);
		const interval = window.setInterval(() => void refetch(), 30_000);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.clearInterval(interval);
		};
	}, []);

	// A turn just ended: session metadata (modified, messageCount) changed.
	const wasStreaming = useRef(isStreaming);
	useEffect(() => {
		if (wasStreaming.current && !isStreaming) void refetch();
		wasStreaming.current = isStreaming;
	}, [isStreaming]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const sorted = [...sessions].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
		if (!q) return sorted.slice(0, MAX_ROWS);
		return sorted
			.filter((s) => {
				const hay = `${sessionTitle(s)} ${s.firstMessage} ${s.cwd}`.toLowerCase();
				return hay.includes(q);
			})
			.slice(0, MAX_ROWS);
	}, [sessions, query]);

	const groups = useMemo(() => (query.trim() ? [{ label: "Results", sessions: filtered }] : groupByDate(filtered)), [filtered, query]);

	const switchTo = async (path: string) => {
		if (path === activePath || pendingPath) return;
		setPendingPath(path);
		try {
			useTabsStore.getState().setActive(path);
			const result = await rpc.switchSession(path);
			if (result.reattached && result.snapshot?.running) {
				const store = useSessionStore.getState();
				if (!store.isStreaming) {
					store.setIsStreaming(true);
					store.setStreamingVerb(pickLoadingVerb());
				}
			}
		} catch (e) {
			useTabsStore.getState().setActive(activePath ?? "");
			toast.error("Failed to switch session", e instanceof Error ? e.message : String(e));
		} finally {
			setPendingPath((current) => (current === path ? null : current));
		}
	};

	const startNew = async () => {
		try {
			triggerHaptic("selection");
			await rpc.sendCommand({ type: "new_session" });
		} catch (e) {
			toast.error("Failed to start new session", e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<div>
			{/* Search + new session */}
			<div className="flex items-center gap-1 px-1 pb-1.5">
				<div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent bg-pi-surface-overlay/60 px-2 py-1 transition-hover focus-within:border-pi-border">
					<Search className="h-3 w-3 shrink-0 text-pi-text-faint" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Filter sessions…"
						className="min-w-0 flex-1 bg-transparent text-2xs text-pi-text placeholder:text-pi-text-faint focus:outline-none"
						aria-label="Filter sessions"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-pi-text-faint transition-hover hover:text-pi-text"
							aria-label="Clear filter"
						>
							<X className="h-2.5 w-2.5" />
						</button>
					)}
				</div>
				<button
					type="button"
					onClick={() => void startNew()}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					aria-label="New session"
					title="New session"
				>
					<Plus className="h-3.5 w-3.5" />
				</button>
			</div>

			{loading ? (
				<p className="px-2.5 py-2 text-2xs text-pi-text-faint">Loading sessions…</p>
			) : groups.length === 0 ? (
				<p className="px-2.5 py-2 text-2xs text-pi-text-faint">
					{sessions.length === 0 ? "No sessions yet." : "No matches."}
				</p>
			) : (
				groups.map((group) => (
					<div key={group.label} className="mb-1.5">
						<div className="px-2.5 pb-0.5 pt-1 text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
							{group.label}
						</div>
						<div className="space-y-0.5">
							{group.sessions.map((s) => (
								<SessionRow
									key={s.path}
									session={s}
									current={s.path === sessionFile}
									openInTab={s.path === activePath}
									workspaceLeaf={workspaceCurrent ? cwdLeaf(workspaceCurrent) : ""}
									pending={pendingPath === s.path}
									streaming={s.path === activePath && isStreaming}
									onResume={() => void switchTo(s.path)}
								/>
							))}
						</div>
					</div>
				))
			)}
			{!query && sessions.length > MAX_ROWS && (
				<p className="px-2.5 pt-1 text-3xs text-pi-text-faint">
					+{sessions.length - MAX_ROWS} older — search all with ⌘P
				</p>
			)}
		</div>
	);
}

interface SessionRowProps {
	session: rpc.RpcSessionInfo;
	current: boolean;
	openInTab: boolean;
	/** Leaf name of the current workspace, for tagging cross-project sessions. */
	workspaceLeaf: string;
	pending: boolean;
	streaming: boolean;
	onResume: () => void;
}

function SessionRow({ session, current, openInTab, workspaceLeaf, pending, streaming, onResume }: SessionRowProps) {
	const title = sessionTitle(session);
	const projectLeaf = workspaceLeaf && cwdLeaf(session.cwd) !== workspaceLeaf ? cwdLeaf(session.cwd) : null;

	return (
		<button
			type="button"
			onClick={onResume}
			disabled={pending}
			title={session.firstMessage.trim() || undefined}
			className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none ${
				current ? "bg-pi-accent-soft" : openInTab ? "hover:bg-pi-surface-raised/70" : "hover:bg-pi-surface-raised"
			} ${pending ? "opacity-60" : ""}`}
		>
			<SessionDot path={session.path} />
				<span className="flex min-w-0 flex-1 flex-col leading-snug">
					<span
						className={`truncate text-xs ${current ? "font-medium text-pi-accent" : "text-pi-text"} ${
							title === "Untitled session" ? "italic text-pi-text-faint" : ""
						}`}
					>
						{title}
					</span>
					{projectLeaf && (
						<span className="truncate font-mono text-3xs text-pi-text-faint">{projectLeaf}</span>
					)}
				</span>
				{streaming && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-pi-accent" aria-label="streaming" />}
				<span className="shrink-0 font-mono pi-tabular text-3xs text-pi-text-faint">
					{session.messageCount > 0 ? `${session.messageCount}m · ` : ""}
					{relativeTime(session.modified)}
				</span>
			</button>
	);
}
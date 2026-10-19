import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, MoreHorizontal, Pencil, Pin, PinOff, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import * as rpc from "../lib/rpc";
import { useRuntimeStatusStore } from "../stores/runtime-status-store";
import { pickLoadingVerb } from "../lib/loading-verbs";
import { useSessionStore } from "../stores/session-store";
import { useTabsStore } from "../stores/tabs-store";
import { toast } from "../stores/toast-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { runSwitch } from "../lib/session-switch";
import { triggerHaptic } from "../lib/haptics";
import { adoptSwitchResult } from "../lib/adopt-session";
import { readPinnedSessions, togglePin } from "../lib/session-pins";
import { sessionJsonlToMarkdown } from "../lib/session-export";
import { confirm } from "../stores/confirm-store";
import { SearchField } from "./ui/SearchField";
import {
	DEFAULT_SESSION_LIST_PREFS,
	readSessionListPrefs,
	SESSION_LIST_DENSITIES,
	SESSION_META_ITEMS,
	type SessionListPrefs,
	writeSessionListPrefs,
} from "../lib/session-list-prefs";
import { Tip } from "./ui/Tip";

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

function compactNumber(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
	return String(value);
}

function costLabel(value: number | undefined): string | null {
	if (!value || value < 0.0001) return null;
	return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function modelLabel(model: string | undefined): string | null {
	const leaf = model?.split("/").at(-1)?.trim();
	return leaf || null;
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

interface MenuAnchor {
	path: string;
	top: number;
	left: number;
}

/**
 * Persistent session rail for the left sidebar — every stored session in the
 * profile with a status dot (blocked / running / finished-unread / idle),
 * readable titles (user-set name → first user message), recency grouping, and
 * type-to-filter. Click resumes (same switch path as the tab strip). Keyboard:
 * ↑/↓ move between rows, Enter resumes, F2 renames, Delete asks to delete.
 * The modal picker (⌘P) remains the keyboard-driven "resume any session"
 * surface; this list is the at-a-glance "what sessions exist and what are they
 * doing" answer.
 */
export function SessionList() {
	const [sessions, setSessions] = useState<rpc.RpcSessionInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [pendingPath, setPendingPath] = useState<string | null>(null);
	const [pins, setPins] = useState<string[]>(() => readPinnedSessions());
	const [editingPath, setEditingPath] = useState<string | null>(null);
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	const [prefs, setPrefs] = useState<SessionListPrefs>(() => readSessionListPrefs());
	const [viewMenu, setViewMenu] = useState<{ top: number; left: number } | null>(null);
	const viewButtonRef = useRef<HTMLButtonElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const activePath = useTabsStore((s) => s.activePath);
	const workspaceCurrent = useWorkspaceStore((s) => s.current);

	const refetch = async () => {
		try {
			const res = await rpc.listSessions(50);
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
		const onChanged = () => void refetch();
		window.addEventListener("focus", onFocus);
		window.addEventListener("a-coder:sessions-changed", onChanged);
		const interval = window.setInterval(() => void refetch(), 120_000);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("a-coder:sessions-changed", onChanged);
			window.clearInterval(interval);
		};
	}, []);

	// A turn just ended: session metadata (modified, messageCount) changed.
	const wasStreaming = useRef(isStreaming);
	useEffect(() => {
		if (wasStreaming.current && !isStreaming) void refetch();
		wasStreaming.current = isStreaming;
	}, [isStreaming]);

	// A menu anchored to a row must not survive scrolling or resizing — its
	// fixed coordinates would point at the wrong row.
	useEffect(() => {
		if (!menu) return;
		const close = () => {
			setMenu(null);
		};
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		return () => {
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
		};
	}, [menu]);

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

	const groups = useMemo(() => {
		if (query.trim()) return [{ label: "Results", sessions: filtered }];
		const pinned = filtered.filter((s) => pins.includes(s.path));
		const rest = filtered.filter((s) => !pins.includes(s.path));
		const dateGroups = groupByDate(rest);
		return pinned.length > 0 ? [{ label: "Pinned", sessions: pinned }, ...dateGroups] : dateGroups;
	}, [filtered, query, pins]);

	const switchTo = useCallback(
		async (path: string) => {
			if (path === activePath || pendingPath) return;
			setPendingPath(path);
			try {
				useTabsStore.getState().setActive(path);
				const result = await runSwitch(path);
				adoptSwitchResult(result);
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
		},
		[activePath, pendingPath],
	);

	const startNew = async () => {
		try {
			triggerHaptic("selection");
			await rpc.sendCommand({ type: "new_session" });
		} catch (e) {
			toast.error("Failed to start new session", e instanceof Error ? e.message : String(e));
		}
	};

	const togglePinned = (path: string) => {
		const next = togglePin(path);
		setPins(next);
	};

	const renameSession = async (path: string, name: string) => {
		const trimmed = name.trim();
		setEditingPath(null);
		if (!trimmed) return;
		try {
			await rpc.sendCommand({ type: "rename_session", sessionPath: path, name: trimmed });
			await refetch();
		} catch (e) {
			toast.error("Failed to rename session", e instanceof Error ? e.message : String(e));
		}
	};

	const deleteSession = async (path: string) => {
		try {
			await rpc.sendCommand({ type: "delete_session", sessionPath: path });
			setMenu(null);
			setPins((current) => current.filter((p) => p !== path));
			await refetch();
			toast.success("Session deleted", "Moved to the sessions trash folder.");
		} catch (e) {
			toast.error("Failed to delete session", e instanceof Error ? e.message : String(e));
		}
	};

	const copyTranscript = async (session: rpc.RpcSessionInfo) => {
		setMenu(null);
		try {
			const raw = await invoke<string>("read_text_file", { path: session.path });
			const { markdown, messageCount } = sessionJsonlToMarkdown(raw);
			await navigator.clipboard.writeText(markdown);
			toast.success("Transcript copied", `${messageCount} messages as Markdown.`);
		} catch (e) {
			toast.error("Failed to copy transcript", e instanceof Error ? e.message : String(e));
		}
	};

	// Roving focus across rows: browser-native tab order would stop on every
	// row plus its menu button, which makes arrow keys the only sane way to
	// sweep a 50-row list.
	const moveFocus = (direction: 1 | -1) => {
		const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-session-row]") ?? []);
		if (rows.length === 0) return;
		const index = rows.indexOf(document.activeElement as HTMLElement);
		const next = index === -1 ? (direction === 1 ? 0 : rows.length - 1) : index + direction;
		rows[Math.min(Math.max(next, 0), rows.length - 1)]?.focus();
	};

	const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			moveFocus(1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			moveFocus(-1);
		} else if (e.key === "Home") {
			e.preventDefault();
			listRef.current?.querySelector<HTMLElement>("[data-session-row]")?.focus();
		} else if (e.key === "End") {
			e.preventDefault();
			const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-session-row]");
			rows?.[rows.length - 1]?.focus();
		}
	};

	const menuSession = menu ? sessions.find((s) => s.path === menu.path) : undefined;

	return (
		<div>
			{/* Search + view options + new session */}
			<div className="sticky top-0 z-10 -mx-1 flex items-center gap-1 bg-pi-surface/95 px-1 pb-1.5 pt-1 backdrop-blur">
				<SearchField
					value={query}
					onChange={setQuery}
					placeholder="Filter sessions…"
					ariaLabel="Filter sessions"
					onSubmit={() => moveFocus(1)}
					className="min-w-0 flex-1"
				/>
				<Tip content="Session list view" placement="toolbar">
					<button
						ref={viewButtonRef}
						type="button"
						onClick={() => {
							const rect = viewButtonRef.current?.getBoundingClientRect();
							if (!rect) return;
							setViewMenu(
								viewMenu
									? null
									: {
											top: rect.bottom + 4,
											left: Math.max(8, rect.right - 216),
										},
							);
						}}
						className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none ${viewMenu ? "bg-pi-surface-raised text-pi-text" : "text-pi-text-muted"}`}
						aria-label="Session list view"
						aria-haspopup="menu"
						aria-expanded={Boolean(viewMenu)}
					>
						<SlidersHorizontal className="h-3.5 w-3.5" />
					</button>
				</Tip>
				<Tip content="New session" placement="toolbar">
					<button
						type="button"
						onClick={() => void startNew()}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						aria-label="New session"
					>
						<Plus className="h-3.5 w-3.5" />
					</button>
				</Tip>
			</div>

			{loading ? (
				<p className="px-2.5 py-2 text-2xs text-pi-text-faint">Loading sessions…</p>
			) : groups.length === 0 ? (
				<p className="px-2.5 py-2 text-2xs text-pi-text-faint">
					{sessions.length === 0 ? "No sessions yet." : "No matches."}
				</p>
			) : (
				<div ref={listRef} role="listbox" aria-label="Sessions" onKeyDown={onListKeyDown}>
					{groups.map((group) => (
						<div key={group.label} className="mb-1.5" role="group" aria-label={group.label}>
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
										pinned={pins.includes(s.path)}
										editing={editingPath === s.path}
										density={prefs.density}
										meta={prefs.meta}
										onResume={() => void switchTo(s.path)}
										onStartRename={() => setEditingPath(s.path)}
										onMenu={(top, left) => {
											if (menu?.path === s.path) {
												setMenu(null);
											} else {
												setMenu({ path: s.path, top, left });
											}
										}}
										onCommitRename={(name) => void renameSession(s.path, name)}
										onCancelRename={() => setEditingPath(null)}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}
			{!query && sessions.length > MAX_ROWS && (
				<p className="px-2.5 pt-1 text-3xs text-pi-text-faint">
					+{sessions.length - MAX_ROWS} older — search all with ⌘P
				</p>
			)}

			{viewMenu && (
				<SessionViewMenu
					anchor={viewMenu}
					prefs={prefs}
					onChange={(next) => {
						setPrefs(next);
						writeSessionListPrefs(next);
					}}
					onClose={() => setViewMenu(null)}
				/>
			)}

			{menu && menuSession && (
				<SessionMenu
					anchor={menu}
					session={menuSession}
					pinned={pins.includes(menuSession.path)}
					active={menuSession.path === activePath}
					onClose={() => setMenu(null)}
					onTogglePin={() => {
						togglePinned(menuSession.path);
						setMenu(null);
					}}
					onRename={() => {
						setMenu(null);
						setEditingPath(menuSession.path);
					}}
					onCopy={() => void copyTranscript(menuSession)}
					onDelete={() => {
						setMenu(null);
						void confirm({
							title: "Delete session?",
							message: `${sessionTitle(menuSession)} is moved to the sessions trash folder — you can restore the file from there.`,
							confirmLabel: "Delete",
							danger: true,
							onConfirm: () => deleteSession(menuSession.path),
						});
					}}
				/>
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
	pinned: boolean;
	editing: boolean;
	density: SessionListPrefs["density"];
	meta: SessionListPrefs["meta"];
	onResume: () => void;
	onStartRename: () => void;
	onMenu: (top: number, left: number) => void;
	onCommitRename: (name: string) => void;
	onCancelRename: () => void;
}

function SessionRow({
	session,
	current,
	openInTab,
	workspaceLeaf,
	pending,
	streaming,
	pinned,
	editing,
	density,
	meta,
	onResume,
	onStartRename,
	onMenu,
	onCommitRename,
	onCancelRename,
}: SessionRowProps) {
	const title = sessionTitle(session);
	const projectLeaf = workspaceLeaf && cwdLeaf(session.cwd) !== workspaceLeaf ? cwdLeaf(session.cwd) : null;
	const preview = session.firstMessage.trim().replace(/\s+/g, " ");
	const showPreview =
		!editing && density !== "compact" && Boolean(session.name?.trim()) && preview.length > 0 && preview !== title;
	const model = meta.includes("model") ? modelLabel(session.model) : null;
	const figures = [
		meta.includes("messages") && session.messageCount > 0 ? `${session.messageCount}m` : null,
		meta.includes("tokens") && session.totalTokens ? `${compactNumber(session.totalTokens)} tok` : null,
		meta.includes("cost") ? costLabel(session.totalCost) : null,
	].filter((value): value is string => Boolean(value));
	const menuButtonRef = useRef<HTMLButtonElement | null>(null);
	const rowRef = useRef<HTMLDivElement | null>(null);
	// Enter commits and unmounts the input, which also fires blur — finish
	// must be idempotent so a rename isn't appended twice (and Escape must
	// not commit the unchanged value on the way out).
	const renameDoneRef = useRef(false);
	const finishRename = (name: string | null) => {
		if (renameDoneRef.current) return;
		renameDoneRef.current = true;
		if (name === null) onCancelRename();
		else onCommitRename(name);
	};

	const openMenu = () => {
		const rect = menuButtonRef.current?.getBoundingClientRect();
		if (rect) onMenu(rect.bottom + 4, Math.max(8, rect.right - 176));
	};

	return (
		<div
			ref={rowRef}
			role="option"
			aria-selected={current}
			data-session-row
			tabIndex={-1}
			onClick={onResume}
			onKeyDown={(e) => {
				if (editing) return;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onResume();
				} else if (e.key === "F2") {
					e.preventDefault();
					onStartRename();
				} else if (e.key === "Delete" || e.key === "Backspace") {
					e.preventDefault();
					openMenu();
				}
			}}
			className={`group flex w-full cursor-pointer items-start gap-2 rounded-md px-2.5 text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none ${
				density === "compact" ? "py-1.5" : "py-2"
			} ${
				current ? "bg-pi-accent-soft" : openInTab ? "hover:bg-pi-surface-raised/70" : "hover:bg-pi-surface-raised"
			} ${pending ? "opacity-60" : ""}`}
		>
			<span className={density === "compact" ? "self-center" : "self-start pt-1"}>
				<SessionDot path={session.path} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1.5">
					{editing ? (
						<input
							autoFocus
							defaultValue={title}
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Enter") {
									e.preventDefault();
									finishRename((e.target as HTMLInputElement).value);
								} else if (e.key === "Escape") {
									e.preventDefault();
									finishRename(null);
								}
							}}
							onBlur={(e) => finishRename(e.target.value)}
							className="min-w-0 flex-1 rounded border border-pi-border bg-pi-surface px-1 py-0.5 text-xs text-pi-text focus:border-pi-accent focus:outline-none"
							aria-label="Session name"
						/>
					) : (
						<span
							className={`min-w-0 flex-1 truncate text-xs ${current ? "font-medium text-pi-accent" : "text-pi-text"} ${
								title === "Untitled session" ? "italic text-pi-text-faint" : ""
							}`}
						>
							{title}
						</span>
					)}
					{density === "compact" && projectLeaf && (
						<span className="shrink-0 truncate font-mono text-3xs text-pi-text-faint">{projectLeaf}</span>
					)}
					{pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-pi-text-faint" aria-label="pinned" />}
					{streaming && (
						<span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-pi-accent" aria-label="streaming" />
					)}
					{density !== "detailed" && figures.length > 0 && (
						<span className="shrink-0 font-mono pi-tabular text-3xs text-pi-text-faint">{figures.join(" · ")}</span>
					)}
					<span className="ml-auto shrink-0 font-mono pi-tabular text-3xs text-pi-text-faint">
						{relativeTime(session.modified)}
					</span>
				</div>
				{showPreview && (
					<div className="truncate pt-0.5 text-3xs leading-snug text-pi-text-faint">{preview}</div>
				)}
				{density === "detailed" && (model || figures.length > 0 || projectLeaf) && (
					<div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-3xs text-pi-text-faint">
						{projectLeaf && <span className="shrink-0">{projectLeaf}</span>}
						{model && <span className="max-w-32 truncate">{model}</span>}
						{figures.length > 0 && <span className="shrink-0">{figures.join(" · ")}</span>}
					</div>
				)}
			</div>
			<Tip content="Session actions" placement="row">
				<button
					ref={menuButtonRef}
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						openMenu();
					}}
					className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-pi-text-faint opacity-0 transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:opacity-100 focus-visible:shadow-focus focus-visible:outline-none group-hover:opacity-100 ${
						density === "compact" ? "self-center" : "mt-0.5 self-start"
					}`}
					aria-label="Session actions"
				>
					<MoreHorizontal className="h-3.5 w-3.5" />
				</button>
			</Tip>
		</div>
	);
}

interface SessionViewMenuProps {
	anchor: { top: number; left: number };
	prefs: SessionListPrefs;
	onChange: (prefs: SessionListPrefs) => void;
	onClose: () => void;
}

function SessionViewMenu({ anchor, prefs, onChange, onClose }: SessionViewMenuProps) {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) onClose();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [onClose]);

	const setDensity = (density: SessionListPrefs["density"]) => onChange({ ...prefs, density });

	const toggleMeta = (id: SessionListPrefs["meta"][number]) => {
		const meta = prefs.meta.includes(id)
			? prefs.meta.filter((value) => value !== id)
			: [...prefs.meta, id];
		onChange({ ...prefs, meta });
	};

	const row =
		"flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-2xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:bg-pi-surface-raised focus-visible:outline-none";

	return (
		<div
			ref={ref}
			role="menu"
			aria-label="Session list view"
			style={{ position: "fixed", top: Math.max(8, anchor.top), left: anchor.left, width: 216, zIndex: 80 }}
			className="rounded-md border border-pi-border bg-pi-surface-overlay p-1 shadow-lg backdrop-blur"
		>
			<div className="px-2 pb-1 pt-0.5 text-4xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
				Row density
			</div>
			{SESSION_LIST_DENSITIES.map((option) => {
				const active = prefs.density === option.id;
				return (
					<button
						key={option.id}
						type="button"
						role="menuitemradio"
						aria-checked={active}
						onClick={() => setDensity(option.id)}
						className={row}
					>
						<Check className={`h-3 w-3 shrink-0 ${active ? "text-pi-accent" : "opacity-0"}`} />
						<span className="flex-1">
							<span className="block font-medium">{option.label}</span>
							<span className="block text-3xs text-pi-text-faint">{option.detail}</span>
						</span>
					</button>
				);
			})}
			<div className="my-1 h-px bg-pi-border" />
			<div className="px-2 pb-1 text-4xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
				Show
			</div>
			{SESSION_META_ITEMS.map((item) => {
				const active = prefs.meta.includes(item.id);
				return (
					<button
						key={item.id}
						type="button"
						role="menuitemcheckbox"
						aria-checked={active}
						onClick={() => toggleMeta(item.id)}
						className={row}
					>
						<Check className={`h-3 w-3 shrink-0 ${active ? "text-pi-accent" : "opacity-0"}`} />
						<span className="flex-1">{item.label}</span>
					</button>
				);
			})}
			<div className="my-1 h-px bg-pi-border" />
			<button
				type="button"
				role="menuitem"
				onClick={() => onChange({ ...DEFAULT_SESSION_LIST_PREFS, meta: [...DEFAULT_SESSION_LIST_PREFS.meta] })}
				className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
			>
				<span className="w-3 shrink-0" />
				Reset view
			</button>
		</div>
	);
}

interface SessionMenuProps {
	anchor: MenuAnchor;
	session: rpc.RpcSessionInfo;
	pinned: boolean;
	active: boolean;
	onClose: () => void;
	onTogglePin: () => void;
	onRename: () => void;
	onCopy: () => void;
	onDelete: () => void;
}

function SessionMenu({
	anchor,
	session,
	pinned,
	active,
	onClose,
	onTogglePin,
	onRename,
	onCopy,
	onDelete,
}: SessionMenuProps) {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [onClose]);

	const item =
		"flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-2xs text-pi-text transition-hover hover:bg-pi-surface-raised focus-visible:bg-pi-surface-raised focus-visible:outline-none";

	return (
		<div
			ref={ref}
			role="menu"
			aria-label={`Actions for ${sessionTitle(session)}`}
			style={{ position: "fixed", top: Math.max(8, anchor.top), left: anchor.left, width: 176, zIndex: 80 }}
			className="rounded-md border border-pi-border bg-pi-surface-overlay p-1 shadow-lg backdrop-blur"
		>
			<button type="button" role="menuitem" className={item} onClick={onRename}>
				<Pencil className="h-3 w-3" /> Rename
			</button>
			<button type="button" role="menuitem" className={item} onClick={onTogglePin}>
				{pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
				{pinned ? "Unpin" : "Pin to top"}
			</button>
			<button type="button" role="menuitem" className={item} onClick={onCopy}>
				<Copy className="h-3 w-3" /> Copy transcript
			</button>
			<div className="my-1 h-px bg-pi-border" />
			<button
				type="button"
				role="menuitem"
				className={`${item} ${active ? "opacity-40" : ""}`}
				onClick={onDelete}
				disabled={active}
			>
				<Trash2 className="h-3 w-3" />
				{active ? "Cannot delete open session" : "Delete session"}
			</button>
		</div>
	);
}

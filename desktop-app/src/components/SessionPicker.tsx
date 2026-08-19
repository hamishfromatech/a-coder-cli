import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MessageCircle, Search, X } from "lucide-react";
import * as rpc from "../lib/rpc";
import { useModalA11y } from "../hooks/useModalA11y";
import { toast } from "../stores/toast-store";

export interface SessionPickerProps {
	onClose: () => void;
	/** Called with the chosen session path; the caller switches the engine. */
	onResume: (sessionPath: string) => void;
}

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
	if (days < 365) return `${Math.floor(days / 30)}mo`;
	return `${Math.floor(days / 365)}y`;
}

function sessionTitle(s: rpc.RpcSessionInfo): string {
	const name = s.name?.trim();
	if (name) return name;
	const preview = s.firstMessage.trim();
	return preview ? preview.slice(0, 80) : "Untitled session";
}

/**
 * Centered, type-to-filter "resume session" overlay — the desktop equivalent of
 * the TUI's `/resume`. Lists every stored session in the profile, filters as
 * you type, and resumes the picked one. Hermes-style: borderless float, keyboard
 * navigation, active row marked with a check.
 */
export function SessionPicker({ onClose, onResume }: SessionPickerProps) {
	const [sessions, setSessions] = useState<rpc.RpcSessionInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [highlight, setHighlight] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const modalRef = useRef<HTMLDivElement>(null);
	useModalA11y(modalRef, true, onClose);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await rpc.listSessions();
				if (!cancelled) setSessions(res.sessions ?? []);
			} catch (e) {
				if (!cancelled) toast.error("Failed to list sessions", e instanceof Error ? e.message : String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const sorted = [...sessions].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
		if (!q) return sorted;
		return sorted.filter((s) => {
			const hay = `${sessionTitle(s)} ${s.firstMessage} ${s.cwd} ${s.id}`.toLowerCase();
			return hay.includes(q);
		});
	}, [sessions, query]);

	useEffect(() => {
		setHighlight(0);
	}, [query]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const pick = (s: rpc.RpcSessionInfo) => {
		onResume(s.path);
		onClose();
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlight((h) => Math.min(filtered.length - 1, h + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlight((h) => Math.max(0, h - 1));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const item = filtered[highlight];
			if (item) pick(item);
		}
	};

	return (
		<div
			ref={modalRef}
			role="dialog"
			aria-modal="true"
			aria-label="Resume session"
			className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[14vh] backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center gap-2 border-b border-pi-border px-3 py-2.5">
					<Search className="h-4 w-4 shrink-0 text-pi-text-faint" />
					<input
						ref={inputRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder="Search sessions…"
						className="flex-1 bg-transparent text-[13px] text-pi-text placeholder:text-pi-text-faint focus:outline-none"
					/>
					<button
						onClick={onClose}
						className="rounded-md p-1 text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="max-h-[min(24rem,60vh)] overflow-auto py-1">
					{loading ? (
						<div className="px-3 py-6 text-center text-xs text-pi-text-faint">Loading sessions…</div>
					) : filtered.length === 0 ? (
						<div className="px-3 py-6 text-center text-xs text-pi-text-faint">
							{sessions.length === 0 ? "No sessions found." : "No matches."}
						</div>
					) : (
						filtered.map((s, i) => {
							const title = sessionTitle(s);
							const active = i === highlight;
							return (
								<button
									key={s.path}
									onClick={() => pick(s)}
									onMouseEnter={() => setHighlight(i)}
									className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none ${
										active ? "bg-pi-accent-soft" : "hover:bg-pi-surface-raised"
									}`}
								>
									<MessageCircle className="h-4 w-4 shrink-0 text-pi-text-faint" />
									<span className="flex min-w-0 flex-1 flex-col leading-snug">
										<span className="truncate text-xs text-pi-text">{title}</span>
										{s.cwd && (
											<span className="truncate font-mono text-3xs text-pi-text-faint">
												{s.cwd.split(/[/\\]/).filter(Boolean).at(-1) ?? s.cwd}
											</span>
										)}
									</span>
									<span className="shrink-0 font-mono pi-tabular text-3xs text-pi-text-faint">
										{s.messageCount}m · {relativeTime(s.modified)}
									</span>
									<Check className={`h-3.5 w-3.5 shrink-0 text-pi-accent ${active ? "opacity-100" : "opacity-0"}`} />
								</button>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
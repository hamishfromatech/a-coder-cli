import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Link2, Loader2, Plug, Search, X } from "lucide-react";
import * as rpc from "../lib/rpc";
import { openExternalLink } from "../lib/external-link";
import { cn } from "../lib/cn";
import { useModalA11y } from "../hooks/useModalA11y";
import { toast } from "../stores/toast-store";
import { IconButton } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface AppsPanelProps {
	open: boolean;
	onClose: () => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";

export function AppsPanel({ open, onClose }: AppsPanelProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	useModalA11y(modalRef, open, onClose);

	const [state, setState] = useState<LoadState>("idle");
	const [apps, setApps] = useState<rpc.ComposioApp[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	/** Toolkit slug currently awaiting sign-in completion (polled). */
	const [pending, setPending] = useState<string | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const refresh = async (): Promise<void> => {
		setState((s) => (s === "ready" ? "ready" : "loading"));
		try {
			const res = await rpc.listComposioApps();
			setApps(res.apps);
			setError(null);
			setState("ready");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setState("error");
		}
	};

	// Load on open; stop polling on close.
	useEffect(() => {
		if (!open) return;
		void refresh();
		return () => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
			setPending(null);
		};
	}, [open]);

	const startPolling = (slug: string): void => {
		if (pollRef.current) clearInterval(pollRef.current);
		const startedAt = Date.now();
		pollRef.current = setInterval(async () => {
			if (Date.now() - startedAt > 120_000) {
				stopPolling();
				setPending(null);
				toast.info("Composio", `Timed out waiting for ${slug}. Re-open Apps to refresh.`);
				return;
			}
			try {
				const res = await rpc.listComposioApps();
				setApps(res.apps);
				const app = res.apps.find((a) => a.slug === slug);
				if (app?.connected) {
					stopPolling();
					setPending(null);
					toast.success("Composio", `Connected ✓ ${app.name}`);
				}
			} catch {
				// Keep polling through transient errors; the timeout above caps it.
			}
		}, 3000);
	};

	const stopPolling = (): void => {
		if (pollRef.current) {
			clearInterval(pollRef.current);
			pollRef.current = null;
		}
	};

	const handleConnect = async (slug: string, name: string): Promise<void> => {
		try {
			const res = await rpc.connectComposioApp(slug);
			if (res.redirectUrl) {
				openExternalLink(res.redirectUrl);
				toast.info("Composio", `Opening sign-in for ${name}…`);
			} else {
				toast.success("Composio", `Connected ✓ ${name}`);
				void refresh();
				return;
			}
			setPending(slug);
			startPolling(slug);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error("Composio", `Connect failed: ${msg}`);
		}
	};

	const handleDisconnect = async (id: string, name: string): Promise<void> => {
		try {
			await rpc.disconnectComposioApp(id);
			toast.success("Composio", `Disconnected ${name}`);
			void refresh();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error("Composio", `Disconnect failed: ${msg}`);
		}
	};

	if (!open) return null;

	const filtered = query.trim()
		? apps.filter((a) => {
				const q = query.trim().toLowerCase();
				return a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q);
			})
		: apps;

	return (
		<ModalBackdrop ref={modalRef} aria-label="Composio apps" onClick={onClose}>
			<ModalPanel className="flex max-w-xl flex-col" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center gap-2 border-b border-pi-border px-4 py-3">
					<Plug className="h-4 w-4 shrink-0 text-pi-accent" />
					<h2 className="flex-1 text-sm font-semibold text-pi-text">Composio Apps</h2>
					<IconButton variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />
				</div>

				<div className="border-b border-pi-border px-4 py-2">
					<div className="flex items-center gap-2 rounded-md border border-pi-border bg-pi-surface px-2.5 py-1.5">
						<Search className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
						<input
							autoFocus
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search apps (e.g. github, slack, notion)…"
							className="min-w-0 flex-1 bg-transparent text-xs text-pi-text outline-none placeholder:text-pi-text-faint"
						/>
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
					{state === "loading" && (
						<div className="flex items-center justify-center gap-2 py-8 text-xs text-pi-text-muted">
							<Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading apps…
						</div>
					)}
					{state === "error" && (
						<div className="flex flex-col items-center gap-1 py-8 text-center">
							<AlertCircle className="h-5 w-5 text-pi-error" />
							<p className="text-xs text-pi-text-muted">{error ?? "Failed to load apps."}</p>
							<button
								type="button"
								onClick={() => void refresh()}
								className="mt-1 text-2xs text-pi-accent hover:underline"
							>
								Retry
							</button>
						</div>
					)}
					{state === "ready" && filtered.length === 0 && (
						<p className="py-8 text-center text-xs text-pi-text-muted">
							{apps.length === 0 ? "No apps available." : "No matches."}
						</p>
					)}
					{state === "ready" &&
						filtered.map((app) => (
							<AppRow
								key={app.slug}
								app={app}
								pending={pending === app.slug}
								onConnect={() => void handleConnect(app.slug, app.name)}
								onDisconnect={() =>
									app.connectedAccountId && void handleDisconnect(app.connectedAccountId, app.name)
								}
							/>
						))}
				</div>

				<div className="border-t border-pi-border px-4 py-2 text-3xs text-pi-text-faint">
					{apps.length > 0 && `${filtered.length}/${apps.length} apps`}
					{apps.length > 0 && " · "}
					<a
						href="https://composio.dev"
						target="_blank"
						rel="noreferrer"
						className="hover:underline"
					>
						composio.dev
					</a>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

function AppRow({
	app,
	pending,
	onConnect,
	onDisconnect,
}: {
	app: rpc.ComposioApp;
	pending: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
}) {
	return (
		<div className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-hover hover:bg-pi-surface-raised/50">
			<span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-pi-border bg-pi-surface">
				{app.logo ? (
					<img src={app.logo} alt="" className="size-full object-contain" />
				) : (
					<Plug className="h-3 w-3 text-pi-text-faint" />
				)}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className="truncate text-xs font-medium text-pi-text">{app.name}</span>
					{app.connected && <Check className="h-3 w-3 shrink-0 text-pi-success" />}
					{pending && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-pi-accent" />}
				</div>
				{app.description && (
					<p className="truncate text-3xs text-pi-text-faint">{app.description}</p>
				)}
			</div>
			{app.connected ? (
				<button
					type="button"
					onClick={onDisconnect}
					className="shrink-0 rounded-md border border-pi-border px-2 py-1 text-3xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised"
				>
					Disconnect
				</button>
			) : (
				<button
					type="button"
					onClick={onConnect}
					disabled={pending}
					className={cn(
						"flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-3xs transition-hover",
						pending
							? "border border-pi-border text-pi-text-faint"
							: "bg-pi-accent text-white hover:opacity-90",
					)}
				>
					{pending ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Link2 className="h-3 w-3" />
					)}
					{pending ? "Connecting" : "Connect"}
				</button>
			)}
		</div>
	);
}
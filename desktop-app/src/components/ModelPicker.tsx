import { useEffect, useMemo, useRef, useState } from "react";
import { Cpu, RefreshCw, Search, X } from "lucide-react";
import type { Api, Model } from "@earendil-works/pi-ai";
import * as rpc from "../lib/rpc";
import { useSessionStore } from "../stores/session-store";
import { IconButton } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../lib/escape-layers";
import { modelKey, readRecentModels, recordRecentModel } from "../lib/model-recents";

type AnyModel = Model<Api>;

export function ModelPicker({
	anchor,
	onClose,
	onSelect,
}: {
	/** Viewport rect of the trigger button; null = fall back to top-center. */
	anchor: DOMRect | null;
	onClose: () => void;
	onSelect: (model: AnyModel) => void;
}) {
	const [models, setModels] = useState<AnyModel[]>([]);
	const [filter, setFilter] = useState("");
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [refreshError, setRefreshError] = useState<string | null>(null);
	const [highlight, setHighlight] = useState(0);
	const [recentKeys, setRecentKeys] = useState(() => readRecentModels());
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const currentModel = useSessionStore((s) => s.model);

	async function loadModels(reload = false) {
		if (reload) {
			setRefreshing(true);
			setRefreshError(null);
			// Explicit refresh: force the engine to re-read models.json and fetch the
			// latest dynamic (Ollama Cloud) models over the network.
			try {
				await rpc.refreshModels();
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				console.error("Model refresh failed:", e);
				setRefreshError(message);
			}
		}
		try {
			// On open (reload=false) this returns the cached list instantly — the
			// engine keeps dynamic models fresh in the background, so the picker
			// never blocks on a network fetch just to open.
			const result = (await rpc.sendCommand({ type: "get_available_models" })) as {
				models?: AnyModel[];
			};
			setModels(result.models ?? []);
		} catch (e) {
			console.error(e);
		} finally {
			setLoading(false);
			if (reload) setRefreshing(false);
		}
	}

	useEffect(() => {
		void loadModels();
		inputRef.current?.focus();

		// Keep the catalog fresh on every open: force a refetch of all providers
		// in the background (the cached list above renders instantly) and update
		// the list when the refresh settles — no manual refresh needed.
		void (async () => {
			try {
				await rpc.refreshModels();
			} catch {
				// Best-effort: the manual refresh button surfaces refresh errors;
				// the automatic on-open refresh stays silent.
				return;
			}
			try {
				const result = (await rpc.sendCommand({ type: "get_available_models" })) as {
					models?: AnyModel[];
				};
				if (result.models) setModels(result.models);
			} catch {
				// best-effort; the initial load already populated the list
			}
		})();
	}, []);

	const filtered = useMemo(() => {
		const q = filter.trim().toLowerCase();
		const matches = models.filter((m) =>
			`${m.provider} ${m.name} ${m.id}`.toLowerCase().includes(q),
		);
		return matches.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
	}, [models, filter]);

	const recentModels = useMemo(() => {
		const byKey = new Map(models.map((model) => [modelKey(model.provider, model.id), model]));
		return recentKeys
			.map((entry) => byKey.get(modelKey(entry.provider, entry.id)))
			.filter((model): model is AnyModel => Boolean(model));
	}, [models, recentKeys]);

	const groups = useMemo(() => {
		const searching = filter.trim().length > 0;
		const recent = searching ? [] : recentModels;
		const recentSet = new Set(recent.map((model) => modelKey(model.provider, model.id)));
		const rest = filtered.filter((model) => !recentSet.has(modelKey(model.provider, model.id)));
		const providers = [...new Set(rest.map((model) => model.provider))];
		return [
			...(recent.length > 0 ? [{ label: "Recent", models: recent, start: 0 }] : []),
			...providers.map((provider) => ({
				label: provider,
				models: rest.filter((model) => model.provider === provider),
				start: 0,
			})),
		].map((group, _index, all) => {
			const start = all
				.slice(0, _index)
				.reduce((total, entry) => total + entry.models.length, 0);
			return { ...group, start };
		});
	}, [filtered, filter, recentModels]);
	const ordered = useMemo(() => groups.flatMap((group) => group.models), [groups]);

	const choose = (model: AnyModel) => {
		setRecentKeys(recordRecentModel(model.provider, model.id));
		onSelect(model);
		onClose();
	};

	useEffect(() => {
		setHighlight(0);
	}, [filter]);

	useEffect(() => {
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.picker); // while mounted
		const handler = (e: KeyboardEvent) => {
			if (e.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.picker)) return;
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setHighlight((h) => Math.min(h + 1, ordered.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setHighlight((h) => Math.max(h - 1, 0));
			} else if (e.key === "Enter" && ordered[highlight]) {
				e.preventDefault();
				choose(ordered[highlight]!);
			}
		};
		window.addEventListener("keydown", handler);
		return () => {
			unregister();
			window.removeEventListener("keydown", handler);
		};
	}, [ordered, highlight, onClose, onSelect]);

	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const active = list.querySelector(`[data-model-idx="${highlight}"]`);
		active?.scrollIntoView({ block: "nearest" });
	}, [highlight]);

	// Anchored dropdown placement: below the trigger, flipped above when the
	// viewport has more room up there; clamped to stay on screen. Computed
	// once at open — the composer doesn't move while it's open.
	const panelStyle = useMemo(() => {
		const width = 480;
		const height = Math.min(0.6 * window.innerHeight, 560);
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const gap = 6;
		if (anchor) {
			const below = anchor.bottom + gap + height <= vh - 8;
			const left = Math.max(8, Math.min(anchor.left - (anchor.width - width) / 2, vw - width - 8));
			if (below) {
				return { left, top: anchor.bottom + gap, width } as const;
			}
			return { left, bottom: vh - anchor.top + gap, width } as const;
		}
		return { left: (vw - width) / 2, top: 60, width } as const;
	}, [anchor]);

	return (
		<div
			className="fixed inset-0 z-40 transition-smooth"
			onClick={onClose}
			onContextMenu={(e) => e.preventDefault()}
			aria-hidden
		>
			<div
				role="dialog"
				aria-modal={false}
				aria-label="Choose a model"
				className="flex max-h-[60vh] flex-col overflow-hidden rounded-xl border border-pi-border-strong bg-pi-surface-overlay shadow-2xl transition-smooth"
				style={panelStyle}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Search header */}
				<div className="flex items-center gap-2 border-b border-pi-border px-3 py-2.5">
					<Search className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
					<input
						ref={inputRef}
						type="text"
						placeholder="Search models…"
						aria-label="Search models"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						className="flex-1 bg-transparent text-[13px] text-pi-text placeholder:text-pi-text-faint focus:outline-none"
					/>
					<IconButton
						variant="ghost"
						size="sm"
						icon={RefreshCw}
						loading={refreshing}
						onClick={() => void loadModels(true)}
						aria-label="Refresh models"

						className={refreshing ? "animate-spin" : ""}
					/>
					<IconButton
						variant="ghost"
						size="sm"
						icon={X}
						onClick={onClose}
						aria-label="Close"

					/>
				</div>

				{/* List */}
						<div
							ref={listRef}
							role="listbox"
							aria-label="Available models"
							aria-activedescendant={`model-option-${highlight}`}
							className="min-h-0 flex-1 overflow-y-auto p-1.5"
				>
					{loading ? (
						<div className="px-3 py-6 text-center text-xs text-pi-text-muted">
							Loading models…
						</div>
					) : refreshError ? (
						<div className="px-3 py-5 text-center text-xs">
							<p className="text-pi-error">
								Couldn’t refresh models. The list below may be outdated.
							</p>
							<p className="mt-1 text-pi-text-muted">{refreshError}</p>
						</div>
					) : ordered.length === 0 ? (
						<div className="px-3 py-6 text-center text-xs text-pi-text-muted">
							No models found.
						</div>
					) : (
						groups.map((group) => (
							<div key={group.label}>
								<div className="sticky top-0 z-10 bg-pi-surface-overlay px-2.5 pb-1 pt-2 text-4xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
									{group.label}
								</div>
								{group.models.map((model, index) => {
									const idx = group.start + index;
									const isActive =
										currentModel?.id === model.id &&
										currentModel?.provider === model.provider;
									const cost =
										model.cost && (model.cost.input > 0 || model.cost.output > 0)
											? `${money(model.cost.input)}/${money(model.cost.output)}`
											: null;
									return (
										<button
											key={`${model.provider}/${model.id}`}
											id={`model-option-${idx}`}
											role="option"
											aria-selected={idx === highlight}
											data-model-idx={idx}
											onClick={() => choose(model)}
											onMouseEnter={() => setHighlight(idx)}
											className={`flex w-full items-center gap-2.5 rounded-pi-md px-2.5 py-2 text-left transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
												idx === highlight
													? "bg-pi-surface-raised"
													: "hover:bg-pi-surface-raised/50"
											}`}
										>
											<Cpu
												className={`h-3.5 w-3.5 shrink-0 ${
													isActive ? "text-pi-accent" : "text-pi-text-muted"
												}`}
											/>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<span className="truncate text-xs font-medium text-pi-text">
														{model.name}
													</span>
													{isActive && (
														<Badge variant="accent" size="sm">active</Badge>
													)}
												</div>
												<div className="mt-0.5 truncate font-mono text-3xs text-pi-text-muted">
													{model.provider} · {compactContext(model.contextWindow)} ctx
													{cost ? ` · $${cost} / Mtok` : " · free"}
												</div>
											</div>
										</button>
									);
								})}
							</div>
						))
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-pi-border bg-pi-surface/40 px-3 py-1.5 text-3xs text-pi-text-faint">
					<div className="flex items-center gap-2">
						<Kbd>↑↓</Kbd>
						<span>navigate</span>
						<Kbd>↵</Kbd>
						<span>select</span>
						<Kbd>esc</Kbd>
						<span>close</span>
					</div>
					<span className="font-mono">
						{ordered.length}/{models.length}
					</span>
				</div>
			</div>
		</div>
	);
}

function compactContext(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
	return String(value);
}

function money(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="rounded-pi-sm border border-pi-border bg-pi-surface-raised px-1 font-mono text-4xs text-pi-text-muted">
			{children}
		</kbd>
	);
}

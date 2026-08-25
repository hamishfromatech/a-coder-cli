import { useEffect, useMemo, useRef, useState } from "react";
import { Cpu, RefreshCw, Search, X } from "lucide-react";
import type { Api, Model } from "@earendil-works/pi-ai";
import * as rpc from "../lib/rpc";
import { useModalA11y } from "../hooks/useModalA11y";
import { useSessionStore } from "../stores/session-store";
import { IconButton } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

type AnyModel = Model<Api>;

export function ModelPicker({
	onClose,
	onSelect,
}: {
	onClose: () => void;
	onSelect: (model: AnyModel) => void;
}) {
	const [models, setModels] = useState<AnyModel[]>([]);
	const [filter, setFilter] = useState("");
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [refreshError, setRefreshError] = useState<string | null>(null);
	const [highlight, setHighlight] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const modalRef = useRef<HTMLDivElement>(null);
	const { model: currentModel } = useSessionStore();
	useModalA11y(modalRef, true, onClose);

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
	}, []);

	// Dynamic (Ollama Cloud) models are fetched in the background on startup; the
	// initial load returns the cached list instantly so the picker never hangs.
	// Re-fetch once shortly after open to pick up any models the background
	// refresh added (e.g. kimi-k2.7-code), without blocking the open.
	useEffect(() => {
		let cancelled = false;
		const t = setTimeout(async () => {
			if (cancelled) return;
			try {
				const result = (await rpc.sendCommand({ type: "get_available_models" })) as {
					models?: AnyModel[];
				};
				if (!cancelled && result.models) setModels(result.models);
			} catch {
				// best-effort; the initial load already populated the list
			}
		}, 1500);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, []);

	const filtered = useMemo(() => {
		const q = filter.toLowerCase();
		return models.filter((m) =>
			`${m.provider} ${m.name} ${m.id}`.toLowerCase().includes(q),
		);
	}, [models, filter]);

	useEffect(() => {
		setHighlight(0);
	}, [filter]);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setHighlight((h) => Math.min(h + 1, filtered.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setHighlight((h) => Math.max(h - 1, 0));
			} else if (e.key === "Enter" && filtered[highlight]) {
				e.preventDefault();
				onSelect(filtered[highlight]);
				onClose();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [filtered, highlight, onClose, onSelect]);

	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const active = list.querySelector(`[data-model-idx="${highlight}"]`);
		active?.scrollIntoView({ block: "nearest" });
	}, [highlight]);

	return (
		<ModalBackdrop
			ref={modalRef}
			aria-label="Choose a model"
			position="top"
			onClick={onClose}
		>
			<ModalPanel
				className="max-w-xl"
				centered={false}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Search header */}
				<div className="flex items-center gap-2 border-b border-pi-border px-3 py-2.5">
					<Search className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
					<input
						ref={inputRef}
						type="text"
						placeholder="Search models…"
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
				<div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1.5">
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
					) : filtered.length === 0 ? (
						<div className="px-3 py-6 text-center text-xs text-pi-text-muted">
							No models found.
						</div>
					) : (
						filtered.map((model, idx) => {
							const isActive =
								currentModel?.id === model.id &&
								currentModel?.provider === model.provider;
							return (
								<button
									key={`${model.provider}/${model.id}`}
										data-model-idx={idx}
									onClick={() => {
										onSelect(model);
										onClose();
									}}
									onMouseEnter={() => setHighlight(idx)}
									className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
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
											{model.provider} · {model.contextWindow.toLocaleString()} ctx
										</div>
									</div>
								</button>
							);
						})
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
						{filtered.length}/{models.length}
					</span>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="rounded border border-pi-border bg-pi-surface-raised px-1 font-mono text-4xs text-pi-text-muted">
			{children}
		</kbd>
	);
}

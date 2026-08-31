import { Check, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as rpc from "../../../lib/rpc";
import { Switch } from "../../ui/Switch";
import { useSettingsStore } from "../../../stores/settings-store";
import {
	persistCliSettings,
} from "../../../stores/settings-store";

interface RawModel {
	id: string;
	name?: string;
	provider: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

interface Props {
	enabled: string[] | undefined;
	onChange: (next: string[]) => void;
}

/**
 * Searchable multi-select over the cli engine's available models.
 * Replaces the raw text-list of `enabledModels` patterns with a checkable grid.
 *
 * Saving writes the list of `provider:id` strings back to settings.json. The
 * cli still treats these as prefixes (so legacy regex-ish values keep working).
 */
export function ModelsPicker({ enabled, onChange }: Props) {
	const [models, setModels] = useState<RawModel[]>([]);
	const [query, setQuery] = useState("");
	const [loadError, setLoadError] = useState<string | null>(null);
	const [showAll, setShowAll] = useState(false);

	// Read once on mount and whenever the engine reconnects. Re-fetch via the
	// /reload flow if the user reopens settings later.
	const refresh = useCallback(() => {
		let cancelled = false;
		setLoadError(null);
		rpc
			.getAvailableModels()
			.then((res) => {
				if (cancelled) return;
				const list = (res?.models ?? []) as RawModel[];
				setModels(list);
			})
			.catch((e) => {
				if (cancelled) return;
				setLoadError(String(e));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(refresh, [refresh]);

	useEffect(() => {
		const onAuthChanged = () => refresh();
		window.addEventListener("a-coder:auth-changed", onAuthChanged);
		return () => window.removeEventListener("a-coder:auth-changed", onAuthChanged);
	}, [refresh]);

	const enabledSet = useMemo(
		() => new Set(enabled ?? []),
		[enabled],
	);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return models;
		return models.filter((m) => {
			return (
				m.id.toLowerCase().includes(q) ||
				(m.name ?? "").toLowerCase().includes(q) ||
				m.provider.toLowerCase().includes(q)
			);
		});
	}, [models, query]);

	const visible = useMemo(() => {
		if (showAll) return filtered;
		return filtered.filter((m) => enabledSet.has(`${m.provider}:${m.id}`));
	}, [filtered, showAll, enabledSet]);

	const toggle = (m: RawModel) => {
		const key = `${m.provider}:${m.id}`;
		const next = new Set(enabledSet);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		const list = Array.from(next).sort();
		onChange(list);
		void persistModels(list);
	};

	const enableAll = () => {
		const list = filtered.map((m) => `${m.provider}:${m.id}`).sort();
		onChange(list);
		void persistModels(list);
	};

	const disableAll = () => {
		onChange([]);
		void persistModels([]);
	};

	async function persistModels(list: string[]) {
		const { cliGlobalSettings } = useSettingsStore.getState();
		const next = { ...cliGlobalSettings, enabledModels: list };
		useSettingsStore.setState({ cliGlobalSettings: next });
		try {
			await persistCliSettings("global", next);
		} catch (e) {
			console.error("Failed to persist enabledModels", e);
		}
	}

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative flex-1 min-w-[180px]">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pi-text-faint transition-smooth" />
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search models…"
						className={`w-full rounded-md bg-pi-surface-raised py-1.5 pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-text-faint shadow-ring transition-smooth focus:shadow-focus focus:outline-none`}
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-pi-text-faint transition-hover active-press hover:text-pi-text`}
						>
							<X className="h-3 w-3" />
						</button>
					)}
				</div>
				<label htmlFor="show-all-models" className="flex cursor-pointer select-none items-center gap-2">
					<Switch
						id="show-all-models"
						size="sm"
						checked={showAll}
						onChange={() => setShowAll(!showAll)}
						ariaLabel="Show all models"
					/>
					<span className="text-2xs text-pi-text-muted">Show all models</span>
				</label>
			</div>

			<div className="flex items-center justify-between text-2xs text-pi-text-muted">
				<span>
					{enabledSet.size} of {models.length} enabled
				</span>
				<div className="flex gap-1">
					<button
						type="button"
						onClick={enableAll}
						className={`rounded px-1.5 py-0.5 text-3xs font-medium transition-hover active-press hover:bg-pi-accent-soft ${
							models.length === 0 ? "opacity-40" : ""
						}`}
					>
						Enable all visible
					</button>
					<button
						type="button"
						onClick={disableAll}
						className={`rounded px-1.5 py-0.5 text-3xs font-medium transition-hover active-press hover:bg-pi-surface-raised ${
							models.length === 0 ? "opacity-40" : ""
						}`}
					>
						Disable all
					</button>
				</div>
			</div>

			{loadError ? (
				<div className="rounded-md bg-pi-error-soft px-3 py-2 text-2xs text-pi-error transition-smooth">
					Couldn't load models: {loadError}
				</div>
			) : visible.length === 0 ? (
				<div className={`rounded-md bg-pi-surface-raised px-3 py-3 text-center text-2xs text-pi-text-muted shadow-ring transition-smooth`}>
					{models.length === 0
						? "No models found. Sign in to a provider first."
						: "No models match your search."}
				</div>
			) : (
				<ul className={`max-h-72 space-y-1 overflow-y-auto rounded-md bg-pi-surface-raised p-1 shadow-ring transition-smooth hover:shadow-card-hover`}>
					{visible.map((m) => {
						const key = `${m.provider}:${m.id}`;
						const enabled = enabledSet.has(key);
						return (
							<li key={key}>
								<button
									type="button"
									onClick={() => toggle(m)}
									className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
										enabled
											? "bg-pi-accent-soft hover:bg-pi-accent-soft"
											: "hover:bg-pi-surface-overlay"
									}`}
								>
									<span
										className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-smooth ${
											enabled
												? "border-pi-accent bg-pi-accent text-white hover:bg-pi-accent-hover"
												: "border-pi-border bg-pi-bg text-transparent group-hover:border-pi-text-faint"
										}`}
									>
										<Check className="h-2.5 w-2.5" />
									</span>
									<div className="min-w-0 flex-1">
										<div className="truncate text-xs font-medium text-pi-text transition-smooth hover:text-pi-text-secondary">
											{m.name ?? m.id}
										</div>
										<div className="truncate font-mono text-3xs text-pi-text-muted">
											{m.provider} · {m.id}
										</div>
									</div>
									{m.reasoning && (
										<span title="Reasoning-capable" className="transition-smooth group-hover:text-pi-accent">
											<Sparkles className="h-3 w-3 text-pi-accent" />
										</span>
									)}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

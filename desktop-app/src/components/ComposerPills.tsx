import { Brain, Check, ChevronDown, ChevronRight, Cpu, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Api, Model } from "@earendil-works/pi-ai";
import * as rpc from "../lib/rpc";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../lib/escape-layers";
import { triggerHaptic } from "../lib/haptics";
import { modelKey, readRecentModels, recordRecentModel } from "../lib/model-recents";
import { useSessionStore } from "../stores/session-store";
import { Tip } from "./ui/Tip";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_OPTIONS: { value: ThinkingLevel; label: string; detail: string }[] = [
	{ value: "off", label: "Off", detail: "No extended reasoning" },
	{ value: "minimal", label: "Minimal", detail: "Quickest reasoning" },
	{ value: "low", label: "Low", detail: "Light reasoning" },
	{ value: "medium", label: "Medium", detail: "Balanced" },
	{ value: "high", label: "High", detail: "Deeper reasoning" },
	{ value: "xhigh", label: "Max", detail: "Most reasoning" },
];

const PILL =
	"flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-3xs font-medium text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none";

/** Model + thinking controls live at the composer, where they apply to the
 *  next turn, instead of occupying permanent width in the app header. */
export function ComposerPills() {
	const { thinkingLevel, setModel, setThinkingLevel } = useSessionStore(
		useShallow((s) => ({
			thinkingLevel: s.thinkingLevel,
			setModel: s.setModel,
			setThinkingLevel: s.setThinkingLevel,
		})),
	);

	const handleCycleModel = async () => {
		triggerHaptic("selection");
		try {
			const res = (await rpc.sendCommand({ type: "cycle_model" })) as {
				model?: { provider: string; id: string; name?: string };
				thinkingLevel?: string;
			} | null;
			if (res?.model) {
				setModel(res.model as never);
				if (res.thinkingLevel) setThinkingLevel(res.thinkingLevel);
			}
		} catch (e) {
			console.error(e);
		}
	};

	const handleSelectModel = async (next: Model<Api>) => {
		setModel(next as never);
		try {
			await rpc.sendCommand({
				type: "set_model",
				provider: next.provider,
				modelId: next.id,
			});
		} catch (e) {
			console.error(e);
		}
	};

	return (
		<div className="flex min-w-0 items-center gap-1">
			<ModelPill
				onSelect={(next) => void handleSelectModel(next)}
				onCycle={() => void handleCycleModel()}
			/>
			<ThinkingPill
				level={(thinkingLevel ?? "off") as ThinkingLevel}
				onChange={(level) => setThinkingLevel(level)}
			/>
		</div>
	);
}

type AnyModel = Model<Api>;

/**
 * Model pill with its own dropdown — the ThinkingPill pattern: popup anchored
 * above the pill in a relative wrapper, closed by outside mousedown + the
 * escape layer, keyboard navigable, check on the active row, search on top.
 */
function ModelPill({
	onSelect,
	onCycle,
}: {
	onSelect: (model: AnyModel) => void;
	onCycle: () => void;
}): ReactNode {
	const [open, setOpen] = useState(false);
	const [models, setModels] = useState<AnyModel[]>([]);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState("");
	const [highlight, setHighlight] = useState(0);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const filterRef = useRef<HTMLInputElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const currentModel = useSessionStore((s) => s.model);

	// Open: load the list (cached → instant; background refresh keeps dynamic
	// providers fresh), focus the search, and arm outside/escape closing.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		setFilter("");
		setHighlight(0);
		void (async () => {
			try {
				const result = (await rpc.sendCommand({ type: "get_available_models" })) as {
					models?: AnyModel[];
				};
				if (!cancelled) setModels(result.models ?? []);
			} catch (e) {
				console.error("Model list failed", e);
			} finally {
				if (!cancelled) setLoading(false);
			}
			try {
				await rpc.refreshModels();
				if (cancelled) return;
				const result = (await rpc.sendCommand({ type: "get_available_models" })) as {
					models?: AnyModel[];
				};
				if (!cancelled && result.models) setModels(result.models);
			} catch {
				// best-effort; the cached list is already shown
			}
		})();
		filterRef.current?.focus();
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.picker);
		const onDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.picker)) return;
			event.preventDefault();
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			cancelled = true;
			unregister();
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const filtered = useMemo(() => {
		const q = filter.trim().toLowerCase();
		const matches = models.filter((m) =>
			`${m.provider} ${m.name} ${m.id}`.toLowerCase().includes(q),
		);
		return matches.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
	}, [models, filter]);

	const recentModels = useMemo(() => {
		const recentKeys = readRecentModels();
		const byKey = new Map(models.map((model) => [modelKey(model.provider, model.id), model]));
		return recentKeys
			.map((entry) => byKey.get(modelKey(entry.provider, entry.id)))
			.filter((model): model is AnyModel => Boolean(model));
	}, [models, filter]);

	// Flat row model: group headers become `start` rows between entries.
	const rows = useMemo(() => {
		const searching = filter.trim().length > 0;
		const recent = searching ? [] : recentModels;
		const recentSet = new Set(recent.map((model) => modelKey(model.provider, model.id)));
		const rest = filtered.filter((model) => !recentSet.has(modelKey(model.provider, model.id)));
		const providers = [...new Set(rest.map((model) => model.provider))];
		const flat: Array<{ model: AnyModel; groupLabel: string; startsGroup: boolean }> = [];
		if (recent.length > 0) {
			flat.push({
				model: recent[0]!,
				groupLabel: "Recent",
				startsGroup: true,
			});
			for (const model of recent.slice(1)) {
				flat.push({ model, groupLabel: "Recent", startsGroup: false });
			}
		}
		for (const provider of providers) {
			const providerModels = rest.filter((model) => model.provider === provider);
			flat.push({ model: providerModels[0]!, groupLabel: provider, startsGroup: true });
			for (const model of providerModels.slice(1)) {
				flat.push({ model, groupLabel: provider, startsGroup: false });
			}
		}
		return flat;
	}, [filtered, filter, recentModels]);

	function choose(model: AnyModel): void {
		setOpen(false);
		recordRecentModel(model.provider, model.id);
		onSelect(model);
	}

	const isActive = (model: AnyModel): boolean =>
		currentModel?.id === model.id && currentModel?.provider === model.provider;

	return (
		<div ref={rootRef} className="relative inline-flex min-w-0 items-stretch overflow-visible rounded-md border border-pi-border bg-pi-surface-raised">
			<Tip content="Change model" placement="control">
				<button
					type="button"
					onClick={() => {
						triggerHaptic("selection");
						setOpen((value) => !value);
					}}
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-label="Change model"
					className="flex h-6 min-w-0 cursor-pointer items-center gap-1 px-1.5 text-3xs font-medium text-pi-text-secondary transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
				>
					<Cpu className="h-3 w-3 shrink-0 text-pi-accent" />
					<span className="max-w-40 truncate">{currentModel?.name ?? "Select model"}</span>
					<ChevronDown
						className={`h-2.5 w-2.5 shrink-0 opacity-60 transition-smooth ${open ? "rotate-180" : ""}`}
					/>
				</button>
			</Tip>
			<Tip content="Cycle model" placement="control">
				<button
					type="button"
					onClick={onCycle}
					aria-label="Cycle model"
					className="flex w-5 cursor-pointer items-center justify-center border-l border-pi-border text-pi-text-muted transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
				>
					<ChevronRight className="h-3 w-3" />
				</button>
			</Tip>
			{open && (
				<div
					role="dialog"
					aria-label="Choose a model"
					className="absolute bottom-full left-0 z-popover mb-1 flex max-h-96 w-64 max-w-[80vw] flex-col overflow-hidden rounded-lg border border-pi-border bg-pi-surface-overlay shadow-overlay"
				>
					<div className="flex items-center gap-2 border-b border-pi-border px-2 py-1.5">
						<Search className="h-3 w-3 shrink-0 text-pi-text-muted" />
						<input
							ref={filterRef}
							type="text"
							placeholder="Search models…"
							aria-label="Search models"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "ArrowDown") {
									e.preventDefault();
									setHighlight((h) => Math.min(h + 1, Math.max(rows.length - 1, 0)));
								} else if (e.key === "ArrowUp") {
									e.preventDefault();
									setHighlight((h) => Math.max(h - 1, 0));
								} else if (e.key === "Enter") {
									e.preventDefault();
									const row = rows[highlight];
									if (row) choose(row.model);
								}
							}}
							className="w-full bg-transparent text-2xs text-pi-text placeholder:text-pi-text-faint focus:outline-none"
						/>
						<RefreshCw className="h-3 w-3 shrink-0 text-pi-text-faint" aria-hidden />
					</div>
					<ModelList
						rows={rows}
						loading={loading && models.length === 0}
						highlight={highlight}
						setHighlight={setHighlight}
						isActive={isActive}
						onChoose={choose}
						listRef={listRef}
					/>
				</div>
			)}
		</div>
	);
}

interface ModelRow {
	model: AnyModel;
	groupLabel: string;
	startsGroup: boolean;
}

interface ModelListProps {
	rows: ModelRow[];
	loading: boolean;
	highlight: number;
	setHighlight: (index: number) => void;
	isActive: (model: AnyModel) => boolean;
	onChoose: (model: AnyModel) => void;
	listRef: React.RefObject<HTMLDivElement | null>;
}

/** Scrolling option list (shared by pill + flyout pickers). */
function ModelList({
	rows,
	loading,
	highlight,
	setHighlight,
	isActive,
	onChoose,
	listRef,
}: ModelListProps): ReactNode {
	useEffect(() => {
		const active = listRef.current?.querySelector(`[data-model-idx="${highlight}"]`);
		active?.scrollIntoView({ block: "nearest" });
	}, [highlight, listRef, rows.length]);

	if (loading) {
		return <div className="px-2.5 py-3 text-2xs text-pi-text-muted">Loading models…</div>;
	}
	if (rows.length === 0) {
		return <div className="px-2.5 py-3 text-2xs text-pi-text-muted">No models found</div>;
	}
	return (
		<div ref={listRef} role="listbox" aria-label="Available models" className="min-h-0 flex-1 overflow-y-auto py-1">
			{rows.map((row, index) => {
				const model = row.model;
				const active = isActive(model);
				const cost =
					model.cost && (model.cost.input > 0 || model.cost.output > 0)
						? `${money(model.cost.input)}/${money(model.cost.output)}`
						: null;
				return (
					<div key={`${model.provider}/${model.id}`}>
						{row.startsGroup && (
							<div className="sticky top-0 z-10 bg-pi-surface-overlay px-2 pb-0.5 pt-1.5 text-4xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
								{row.groupLabel}
							</div>
						)}
						<button
							type="button"
							role="option"
							aria-selected={index === highlight}
							data-model-idx={index}
							onClick={() => onChoose(model)}
							onMouseEnter={() => setHighlight(index)}
							className={`flex w-full items-start gap-2 px-2 py-1.5 text-left transition-hover ${
								index === highlight ? "bg-pi-surface-raised" : "hover:bg-pi-surface-raised"
							}`}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center justify-between gap-2 text-2xs">
									<span className="truncate font-medium text-pi-text">{model.name}</span>
									{active && <Check className="h-3 w-3 shrink-0 text-pi-accent" />}
								</div>
								<div className="mt-0.5 truncate font-mono text-3xs text-pi-text-muted">
									{model.provider} · {compactContext(model.contextWindow)} ctx
									{cost ? ` · $${cost} / Mtok` : " · free"}
								</div>
							</div>
						</button>
					</div>
				);
			})}
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
function ThinkingPill({
	level,
	onChange,
}: {
	level: ThinkingLevel;
	onChange: (level: ThinkingLevel) => void;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.contextMenu);
		const onDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.contextMenu)) return;
			event.preventDefault();
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			unregister();
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const current = THINKING_OPTIONS.find((option) => option.value === level) ?? THINKING_OPTIONS[0]!;

	const select = async (next: ThinkingLevel) => {
		setOpen(false);
		if (next === level) return;
		onChange(next);
		try {
			await rpc.sendCommand({ type: "set_thinking_level", level: next });
		} catch (e) {
			console.error("Failed to set thinking level", e);
		}
	};

	return (
		<div ref={rootRef} className="relative">
			<Tip content={`Thinking: ${current.label}`} placement="control">
				<button
					type="button"
					onClick={() => {
						triggerHaptic("selection");
						setOpen((value) => !value);
					}}
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-label={`Thinking level: ${current.label}`}
					className={PILL}
				>
					<Brain className={`h-3 w-3 shrink-0 ${level === "off" ? "opacity-60" : "text-pi-accent"}`} />
					<span className="max-w-16 truncate">{current.label}</span>
					<ChevronDown className={`h-2.5 w-2.5 shrink-0 opacity-50 transition-smooth ${open ? "rotate-180" : ""}`} />
				</button>
			</Tip>
			{open && (
				<div
					role="listbox"
					aria-label="Thinking level"
					className="absolute bottom-full left-0 z-popover mb-1 w-52 overflow-hidden rounded-lg border border-pi-border bg-pi-surface-overlay py-1 shadow-overlay"
				>
					{THINKING_OPTIONS.map((option) => {
						const active = option.value === level;
						return (
							<button
								key={option.value}
								type="button"
								role="option"
								aria-selected={active}
								onClick={() => void select(option.value)}
								className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none ${active ? "bg-pi-surface-raised" : "hover:bg-pi-surface-raised"}`}
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center justify-between gap-2 text-2xs">
										<span className="font-semibold text-pi-text">{option.label}</span>
										{active && <Check className="h-3 w-3 shrink-0 text-pi-accent" />}
									</div>
									<div className="mt-0.5 text-3xs text-pi-text-muted">{option.detail}</div>
								</div>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

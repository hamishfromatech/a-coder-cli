import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as rpc from "../../../lib/rpc";

interface RawModel {
	id: string;
	name?: string;
	provider: string;
	reasoning?: boolean;
	contextWindow?: number;
}

interface Props {
	provider: string | undefined;
	modelId: string | undefined;
	onUpdateField: (path: string, value: unknown) => void;
}

/**
 * Single grouped dropdown that sets both `defaultProvider` and `defaultModel`
 * at once. Backed by `rpc.getAvailableModels()` so users pick from what the
 * engine actually supports — no typing raw IDs.
 */
export function DefaultModelPicker({
	provider,
	modelId,
	onUpdateField,
}: Props) {
	const [models, setModels] = useState<RawModel[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		let cancelled = false;
		setLoadError(null);
		rpc
			.getAvailableModels()
			.then((res) => {
				if (cancelled) return;
				setModels((res?.models ?? []) as RawModel[]);
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

	const grouped = useMemo(() => {
		const byProvider = new Map<string, RawModel[]>();
		for (const m of models) {
			const list = byProvider.get(m.provider) ?? [];
			list.push(m);
			byProvider.set(m.provider, list);
		}
		// Sort providers alphabetically; sort models within by name.
		const entries = Array.from(byProvider.entries()).sort(([a], [b]) =>
			a.localeCompare(b),
		);
		for (const [, list] of entries) {
			list.sort((a, b) =>
				(a.name ?? a.id).localeCompare(b.name ?? b.id),
			);
		}
		return entries;
	}, [models]);

	const currentValue = provider && modelId ? `${provider}:${modelId}` : "";

	function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
		const value = e.target.value;
		if (!value) return;
		const sep = value.indexOf(":");
		if (sep === -1) return;
		const nextProvider = value.slice(0, sep);
		const nextId = value.slice(sep + 1);
		onUpdateField("defaultProvider", nextProvider);
		onUpdateField("defaultModel", nextId);
	}

	if (loadError) {
		return (
			<div className="rounded-md bg-pi-error-soft px-3 py-2 text-[11.5px] text-pi-error transition-smooth">
				Couldn't load models: {loadError}
			</div>
		);
	}

	if (models.length === 0) {
		return (
			<div className="rounded-md bg-pi-surface-raised px-3 py-2 text-[11.5px] text-pi-text-muted shadow-[0_0_0_1px_var(--pi-border)] transition-smooth">
				Loading models…
			</div>
		);
	}

	// Find the display label of the current selection (if any).
	const currentLabel = (() => {
		if (!provider || !modelId) return "Pick a model…";
		const m = models.find(
			(x) => x.provider === provider && x.id === modelId,
		);
		if (m) return `${provider} · ${m.name ?? m.id}`;
		// The current value isn't in the list — still show it but flag it.
		return `${provider} · ${modelId} (not available)`;
	})();

	return (
		<div className="relative w-72 max-w-full">
			<select
				value={currentValue}
				onChange={handleChange}
				className={`w-full appearance-none rounded-md bg-pi-surface-raised px-3 py-1.5 pr-8 text-[12px] font-medium text-pi-text shadow-[0_0_0_1px_var(--pi-border)] transition-smooth focus:shadow-focus focus:outline-none`}
			>
				{!currentValue && <option value="">{currentLabel}</option>}
				{grouped.map(([prov, list]) => (
					<optgroup key={prov} label={prov}>
						{list.map((m) => {
							const value = `${m.provider}:${m.id}`;
							return (
								<option key={value} value={value}>
									{m.name ?? m.id}
									{m.reasoning ? "  ✦" : ""}
								</option>
							);
						})}
					</optgroup>
				))}
			</select>
			<ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-pi-text-muted transition-smooth" />
		</div>
	);
}

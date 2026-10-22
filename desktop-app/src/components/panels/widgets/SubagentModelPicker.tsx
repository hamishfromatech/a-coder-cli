import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as rpc from "../../../lib/rpc";

interface RawModel {
	id: string;
	name?: string;
	provider: string;
	reasoning?: boolean;
}

interface Props {
	provider: string | undefined;
	modelId: string | undefined;
	onUpdateField: (path: string, value: unknown) => void;
}

/**
 * Default model for delegated subagents. A single grouped picker; the first
 * entry inherits the parent session's model. Per-agent definitions and the
 * spawn_subagent call can still override it.
 */
export function SubagentModelPicker({ provider, modelId, onUpdateField }: Props) {
	const [models, setModels] = useState<RawModel[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		let cancelled = false;
		setLoadError(null);
		rpc
			.getAvailableModels()
			.then((res) => {
				if (!cancelled) setModels((res?.models ?? []) as RawModel[]);
			})
			.catch((error) => {
				if (!cancelled) setLoadError(String(error));
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
		for (const model of models) {
			const list = byProvider.get(model.provider) ?? [];
			list.push(model);
			byProvider.set(model.provider, list);
		}
		const entries = Array.from(byProvider.entries()).sort(([a], [b]) => a.localeCompare(b));
		for (const [, list] of entries) {
			list.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
		}
		return entries;
	}, [models]);

	const currentValue = provider && modelId ? `${provider}:${modelId}` : "";
	const known = models.some((model) => `${model.provider}:${model.id}` === currentValue);
	const currentLabel = (() => {
		if (provider && modelId) {
			const match = models.find((model) => model.provider === provider && model.id === modelId);
			return match ? `${provider} · ${match.name ?? match.id}` : `${provider} · ${modelId}`;
		}
		if (modelId) return modelId;
		if (provider) return provider;
		return "Inherit the session model";
	})();

	const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const value = event.target.value;
		if (!value) {
			onUpdateField("subagentProvider", undefined);
			onUpdateField("subagentModel", undefined);
			return;
		}
		const separator = value.indexOf(":");
		if (separator === -1) return;
		onUpdateField("subagentProvider", value.slice(0, separator));
		onUpdateField("subagentModel", value.slice(separator + 1));
	};

	if (loadError) {
		return (
			<div className="rounded-md bg-pi-error/10 px-3 py-2 text-2xs text-pi-error">
				Couldn't load models: {loadError}
			</div>
		);
	}

	return (
		<div className="relative w-72 max-w-full">
			<select
				value={currentValue}
				onChange={handleChange}
				aria-label="Delegated work model"
				className="w-full appearance-none rounded-md bg-pi-surface-raised px-3 py-1.5 pr-8 text-xs font-medium text-pi-text shadow-ring transition-smooth focus:shadow-focus focus:outline-none"
			>
				<option value="">Inherit the session model</option>
				{currentValue && !known && <option value={currentValue}>{currentLabel} (not available)</option>}
				{grouped.map(([prov, list]) => (
					<optgroup key={prov} label={prov}>
						{list.map((model) => {
							const value = `${model.provider}:${model.id}`;
							return (
								<option key={value} value={value}>
									{model.name ?? model.id}
									{model.reasoning ? "  ✦" : ""}
								</option>
							);
						})}
					</optgroup>
				))}
			</select>
			<ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-pi-text-muted" />
		</div>
	);
}

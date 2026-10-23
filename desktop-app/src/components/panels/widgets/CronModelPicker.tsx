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
	value: string | undefined;
	onUpdateField: (path: string, value: unknown) => void;
}

/**
 * Model for scheduled runs. Blank means the delegated-work model, then the
 * default chat model — never the job session's pinned model. Keeping this
 * explicit prevents a scheduled task from silently spending on a model the
 * user only chose for one interactive session.
 */
export function CronModelPicker({ value, onUpdateField }: Props) {
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

	const currentValue = value?.trim() ?? "";
	const known = models.some((model) => `${model.provider}/${model.id}` === currentValue);
	const currentLabel = (() => {
		if (!currentValue) return "Delegated work model, then default";
		const separator = currentValue.indexOf("/");
		const provider = separator > 0 ? currentValue.slice(0, separator) : undefined;
		const modelId = separator > 0 ? currentValue.slice(separator + 1) : currentValue;
		const match = models.find((model) => model.provider === provider && model.id === modelId);
		return match ? `${provider} · ${match.name ?? match.id}` : currentValue;
	})();

	const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		onUpdateField("cron.model", event.target.value || undefined);
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
				aria-label="Scheduled task model"
				className="w-full appearance-none rounded-md bg-pi-surface-raised px-3 py-1.5 pr-8 text-xs font-medium text-pi-text shadow-ring transition-smooth focus:shadow-focus focus:outline-none"
			>
				<option value="">Delegated work model, then default</option>
				{currentValue && !known && <option value={currentValue}>{currentLabel} (not available)</option>}
				{grouped.map(([provider, list]) => (
					<optgroup key={provider} label={provider}>
						{list.map((model) => {
							const option = `${model.provider}/${model.id}`;
							return (
								<option key={option} value={option}>
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

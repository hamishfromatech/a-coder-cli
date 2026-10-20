import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import * as rpc from "../../../lib/rpc";
import { useSettingsStore } from "../../../stores/settings-store";
import type {
	AutoContinueSettings,
	DecisionModelInfo,
	ResolvedAutoContinueSettings,
} from "../../../lib/settings.types";
import { Button } from "../../ui/Button";
import { Input, Select } from "../../ui/Input";

function modelValue(settings: AutoContinueSettings): string {
	return settings.provider && settings.model ? `${settings.provider}:${settings.model}` : "";
}

function parseModel(value: string): Pick<AutoContinueSettings, "provider" | "model"> {
	const separator = value.indexOf(":");
	if (separator <= 0) return { provider: undefined, model: undefined };
	return { provider: value.slice(0, separator), model: value.slice(separator + 1) };
}

export function AutoContinueSection({ value }: { value: AutoContinueSettings | undefined }) {
	const [models, setModels] = useState<DecisionModelInfo[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const current: AutoContinueSettings = value ?? { mode: "off" };

	async function load(): Promise<void> {
		setLoading(true);
		setError(null);
		try {
			const result = await rpc.getDecisionModels();
			setModels(result.models);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
			setLoaded(true);
		}
	}

	useEffect(() => {
		void load();
		// The settings object is intentionally read once on mount; live changes
		// come from this widget's own writes.
		// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only probe
	}, []);

	function update(patch: AutoContinueSettings): void {
		const next = { ...current, ...patch };
		// The engine owns settings.json; keep the local settings store in sync so
		// the widget re-renders immediately without racing a second file write.
		useSettingsStore.getState().patchCliSettings("global", { autoContinue: next });
		void rpc.setAutoContinueSettings(next).catch((cause: unknown) => {
			setError(cause instanceof Error ? cause.message : String(cause));
		});
	}

	const selectedModel = modelValue(current);
	const mode = current.mode ?? "off";
	const resolved = current as ResolvedAutoContinueSettings;

	return (
		<div className="space-y-3 rounded-lg bg-pi-surface-raised px-3 py-3 shadow-ring">
			<div className="flex items-start gap-2">
				<Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-pi-accent" />
				<div className="min-w-0">
					<p className="text-xs font-medium text-pi-text">Decision model</p>
					<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
						System One models answer typed questions in one fast pass. They do not chat or write code.
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					icon={loading ? Loader2 : RefreshCw}
					loading={loading}
					onClick={() => void load()}
					aria-label="Refresh installed decision models"
					className="ml-auto"
				>
					Refresh
				</Button>
			</div>

			<div className="grid gap-2 sm:grid-cols-2">
				<label className="space-y-1">
					<span className="text-2xs font-medium text-pi-text-muted">Auto-continue</span>
					<Select value={mode} onChange={(event) => update({ mode: event.target.value as AutoContinueSettings["mode"] })}>
						<option value="off">Off (safest)</option>
						<option value="compaction">After compaction</option>
						<option value="smart">Smart (length, compaction, pause)</option>
					</Select>
				</label>

				<label className="space-y-1">
					<span className="text-2xs font-medium text-pi-text-muted">Model</span>
					<Select
						value={selectedModel}
						onChange={(event) => update(parseModel(event.target.value))}
						disabled={mode === "off" || !loaded}
					>
						<option value="">Auto (first available)</option>
						{models.map((model) => (
							<option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>
								{model.provider} / {model.id} · {(model.contextWindow / 1000).toFixed(0)}K
								{model.input.includes("image") ? " · vision" : ""}
							</option>
						))}
					</Select>
				</label>
			</div>

			{mode === "smart" && (
				<div className="grid gap-2 sm:grid-cols-3">
					<label className="space-y-1">
						<span className="text-2xs font-medium text-pi-text-muted">Continue probability</span>
						<Input
							type="number"
							min={0.5}
							max={1}
							step={0.05}
							value={resolved.minContinueProbability ?? 0.7}
							onChange={(event) => update({ minContinueProbability: Number(event.target.value) })}
						/>
					</label>
					<label className="space-y-1">
						<span className="text-2xs font-medium text-pi-text-muted">Progress probability</span>
						<Input
							type="number"
							min={0.3}
							max={1}
							step={0.05}
							value={resolved.minProgressProbability ?? 0.55}
							onChange={(event) => update({ minProgressProbability: Number(event.target.value) })}
						/>
					</label>
					<label className="space-y-1">
						<span className="text-2xs font-medium text-pi-text-muted">Max continuations</span>
						<Input
							type="number"
							min={0}
							max={5}
							step={1}
							value={resolved.maxConsecutive ?? 2}
							onChange={(event) => update({ maxConsecutive: Number(event.target.value) })}
						/>
					</label>
				</div>
			)}

			{error && <p className="break-all text-2xs text-pi-error">{error}</p>}
			{!loading && models.length === 0 && mode !== "off" && (
				<p className="text-2xs text-pi-text-faint">
					No installed decision models found. Pull one with <code>ollama pull nimble-v3</code> or configure a cloud
					decision provider.
				</p>
			)}
		</div>
	);
}

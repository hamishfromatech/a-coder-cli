import { RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as rpc from "../../../lib/rpc";
import type { LlamaCppModelStatus, LlamaCppStatus } from "../../../lib/rpc";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Switch } from "../../ui/Switch";

type SamplingKey =
	| "temperature"
	| "top_p"
	| "top_k"
	| "min_p"
	| "repeat_penalty"
	| "presence_penalty"
	| "frequency_penalty"
	| "seed";

type SamplingParams = Partial<Record<SamplingKey, number>>;

interface ModelOverride {
	samplingParams?: SamplingParams;
	[key: string]: unknown;
}

interface LlamaProviderConfig {
	samplingParams?: SamplingParams;
	modelOverrides?: Record<string, ModelOverride>;
	[key: string]: unknown;
}

interface ModelsFile {
	providers?: Record<string, LlamaProviderConfig>;
	[key: string]: unknown;
}

const SAMPLING_FIELDS: Array<{
	key: SamplingKey;
	label: string;
	hint: string;
	min?: number;
	max?: number;
	step?: number;
}> = [
	{ key: "temperature", label: "Temperature", hint: "Higher is more random. llama.cpp default 0.8.", min: 0, max: 5, step: 0.05 },
	{ key: "top_p", label: "Top P", hint: "Nucleus sampling cutoff. Default 0.95.", min: 0, max: 1, step: 0.01 },
	{ key: "top_k", label: "Top K", hint: "Keep the K most likely tokens. 0 disables. Default 40.", min: 0, step: 1 },
	{ key: "min_p", label: "Min P", hint: "Relative probability floor. Default 0.05.", min: 0, max: 1, step: 0.01 },
	{ key: "repeat_penalty", label: "Repeat penalty", hint: "Penalize repeated tokens. Default 1.0.", min: 0, step: 0.01 },
	{ key: "presence_penalty", label: "Presence penalty", hint: "Penalize tokens already present. Default 0.", min: -2, max: 2, step: 0.05 },
	{ key: "frequency_penalty", label: "Frequency penalty", hint: "Penalize by occurrence count. Default 0.", min: -2, max: 2, step: 0.05 },
	{ key: "seed", label: "Seed", hint: "Blank uses the server default (random).", step: 1 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLlamaProvider(file: ModelsFile): LlamaProviderConfig {
	const provider = file.providers?.["llama-cpp"];
	return isRecord(provider) ? provider : {};
}

function compactSampling(value: SamplingParams | undefined): SamplingParams | undefined {
	if (!value) return undefined;
	const entries = Object.entries(value).filter(([, v]) => typeof v === "number" && Number.isFinite(v));
	return entries.length > 0 ? (Object.fromEntries(entries) as SamplingParams) : undefined;
}

function mergeSampling(base: SamplingParams | undefined, patch: SamplingParams): SamplingParams {
	const merged = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (typeof value === "number" && Number.isFinite(value)) {
			merged[key as SamplingKey] = value;
		} else {
			delete merged[key as SamplingKey];
		}
	}
	return merged;
}

function withLlamaProvider(file: ModelsFile, provider: LlamaProviderConfig): ModelsFile {
	const providers = { ...(file.providers ?? {}) };
	const cleaned: LlamaProviderConfig = { ...provider };
	cleaned.samplingParams = compactSampling(cleaned.samplingParams);
	if (!cleaned.samplingParams) delete cleaned.samplingParams;

	const overrides = cleaned.modelOverrides ? { ...cleaned.modelOverrides } : undefined;
	if (overrides) {
		for (const [modelId, override] of Object.entries(overrides)) {
			const next = { ...override };
			next.samplingParams = compactSampling(next.samplingParams);
			if (!next.samplingParams) delete next.samplingParams;
			if (Object.keys(next).length === 0) {
				delete overrides[modelId];
			} else {
				overrides[modelId] = next;
			}
		}
		if (Object.keys(overrides).length === 0) delete cleaned.modelOverrides;
		else cleaned.modelOverrides = overrides;
	}

	if (Object.keys(cleaned).length === 0) {
		delete providers["llama-cpp"];
	} else {
		providers["llama-cpp"] = cleaned;
	}
	return { ...file, providers };
}

export function LlamaCppSection() {
	const [status, setStatus] = useState<LlamaCppStatus | null>(null);
	const [file, setFile] = useState<ModelsFile>({ providers: {} });
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);

	const load = useCallback(async (refresh = false) => {
		setLoading(true);
		setError(null);
		try {
			if (refresh) {
				await rpc.refreshModels().catch(() => {});
			}
			const [nextStatus, nextFile] = await Promise.all([
				rpc.getLlamaCppStatus(),
				rpc.readModelsFile() as Promise<ModelsFile>,
			]);
			setStatus(nextStatus);
			setFile(nextFile ?? { providers: {} });
			setDirty(false);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load(true);
	}, [load]);

	const provider = readLlamaProvider(file);

	const updateSampling = (key: SamplingKey, raw: string) => {
		const value = raw.trim() === "" ? undefined : Number(raw);
		const sampling = mergeSampling(provider.samplingParams, { [key]: value ?? Number.NaN });
		setFile((current) => {
			const currentProvider = readLlamaProvider(current);
			const currentOverrides = currentProvider.modelOverrides;
			return {
				...current,
				providers: {
					...(current.providers ?? {}),
					"llama-cpp": {
						...currentProvider,
						samplingParams: sampling,
						modelOverrides: currentOverrides,
					},
				},
			};
		});
		setDirty(true);
	};

	const updateModelOverride = (model: LlamaCppModelStatus, key: SamplingKey, raw: string) => {
		const value = raw.trim() === "" ? undefined : Number(raw);
		setFile((current) => {
			const currentProvider = readLlamaProvider(current);
			const modelOverrides = { ...(currentProvider.modelOverrides ?? {}) };
			const existing = modelOverrides[model.id] ?? {};
			const sampling = mergeSampling(existing.samplingParams, { [key]: value ?? Number.NaN });
			modelOverrides[model.id] = { ...existing, samplingParams: sampling };
			return {
				...current,
				providers: {
					...(current.providers ?? {}),
					"llama-cpp": {
						...currentProvider,
						modelOverrides,
					},
				},
			};
		});
		setDirty(true);
	};

	const toggleOverride = (model: LlamaCppModelStatus, enabled: boolean) => {
		setFile((current) => {
			const currentProvider = readLlamaProvider(current);
			const modelOverrides = { ...(currentProvider.modelOverrides ?? {}) };
			if (enabled) {
				modelOverrides[model.id] = { ...(modelOverrides[model.id] ?? {}) };
			} else {
				delete modelOverrides[model.id];
			}
			return {
				...current,
				providers: {
					...(current.providers ?? {}),
					"llama-cpp": {
						...currentProvider,
						modelOverrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined,
					},
				},
			};
		});
		setDirty(true);
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			await rpc.writeModelsFile({ value: withLlamaProvider(file, provider) as Record<string, unknown> });
			await rpc.refreshModels().catch(() => {});
			await load(true);
		} catch (e) {
			setError(String(e));
		} finally {
			setSaving(false);
		}
	};

	const overrideFor = (model: LlamaCppModelStatus) => provider.modelOverrides?.[model.id];

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-xs font-semibold text-pi-text">llama.cpp server</h3>
					<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
						llama.cpp capabilities are detected from the server. Thinking levels use the composer pill;
						these controls tune generation.
					</p>
				</div>
				<Button
					variant="secondary"
					size="sm"
					icon={RefreshCw}
					loading={loading}
					onClick={() => void load(true)}
				>
					Refresh
				</Button>
			</div>

			{error && (
				<div className="rounded-md bg-pi-error-soft px-3 py-2 text-2xs text-pi-error">{error}</div>
			)}

			<Card className="space-y-3 p-3">
				<div className="flex items-center gap-2">
					<Server className="h-3.5 w-3.5 text-pi-text-muted" />
					<code className="font-mono text-2xs text-pi-text">{status?.baseUrl ?? "http://localhost:8080/v1"}</code>
					<span
						className={`ml-auto rounded-full px-2 py-0.5 text-3xs font-medium ${
							status?.reachable
								? "bg-pi-success/15 text-pi-success"
								: "bg-pi-error-soft text-pi-error"
						}`}
					>
						{loading ? "checking" : status?.reachable ? "reachable" : "offline"}
					</span>
				</div>

				{status && !status.reachable && (
					<p className="text-2xs leading-relaxed text-pi-text-muted">
						{status.error ?? "llama-server is not running."} Start it with{" "}
						<code className="font-mono">llama-server -m model.gguf</code> and refresh.
					</p>
				)}

				{status?.reachable && (
					<div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs">
						<span className="text-pi-text-muted">Build</span>
						<span className="truncate font-mono text-pi-text">{status.buildInfo ?? "unknown"}</span>
						<span className="text-pi-text-muted">Model</span>
						<span className="truncate font-mono text-pi-text">{status.modelPath ?? "unknown"}</span>
						<span className="text-pi-text-muted">Context</span>
						<span className="text-pi-text">
							{status.contextWindow ? `${status.contextWindow.toLocaleString()} tokens` : "unknown"}
						</span>
						<span className="text-pi-text-muted">Vision</span>
						<span className="text-pi-text">{status.vision ? "supported" : "text only"}</span>
						<span className="text-pi-text-muted">Thinking</span>
						<span className="text-pi-text">
							{status.reasoning
								? `${status.reasoningFormat}${status.thinkingFormat ? ` · ${status.thinkingFormat}` : ""}`
								: "not supported by template"}
						</span>
						<span className="text-pi-text-muted">Tools</span>
						<span className="text-pi-text">{status.supportsTools ? "supported" : "not supported"}</span>
					</div>
				)}
			</Card>

			<Card className="space-y-3 p-3">
				<div>
					<h4 className="text-2xs font-semibold text-pi-text">Default sampling</h4>
					<p className="mt-0.5 text-3xs text-pi-text-muted">
						Applied to every llama.cpp model. Blank uses the server default.
					</p>
				</div>
				<div className="grid grid-cols-2 gap-2">
					{SAMPLING_FIELDS.map((field) => (
						<LabeledNumber
							key={field.key}
							field={field}
							value={provider.samplingParams?.[field.key]}
							onChange={(value) => updateSampling(field.key, value)}
						/>
					))}
				</div>
			</Card>

			{status?.reachable && status.models.length > 0 && (
				<Card className="space-y-3 p-3">
					<div>
						<h4 className="text-2xs font-semibold text-pi-text">Per-model overrides</h4>
						<p className="mt-0.5 text-3xs text-pi-text-muted">
							Optional. Override sampling for one loaded model without changing the server defaults.
						</p>
					</div>
					<div className="space-y-2">
						{status.models.map((model) => {
							const override = overrideFor(model);
							const enabled = override !== undefined;
							return (
								<div key={model.id} className="rounded-md bg-pi-bg/60 p-2.5 shadow-ring">
									<div className="flex items-center gap-2">
										<div className="min-w-0 flex-1">
											<code className="block truncate font-mono text-2xs text-pi-text">{model.id}</code>
											<span className="text-3xs text-pi-text-muted">
												{model.contextWindow.toLocaleString()} ctx
												{model.reasoning ? ` · thinking ${model.thinkingLevels.join("/")}` : " · no thinking"}
												{model.vision ? " · vision" : ""}
											</span>
										</div>
										<Switch
											size="sm"
											checked={enabled}
											onChange={() => toggleOverride(model, !enabled)}
											ariaLabel={`Override sampling for ${model.id}`}
										/>
									</div>
									{enabled && (
										<div className="mt-2 grid grid-cols-2 gap-2">
											{SAMPLING_FIELDS.map((field) => (
												<LabeledNumber
													key={field.key}
													field={field}
													value={override?.samplingParams?.[field.key]}
													onChange={(value) => updateModelOverride(model, field.key, value)}
												/>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</Card>
			)}

			<div className="flex items-center justify-between gap-2">
				<p className="text-3xs text-pi-text-faint">
					Thinking budgets live in Conversation → Custom thinking budgets.
				</p>
				<Button variant="primary" size="sm" loading={saving} disabled={!dirty || saving} onClick={() => void save()}>
					Save llama.cpp settings
				</Button>
			</div>
		</div>
	);
}

function LabeledNumber({
	field,
	value,
	onChange,
}: {
	field: (typeof SAMPLING_FIELDS)[number];
	value: number | undefined;
	onChange: (value: string) => void;
}) {
	return (
		<label className="space-y-1">
			<span className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
				{field.label}
			</span>
			<Input
				type="number"
				scale="sm"
				value={value ?? ""}
				placeholder="default"
				min={field.min}
				max={field.max}
				step={field.step}
				onChange={(event) => onChange(event.target.value)}
			/>
		</label>
	);
}

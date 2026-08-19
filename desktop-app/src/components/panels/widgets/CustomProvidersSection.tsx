import {
	ChevronDown,
	Eye,
	EyeOff,
	Plus,
	RefreshCw,
	Server,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import * as rpc from "../../../lib/rpc";

// ============================================================================
// Types — mirror the models.json schema in
// packages/coding-agent/src/core/model-registry.ts (ModelsConfig / ProviderConfigSchema).
// ============================================================================

interface CustomModel {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow?: number;
	maxTokens?: number;
}

interface CustomProvider {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	models?: CustomModel[];
}

interface ModelsConfig {
	providers: Record<string, CustomProvider>;
}

const DEFAULT_PROVIDER: CustomProvider = {
	name: "",
	baseUrl: "http://localhost:8080/v1",
	api: "openai-completions",
	apiKey: "not-needed",
	authHeader: false,
	models: [],
};

const DEFAULT_MODEL: CustomModel = {
	id: "",
	name: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};

function newProviderId(existing: Record<string, unknown>): string {
	// Stable, non-random id derived from a counter (no Math.random so the form
	// stays deterministic across renders). "local-llm" is the conventional
	// first id; otherwise pick "custom-<n>".
	if (!("local-llm" in existing)) return "local-llm";
	let n = 1;
	while (`custom-${n}` in existing) n++;
	return `custom-${n}`;
}

/**
 * Custom Providers section — manage OpenAI-compatible (and other API-shaped)
 * providers stored in `~/.a-coder-cli/agent/models.json`.
 *
 * Each provider is keyed by an id (used in `defaultProvider` in settings.json
 * and as the `<provider>:<model>` prefix). The form edits the same JSON the
 * cli reads on startup, so adding a provider here makes it pickable from the
 * AI model / account UIs on the next engine reconnect.
 */
export function CustomProvidersSection() {
	const [config, setConfig] = useState<ModelsConfig>({ providers: {} });
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);

	const reload = useCallback(async () => {
		try {
			const data = await rpc.readModelsFile();
			const providers =
				(data?.providers as ModelsConfig["providers"] | undefined) ?? {};
			setConfig({ providers });
			setLoadError(null);
			setDirty(false);
		} catch (e) {
			setLoadError(String(e));
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const persist = useCallback(
		async (next: ModelsConfig) => {
			setSaving(true);
			setSaveError(null);
			try {
				await rpc.writeModelsFile({ value: next as unknown as Record<string, unknown> });
				setConfig(next);
				setDirty(false);
				// Tell the engine to reload models.json so the new custom provider
				// and its models show up in the chat model picker immediately.
				try {
					await rpc.refreshModels();
				} catch (e) {
					console.error("Failed to refresh engine models after save", e);
				}
			} catch (e) {
				setSaveError(String(e));
			} finally {
				setSaving(false);
			}
		},
		[],
	);

	const updateProvider = useCallback(
		(id: string, patch: Partial<CustomProvider>) => {
			setConfig((c) => ({
				providers: {
					...c.providers,
					[id]: { ...c.providers[id], ...patch },
				},
			}));
			setDirty(true);
		},
		[],
	);

	const updateModel = useCallback(
		(providerId: string,
			modelIdx: number,
			patch: Partial<CustomModel>) => {
		setConfig((c) => {
			const provider = c.providers[providerId];
			if (!provider?.models) return c;
			const models = provider.models.map((m, i) =>
				i === modelIdx ? { ...m, ...patch } : m,
			);
			return {
				providers: {
					...c.providers,
					[providerId]: { ...provider, models },
				},
			};
		});
		setDirty(true);
	}, []);

	const addProvider = useCallback(() => {
		setConfig((c) => {
			const id = newProviderId(c.providers);
			return {
				providers: {
					...c.providers,
					[id]: { ...DEFAULT_PROVIDER, models: [{ ...DEFAULT_MODEL }] },
				},
			};
		});
		setDirty(true);
	}, []);

	const removeProvider = useCallback((id: string) => {
		setConfig((c) => {
			const next = { ...c.providers };
			delete next[id];
			return { providers: next };
		});
		setDirty(true);
	}, []);

	const addModel = useCallback((providerId: string) => {
		setConfig((c) => {
			const provider = c.providers[providerId];
			if (!provider) return c;
			return {
				providers: {
					...c.providers,
					[providerId]: {
						...provider,
						models: [...(provider.models ?? []), { ...DEFAULT_MODEL }],
					},
				},
			};
		});
		setDirty(true);
	}, []);

	const removeModel = useCallback((providerId: string, modelIdx: number) => {
		setConfig((c) => {
			const provider = c.providers[providerId];
			if (!provider?.models) return c;
			return {
				providers: {
					...c.providers,
					[providerId]: {
						...provider,
						models: provider.models.filter((_, i) => i !== modelIdx),
					},
				},
			};
		});
		setDirty(true);
	}, []);

	const providerIds = Object.keys(config.providers);

	return (
		<div className="space-y-5">
			<div>
				<h2 className="text-[15px] font-semibold tracking-tight transition-smooth hover:text-pi-text-secondary">
					Custom AI
				</h2>
				<p className="mt-0.5 text-[11.5px] leading-relaxed text-pi-text-muted">
					Add an AI service that isn't in the built-in list — for example a local
					model running on this computer, or a private endpoint your workplace set up.
					After saving, choose it from the AI model panel.
				</p>
			</div>

			{loadError && (
				<div className="rounded-md bg-pi-error-soft px-3 py-2 text-[11.5px] text-pi-error">
					Couldn't read models.json: {loadError}
				</div>
			)}
			{saveError && (
				<div className="rounded-md bg-pi-error-soft px-3 py-2 text-[11.5px] text-pi-error">
					Couldn't save models.json: {saveError}
				</div>
			)}

			{providerIds.length === 0 && !loadError && (
				<div className="rounded-lg bg-pi-surface-raised px-4 py-3 text-[11.5px] text-pi-text-muted shadow-ring">
					No custom AI services yet. Click "Add AI service" to connect a local model or a private endpoint.
				</div>
			)}

			<div className="space-y-3">
				{providerIds.map((id) => (
					<ProviderEditor
						key={id}
						id={id}
						provider={config.providers[id]}
						onUpdateProvider={(patch) => updateProvider(id, patch)}
						onRemove={() => removeProvider(id)}
						onAddModel={() => addModel(id)}
						onUpdateModel={(idx, patch) => updateModel(id, idx, patch)}
						onRemoveModel={(idx) => removeModel(id, idx)}
						onSetModels={(models) => {
							setConfig((c) => ({
								providers: {
									...c.providers,
									[id]: { ...c.providers[id], models },
								},
							}));
							setDirty(true);
						}}
					/>
				))}
			</div>

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={addProvider}
					className="inline-flex h-8 items-center gap-1.5 rounded-md bg-pi-surface-overlay px-3 text-[12px] font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
				>
					<Plus className="h-3.5 w-3.5" />
					Add AI service
				</button>
				<button
					type="button"
					onClick={() => void persist(config)}
					disabled={!dirty || saving}
					className="inline-flex h-8 items-center gap-1.5 rounded-md bg-pi-accent px-3 text-[12px] font-semibold text-white transition-hover active-press hover:bg-pi-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
				>
					{saving ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					onClick={() => void reload()}
					className="inline-flex h-8 items-center rounded-md px-2 text-[12px] text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised"
				>
					Revert
				</button>
			</div>

			<div className="rounded-md bg-pi-surface-raised px-3 py-2.5 text-[11px] text-pi-text-muted shadow-ring">
				Tip: After saving, open the{" "}
				<span className="text-pi-text">AI model</span> panel and pick your custom
				service to make it the default.
			</div>
		</div>
	);
}

function ProviderEditor({
	id,
	provider,
	onUpdateProvider,
	onRemove,
	onAddModel,
	onUpdateModel,
	onRemoveModel,
	onSetModels,
}: {
	id: string;
	provider: CustomProvider;
	onUpdateProvider: (patch: Partial<CustomProvider>) => void;
	onRemove: () => void;
	onAddModel: () => void;
	onUpdateModel: (idx: number, patch: Partial<CustomModel>) => void;
	onRemoveModel: (idx: number) => void;
	onSetModels?: (models: CustomModel[]) => void;
}) {
	const [showKey, setShowKey] = useState(false);
	const [expanded, setExpanded] = useState(true);
	const [fetchingModels, setFetchingModels] = useState(false);
	const [fetchError, setFetchError] = useState<string | null>(null);

	const canFetch = Boolean(provider.baseUrl) && (provider.api === "openai-completions" || provider.api === "openai-responses");

	const fetchModels = useCallback(async () => {
		if (!provider.baseUrl || !canFetch) return;
		setFetchingModels(true);
		setFetchError(null);
		try {
			const baseUrl = provider.baseUrl.replace(/\/$/, "");
			const url = `${baseUrl}/models`;
			const headers: Record<string, string> = {};
			if (provider.apiKey && provider.authHeader) {
				headers["Authorization"] = `Bearer ${provider.apiKey}`;
			}
			const res = await fetch(url, { headers });
			if (!res.ok) {
				throw new Error(`Endpoint returned ${res.status} ${res.statusText}`);
			}
			const json = (await res.json()) as { data?: Array<{ id: string }> };
			const list = (json.data ?? []).map((entry) => entry.id).filter(Boolean);
			if (list.length === 0) {
				throw new Error("No models found at this endpoint.");
			}
			const models: CustomModel[] = list.map((modelId) => ({
				id: modelId,
				name: modelId,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			}));
			onSetModels?.(models);
		} catch (e) {
			setFetchError(e instanceof Error ? e.message : String(e));
		} finally {
			setFetchingModels(false);
		}
	}, [provider.baseUrl, provider.apiKey, provider.authHeader, provider.api, canFetch, onSetModels]);

	return (
		<div className="overflow-hidden rounded-lg bg-pi-surface-raised shadow-ring">
			<div className="flex items-start gap-3 px-4 py-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-pi-accent to-pi-accent-hover font-mono text-[11px] text-white">
					<Server className="h-4 w-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<code className="rounded bg-pi-surface-overlay px-1.5 py-0.5 font-mono text-[11.5px] text-pi-text">
							{id}
						</code>
						<span className="text-[11.5px] text-pi-text-muted">
							{provider.name || provider.baseUrl || "—"}
						</span>
						<span className="text-[10.5px] font-mono text-pi-text-faint">
							{(provider.models?.length ?? 0)} AI model{(provider.models?.length ?? 0) === 1 ? "" : "s"}
						</span>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						className="inline-flex h-7 items-center gap-1 rounded-md bg-pi-surface-overlay px-2 text-[11.5px] font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
					>
						<ChevronDown
							className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
						/>
						{expanded ? "Collapse" : "Edit"}
					</button>
					<button
						type="button"
						onClick={onRemove}
						className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-pi-surface-overlay text-pi-text-muted transition-hover active-press hover:bg-pi-error-soft hover:text-pi-error"
						title="Remove service" aria-label="Remove service"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{expanded && (
				<div className="space-y-3 border-t border-pi-border bg-pi-bg/50 px-4 py-3">
					<div className="grid grid-cols-2 gap-2">
						<LabeledInput
							label="Display name"
							value={provider.name ?? ""}
							placeholder="My local model"
							onChange={(v) => onUpdateProvider({ name: v })}
						/>
						<LabeledInput
							label="Address / URL"
							value={provider.baseUrl ?? ""}
							placeholder="http://localhost:8080/v1"
							mono
							onChange={(v) => onUpdateProvider({ baseUrl: v })}
						/>
						<LabeledSelect
							label="API"
							value={provider.api ?? "openai-completions"}
							options={[
								{ value: "openai-completions", label: "OpenAI Completions" },
								{ value: "openai-responses", label: "OpenAI Responses" },
								{ value: "anthropic-messages", label: "Anthropic Messages" },
								{ value: "google-gemini", label: "Google Gemini" },
							]}
							onChange={(v) => onUpdateProvider({ api: v })}
						/>
						<div className="space-y-1">
							<label className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
								API key
							</label>
							<div className="relative">
								<input
									type={showKey ? "text" : "password"}
									value={provider.apiKey ?? ""}
									onChange={(e) => onUpdateProvider({ apiKey: e.target.value })}
									placeholder="not-needed"
									spellCheck={false}
									autoComplete="off"
									className="w-full rounded-md bg-pi-surface-raised py-1.5 pl-3 pr-9 font-mono text-[11.5px] text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none"
								/>
								<button
									type="button"
									onClick={() => setShowKey((v) => !v)}
									className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-pi-text-faint hover:text-pi-text"
									title={showKey ? "Hide key" : "Show key"}
								>
									{showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
								</button>
							</div>
						</div>
					</div>

					<div className="flex items-center gap-2 px-1">
						<button
							type="button"
							onClick={() => onUpdateProvider({ authHeader: !provider.authHeader })}
							className={`relative h-4 w-7 rounded-full transition-smooth active-press ${provider.authHeader ? "bg-pi-accent" : "bg-pi-surface-overlay"}`}
							aria-pressed={provider.authHeader}
						>
							<span
								className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-smooth ${provider.authHeader ? "translate-x-3.5" : "translate-x-0.5"}`}
							/>
						</button>
						<span className="text-[11.5px] text-pi-text-muted">
							Send API key as a secret header
						</span>
					</div>

					{/* Models ------------------------------------------------------------- */}
					<div className="space-y-2">
						<div className="flex items-center justify-between px-1">
							<h4 className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
								AI models
							</h4>
							<div className="flex items-center gap-1.5">
								<button
									type="button"
									onClick={fetchModels}
									disabled={!canFetch || fetchingModels}
									className="inline-flex h-6 items-center gap-1 rounded bg-pi-surface-overlay px-2 text-[10.5px] font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
								>
									<RefreshCw className={`h-3 w-3 ${fetchingModels ? "animate-spin" : ""}`} />
									{fetchingModels ? "Fetching…" : "Fetch from endpoint"}
								</button>
								<button
									type="button"
									onClick={onAddModel}
									className="inline-flex h-6 items-center gap-1 rounded bg-pi-surface-overlay px-2 text-[10.5px] font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
								>
									<Plus className="h-3 w-3" />
									Add AI model
								</button>
							</div>
						</div>

						{fetchError && (
							<div className="rounded-md bg-pi-error-soft px-3 py-2 text-[11px] text-pi-error">
								Couldn't fetch models: {fetchError}
							</div>
						)}

						{(provider.models ?? []).length === 0 && (
							<p className="px-1 text-[11px] text-pi-text-faint">
								No AI models listed. Add at least one so it appears in the AI model picker.
							</p>
						)}

						{(provider.models ?? []).map((model, idx) => (
							<ModelEditor
								key={model.id ?? `model-${idx}`}
								model={model}
								onUpdate={(patch) => onUpdateModel(idx, patch)}
								onRemove={() => onRemoveModel(idx)}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function ModelEditor({
	model,
	onUpdate,
	onRemove,
}: {
	model: CustomModel;
	onUpdate: (patch: Partial<CustomModel>) => void;
	onRemove: () => void;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="rounded-md bg-pi-bg/70 shadow-ring">
			<div className="flex items-center gap-2 px-3 py-2">
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					<ChevronDown
						className={`h-3 w-3 shrink-0 text-pi-text-faint transition-transform ${expanded ? "rotate-180" : ""}`}
					/>
					<code className="truncate font-mono text-[11.5px] text-pi-text">
						{model.id || "(untitled)"}
					</code>
					{model.name && (
						<span className="truncate text-[11px] text-pi-text-muted">
							{model.name}
						</span>
					)}
				</button>
				<button
					type="button"
					onClick={onRemove}
					className="inline-flex h-6 w-6 items-center justify-center rounded text-pi-text-muted transition-hover hover:bg-pi-error-soft hover:text-pi-error"
					title="Remove AI model" aria-label="Remove AI model"
				>
					<X className="h-3 w-3" />
				</button>
			</div>
			{expanded && (
				<div className="grid grid-cols-2 gap-2 border-t border-pi-border px-3 py-2.5">
					<LabeledInput
						label="Model identifier"
						value={model.id}
						placeholder="qwen-coder-35b"
						mono
						onChange={(v) => onUpdate({ id: v })}
					/>
					<LabeledInput
						label="Display name"
						value={model.name ?? ""}
						placeholder="Qwen Coder 35B"
						onChange={(v) => onUpdate({ name: v })}
					/>
					<LabeledNumberInput
						label="How much it can remember"
						value={model.contextWindow ?? 128000}
						onChange={(v) => onUpdate({ contextWindow: v })}
					/>
					<LabeledNumberInput
						label="Longest reply"
						value={model.maxTokens ?? 4096}
						onChange={(v) => onUpdate({ maxTokens: v })}
					/>
					<label className="col-span-2 flex items-center gap-2 px-1 text-[11.5px] text-pi-text-muted">
						<input
							type="checkbox"
							checked={model.reasoning ?? false}
							onChange={(e) => onUpdate({ reasoning: e.target.checked })}
							className="accent-pi-accent"
						/>
						This model can show its thinking
					</label>
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Small form primitives — kept local since they're specific to this panel.
// ============================================================================

function LabeledInput({
	label,
	value,
	placeholder,
	mono,
	onChange,
}: {
	label: string;
	value: string;
	placeholder?: string;
	mono?: boolean;
	onChange: (v: string) => void;
}) {
	const id = useId();
	return (
		<div className="space-y-1">
			<label htmlFor={id} className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<input
				id={id}
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				spellCheck={false}
				autoComplete="off"
				className={`w-full rounded-md bg-pi-surface-raised py-1.5 px-3 text-[11.5px] text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none ${mono ? "font-mono" : ""}`}
			/>
		</div>
	);
}

function LabeledNumberInput({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
}) {
	const id = useId();
	return (
		<div className="space-y-1">
			<label htmlFor={id} className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<input
				id={id}
				type="number"
				value={value}
				min={1}
				onChange={(e) => onChange(Number(e.target.value) || 0)}
				className="w-full rounded-md bg-pi-surface-raised py-1.5 px-3 text-[11.5px] font-mono text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
			/>
		</div>
	);
}

function LabeledSelect({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (v: string) => void;
}) {
	const id = useId();
	return (
		<div className="space-y-1">
			<label htmlFor={id} className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<select
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-full rounded-md bg-pi-surface-raised py-1.5 px-3 text-[11.5px] text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
			>
				{options.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
		</div>
	);
}

import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { defaultProviderAuthContext } from "../auth/context.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { INCEPTION_MODELS } from "./inception.models.ts";

const BASE_URL = "https://api.inceptionlabs.ai/v1";

export interface InceptionPricing {
	prompt?: string;
	completion?: string;
	input_cache_reads?: string;
	input_cache_writes?: string;
}

export interface InceptionModelListItem {
	id: string;
	name: string;
	context_length?: number;
	max_output_length?: number;
	input_modalities?: string[];
	output_modalities?: string[];
	pricing?: InceptionPricing;
	supported_features?: string[];
	supported_endpoints?: string[];
}

export interface InceptionModelListResponse {
	data?: InceptionModelListItem[];
}

type InceptionModel = Model<"openai-completions">;

const STATIC_MODELS = new Map<string, InceptionModel>();
for (const model of Object.values(INCEPTION_MODELS)) {
	STATIC_MODELS.set(model.id, model as InceptionModel);
}

const DEFAULT_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	maxTokensField: "max_tokens" as const,
	supportsStrictMode: false,
	supportsLongCacheRetention: false,
};

function pricePerMillion(value: string | undefined): number {
	const parsed = Number.parseFloat(value ?? "0");
	return Number.isFinite(parsed) ? Number((parsed * 1_000_000).toFixed(6)) : 0;
}

/**
 * Map a live Inception `/v1/models` entry to the model shape used by the
 * agent. The generated catalog is the base for curated compat/thinking
 * metadata, so a live refresh adds or updates the catalog without losing it.
 */
export function createInceptionModel(entry: InceptionModelListItem): InceptionModel {
	const previous = STATIC_MODELS.get(entry.id);
	const input = entry.input_modalities?.includes("image") ? (["text", "image"] as const) : (["text"] as const);
	const hasPricing =
		entry.pricing?.prompt !== undefined ||
		entry.pricing?.completion !== undefined ||
		entry.pricing?.input_cache_reads !== undefined ||
		entry.pricing?.input_cache_writes !== undefined;
	return {
		...(previous ?? {}),
		id: entry.id,
		name: entry.name || previous?.name || entry.id,
		api: "openai-completions",
		provider: "inception",
		baseUrl: BASE_URL,
		reasoning: previous?.reasoning ?? false,
		input: entry.input_modalities ? [...input] : (previous?.input ?? ["text"]),
		cost: hasPricing
			? {
					input: pricePerMillion(entry.pricing?.prompt),
					output: pricePerMillion(entry.pricing?.completion),
					cacheRead: pricePerMillion(entry.pricing?.input_cache_reads),
					cacheWrite: pricePerMillion(entry.pricing?.input_cache_writes),
				}
			: (previous?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
		contextWindow: entry.context_length ?? previous?.contextWindow ?? 128_000,
		maxTokens: entry.max_output_length ?? previous?.maxTokens ?? 50_000,
		compat: previous?.compat ?? DEFAULT_COMPAT,
	};
}

/** Fetch Inception's live chat-model catalog. */
export async function fetchInceptionModels(apiKey?: string, signal?: AbortSignal): Promise<InceptionModel[]> {
	const headers: Record<string, string> = { accept: "application/json" };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const res = await fetch(`${BASE_URL}/models`, { headers, signal });
	if (!res.ok) {
		throw new Error(`Inception model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as InceptionModelListResponse;
	const seen = new Set<string>();
	const models: InceptionModel[] = [];
	for (const entry of json.data ?? []) {
		if (!entry.id || !entry.name || seen.has(entry.id)) continue;
		// The chat picker only wants chat models that can call tools. The API also
		// lists decisions/FIM/edit-only models on other endpoints.
		if (!entry.supported_endpoints?.includes("chat.completions")) continue;
		if (!entry.supported_features?.includes("tools")) continue;
		seen.add(entry.id);
		models.push(createInceptionModel(entry));
	}
	return models;
}

export function inceptionProvider(): Provider<"openai-completions"> {
	const auth = {
		apiKey: envApiKeyAuth("Inception API key", ["INCEPTION_API_KEY"]),
	};
	return createProvider({
		id: "inception",
		name: "Inception",
		baseUrl: BASE_URL,
		auth,
		models: Object.values(INCEPTION_MODELS),
		api: openAICompletionsApi(),
		fetchModels: async (context) => {
			const credentialKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
			const resolved =
				credentialKey === undefined
					? await auth.apiKey.resolve({ ctx: defaultProviderAuthContext(), signal: context.signal })
					: undefined;
			return await fetchInceptionModels(credentialKey ?? resolved?.auth.apiKey, context.signal);
		},
	});
}

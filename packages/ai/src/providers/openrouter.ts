import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { defaultProviderAuthContext } from "../auth/context.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadOpenRouterOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model, ThinkingLevel, ThinkingLevelMap } from "../types.ts";
import { OPENROUTER_MODELS } from "./openrouter.models.ts";

interface OpenRouterReasoningMetadata {
	mandatory?: boolean;
	default_enabled?: boolean;
	supported_efforts?: Array<ThinkingLevel | "none">;
	default_effort?: ThinkingLevel | "none";
}

export interface OpenRouterModelListItem {
	id: string;
	name: string;
	supported_parameters?: string[];
	architecture?: {
		modality?: string;
		input_modalities?: string[];
	};
	pricing?: {
		prompt?: string;
		completion?: string;
		input_cache_read?: string;
		input_cache_write?: string;
	};
	top_provider?: {
		context_length?: number;
		max_completion_tokens?: number;
	};
	context_length?: number;
	reasoning?: OpenRouterReasoningMetadata;
}

export interface OpenRouterModelListResponse {
	data?: OpenRouterModelListItem[];
}

type OpenRouterApi = "anthropic-messages" | "openai-completions";
type OpenRouterModel = Model<OpenRouterApi>;

const THINKING_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * OpenRouter's `top_provider.max_completion_tokens` is the largest cap across
 * routes, not the model's documented output limit. Pin known models so the
 * picker and request budget show the real value.
 */
const MAX_OUTPUT_TOKENS_OVERRIDES: Readonly<Record<string, number>> = {
	"deepseek/deepseek-v4.1-flash-1017": 262144,
};

const STATIC_MODELS = new Map<string, OpenRouterModel>();
for (const model of Object.values(OPENROUTER_MODELS)) {
	STATIC_MODELS.set(model.id, model as OpenRouterModel);
}

function getThinkingLevelMap(reasoning: OpenRouterReasoningMetadata | undefined): ThinkingLevelMap | undefined {
	if (!reasoning) return undefined;
	const efforts = reasoning.supported_efforts;
	if (!efforts?.length) return reasoning.mandatory === true ? { off: null } : undefined;
	const supported = new Set(efforts);
	if (!THINKING_LEVELS.some((level) => supported.has(level)) && !supported.has("none")) {
		return reasoning.mandatory === true ? { off: null } : undefined;
	}
	const map: ThinkingLevelMap = { off: supported.has("none") ? "none" : null };
	for (const level of THINKING_LEVELS) {
		map[level] = supported.has(level) ? level : null;
	}
	return map;
}

function pricePerMillion(value: string | undefined): number {
	const parsed = Number.parseFloat(value ?? "0");
	return Number.isFinite(parsed) ? Number((parsed * 1_000_000).toFixed(6)) : 0;
}

/**
 * Map one OpenRouter `/models` entry to the model shape the coding agent uses.
 * Existing generated entries are the base so curated compat/thinking metadata
 * survives catalog refreshes; new entries get sensible defaults.
 */
export function createOpenRouterModel(entry: OpenRouterModelListItem): OpenRouterModel {
	const previous = STATIC_MODELS.get(entry.id);
	const useAnthropicMessages = /^anthropic\//.test(entry.id) && !entry.id.endsWith(":batch");
	const hasArchitecture = Boolean(entry.architecture?.input_modalities || entry.architecture?.modality);
	const input: ("text" | "image")[] = ["text"];
	if (entry.architecture?.input_modalities?.includes("image") || entry.architecture?.modality?.includes("image")) {
		input.push("image");
	}

	const contextWindow =
		(entry.top_provider?.context_length ?? entry.context_length ?? previous?.contextWindow ?? 4096) || 4096;
	const apiMaxTokens = entry.top_provider?.max_completion_tokens;
	const maxTokens =
		MAX_OUTPUT_TOKENS_OVERRIDES[entry.id] ??
		(apiMaxTokens && apiMaxTokens > 0 ? apiMaxTokens : (previous?.maxTokens ?? 4096));
	const hasPricing = entry.pricing?.prompt !== undefined || entry.pricing?.completion !== undefined;

	const model: OpenRouterModel = {
		...(previous ?? {}),
		id: entry.id,
		name: entry.name || previous?.name || entry.id,
		api: previous?.api ?? (useAnthropicMessages ? "anthropic-messages" : "openai-completions"),
		baseUrl:
			previous?.baseUrl ?? (useAnthropicMessages ? "https://openrouter.ai/api" : "https://openrouter.ai/api/v1"),
		provider: "openrouter",
		reasoning: entry.supported_parameters?.includes("reasoning") ?? previous?.reasoning ?? false,
		input: hasArchitecture ? input : (previous?.input ?? input),
		cost: hasPricing
			? {
					input: pricePerMillion(entry.pricing?.prompt),
					output: pricePerMillion(entry.pricing?.completion),
					cacheRead: pricePerMillion(entry.pricing?.input_cache_read),
					cacheWrite: pricePerMillion(entry.pricing?.input_cache_write),
				}
			: (previous?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
		contextWindow,
		maxTokens,
	};

	const thinkingLevelMap = getThinkingLevelMap(entry.reasoning);
	if (thinkingLevelMap) model.thinkingLevelMap = thinkingLevelMap;
	if (!previous && !useAnthropicMessages) {
		model.compat = { supportsDeveloperRole: false, thinkingFormat: "openrouter" };
	}
	return model;
}

/** Fetch OpenRouter's live catalog. `/models` is public; the key is optional. */
export async function fetchOpenRouterModels(apiKey?: string, signal?: AbortSignal): Promise<OpenRouterModel[]> {
	const headers: Record<string, string> = { accept: "application/json" };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const res = await fetch("https://openrouter.ai/api/v1/models", { headers, signal });
	if (!res.ok) {
		throw new Error(`OpenRouter model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as OpenRouterModelListResponse;
	const seen = new Set<string>();
	const models: OpenRouterModel[] = [];
	for (const entry of json.data ?? []) {
		if (!entry.id || !entry.name || seen.has(entry.id)) continue;
		// Match the generated catalog: only tool-capable models are selectable.
		if (!entry.supported_parameters?.includes("tools")) continue;
		seen.add(entry.id);
		models.push(createOpenRouterModel(entry));
	}
	return models;
}

export function openrouterProvider(): Provider<OpenRouterApi> {
	const auth = {
		apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]),
		oauth: lazyOAuth({
			name: "OpenRouter OAuth",
			loginLabel: "Sign in with OpenRouter",
			load: loadOpenRouterOAuth,
		}),
	};

	return createProvider({
		id: "openrouter",
		name: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		auth,
		models: Object.values(OPENROUTER_MODELS),
		api: {
			"anthropic-messages": anthropicMessagesApi(),
			"openai-completions": openAICompletionsApi(),
		},
		fetchModels: async (context) => {
			const resolved = await auth.apiKey.resolve({
				ctx: defaultProviderAuthContext(),
				signal: context.signal,
			});
			return await fetchOpenRouterModels(resolved?.auth.apiKey, context.signal);
		},
	});
}

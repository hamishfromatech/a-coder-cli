import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { defaultProviderAuthContext } from "../auth/context.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

const PLACEHOLDER_MODEL: Model<"openai-completions"> = {
	id: "orca",
	name: "OrcaRouter: pick any model",
	api: "openai-completions",
	provider: "orcarouter",
	baseUrl: "https://api.orcarouter.ai/v1",
	compat: {
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: false,
		maxTokensField: "max_tokens",
		supportsStrictMode: false,
		supportsLongCacheRetention: false,
	},
	reasoning: false,
	input: ["text"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 128000,
	maxTokens: 32768,
};

/** One `data` entry of OrcaRouter's GET /models (OpenAI list shape). */
export interface OrcaRouterModelListItem {
	id: string;
	object?: string;
	/** The upstream the entry routes to, when the gateway reports it. */
	owned_by?: string;
	/** Capability metadata exists only when the catalog has it. */
	context_length?: number;
	max_completion_tokens?: number;
	architecture?: {
		input_modalities?: string[];
	};
	/** Entries the gateway publishes without OpenAI chat, e.g. images/video. */
	supported_endpoint_types?: string[];
}

export interface OrcaRouterModelListResponse {
	object?: "list";
	data: OrcaRouterModelListItem[];
}

/**
 * Chat-worthiness filter: the catalog mixes in image- and audio-only
 * entries; a model must publish the OpenAI chat endpoint type. Entries with
 * no endpoint metadata are kept (older gateway deployments omit it).
 */
export function isChatWorthyOrcaRouterModel(entry: OrcaRouterModelListItem): boolean {
	const types = entry.supported_endpoint_types;
	if (!types || types.length === 0) return true;
	return types.includes("openai");
}

/** Modalities from the capability metadata; text is always part of it. */
export function inputModalitiesOf(entry: OrcaRouterModelListItem): Array<"text" | "image"> {
	const modalities = entry.architecture?.input_modalities ?? [];
	const input: Array<"text" | "image"> = ["text"];
	if (modalities.includes("image")) {
		input.push("image");
	}
	return input;
}

export function createOrcaRouterModel(id: string, entry: OrcaRouterModelListItem): Model<"openai-completions"> {
	const contextWindow = entry.context_length && entry.context_length > 0 ? entry.context_length : 128000;
	// Max-completion tokens falls back under the context window; the API
	// layer retries without max_tokens for models whose cap is lower.
	const maxTokens =
		entry.max_completion_tokens && entry.max_completion_tokens > 0 && entry.max_completion_tokens <= contextWindow
			? entry.max_completion_tokens
			: Math.min(32768, contextWindow);
	return {
		id,
		name: entry.owned_by ? `OrcaRouter: ${id} (${entry.owned_by})` : `OrcaRouter: ${id}`,
		api: "openai-completions",
		provider: "orcarouter",
		baseUrl: "https://api.orcarouter.ai/v1",
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			supportsStrictMode: false,
			supportsLongCacheRetention: false,
		},
		reasoning: false,
		input: inputModalitiesOf(entry),
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow,
		maxTokens,
	};
}

async function fetchOrcaRouterModels(apiKey: string, signal?: AbortSignal): Promise<Model<"openai-completions">[]> {
	const response = await fetch("https://api.orcarouter.ai/v1/models", {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			accept: "application/json",
		},
		signal,
	});
	if (!response.ok) {
		throw new Error(`OrcaRouter model refresh failed: ${response.status} ${response.statusText}`);
	}
	const list = (await response.json()) as OrcaRouterModelListResponse;
	const entries = (list.data ?? []).filter((entry) => entry.id && isChatWorthyOrcaRouterModel(entry));
	return entries.map((entry) => createOrcaRouterModel(entry.id, entry));
}

export function orcaRouterProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: envApiKeyAuth("OrcaRouter API key", ["ORCAROUTER_API_KEY", "ORCA_ROUTER_API_KEY"]) };

	return createProvider({
		id: "orcarouter",
		name: "OrcaRouter",
		baseUrl: "https://api.orcarouter.ai/v1",
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		fetchModels: async (context) => {
			const resolved = await auth.apiKey.resolve({
				ctx: defaultProviderAuthContext(),
				signal: context.signal,
			});
			const apiKey = resolved?.auth.apiKey;
			if (!apiKey) {
				throw new Error("OrcaRouter API key not configured");
			}
			return await fetchOrcaRouterModels(apiKey, context.signal);
		},
	});
}

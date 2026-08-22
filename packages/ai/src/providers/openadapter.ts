import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { defaultProviderAuthContext } from "../auth/context.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { OPENADAPTER_MODELS } from "./openadapter.models.ts";

export interface OpenAdapterModelListResponse {
	object: "list";
	data: Array<{
		id: string;
		object?: string;
		created?: number;
		owned_by?: string;
		model_type?: "chat" | "embedding" | "audio";
		endpoint_format?: string;
		supports_vision?: boolean;
		supports_thinking?: boolean;
		context_length?: number;
		pricing?: {
			input: number;
			output: number;
			unit: string;
		};
		quota_cost?: number;
	}>;
}

export function createOpenAdapterModel(
	id: string,
	meta?: OpenAdapterModelListResponse["data"][number],
): Model<"openai-completions"> {
	const pricing = meta?.pricing;
	const contextLength = meta?.context_length ?? 128000;
	// Default maxTokens to ~3% of context window, capped at 16k
	const maxTokens = Math.min(16384, Math.floor(contextLength * 0.03));

	return {
		id,
		name: `OpenAdapter: ${id}`,
		api: "openai-completions",
		provider: "openadapter",
		baseUrl: "https://api.openadapter.in/v1",
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			supportsStrictMode: false,
			supportsLongCacheRetention: false,
		},
		reasoning: meta?.supports_thinking ?? false,
		input: meta?.supports_vision ? ["text", "image"] : ["text"],
		cost: {
			input: pricing?.input ?? 0,
			output: pricing?.output ?? 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: contextLength,
		maxTokens,
	};
}

export async function fetchOpenAdapterModels(apiKey: string): Promise<Model<"openai-completions">[]> {
	const res = await fetch("https://api.openadapter.in/v1/models", {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});
	if (!res.ok) {
		throw new Error(`OpenAdapter model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as OpenAdapterModelListResponse;
	const data = json.data ?? [];
	// Filter to chat models only (exclude embedding/audio)
	return data
		.filter((entry) => entry.model_type === "chat" || !entry.model_type)
		.map((entry) => createOpenAdapterModel(entry.id, entry));
}

export function openadapterProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: envApiKeyAuth("OpenAdapter API key", ["OPENADAPTER_API_KEY"]) };
	const baseModel = Object.values(OPENADAPTER_MODELS)[0] ?? createOpenAdapterModel("openadapter/auto");

	return createProvider({
		id: "openadapter",
		name: "OpenAdapter",
		baseUrl: "https://api.openadapter.in/v1",
		auth,
		models: Object.values(OPENADAPTER_MODELS),
		api: openAICompletionsApi(),
		refreshModels: async () => {
			const resolved = await auth.apiKey.resolve({
				ctx: defaultProviderAuthContext(),
				model: baseModel,
			});
			const apiKey = resolved?.auth.apiKey;
			if (!apiKey) {
				throw new Error("OpenAdapter API key not configured");
			}
			return fetchOpenAdapterModels(apiKey);
		},
	});
}

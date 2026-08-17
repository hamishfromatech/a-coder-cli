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
	}>;
}

export function createOpenAdapterModel(id: string): Model<"openai-completions"> {
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
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 128000,
		maxTokens: 4096,
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
	return data.map((entry) => createOpenAdapterModel(entry.id));
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

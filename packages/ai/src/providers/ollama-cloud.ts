import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { defaultProviderAuthContext } from "../auth/context.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { OLLAMA_CLOUD_MODELS } from "./ollama-cloud.models.ts";

export interface OllamaCloudModelListResponse {
	object: "list";
	data: Array<{
		id: string;
		object?: string;
		created?: number;
		owned_by?: string;
	}>;
}

export function createOllamaCloudModel(id: string): Model<"openai-completions"> {
	// The Ollama Cloud /v1/models endpoint only returns ids (no context/output
	// caps), so we apply sane per-family defaults. Kimi K2 models expose a 1M
	// context window and ~128k output; other Ollama Cloud models default to 128k
	// context. Output is clamped to the remaining context at request time, so a
	// generous maxTokens just removes the artificial 4096 cap that was cutting
	// long code generations off mid-response.
	const isKimi = id.toLowerCase().includes("kimi");
	return {
		id,
		name: `Ollama Cloud: ${id}`,
		api: "openai-completions",
		provider: "ollama-cloud",
		baseUrl: "https://ollama.com/v1",
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
		contextWindow: isKimi ? 1048576 : 128000,
		maxTokens: 131072,
	};
}

export async function fetchOllamaCloudModels(apiKey: string): Promise<Model<"openai-completions">[]> {
	const res = await fetch("https://ollama.com/v1/models", {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});
	if (!res.ok) {
		throw new Error(`Ollama Cloud model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as OllamaCloudModelListResponse;
	const data = json.data ?? [];
	return data.map((entry) => createOllamaCloudModel(entry.id));
}

export function ollamaCloudProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: envApiKeyAuth("Ollama Cloud API key", ["OLLAMA_API_KEY"]) };
	const baseModel = Object.values(OLLAMA_CLOUD_MODELS)[0] ?? createOllamaCloudModel("llama3.3");

	return createProvider({
		id: "ollama-cloud",
		name: "Ollama Cloud",
		baseUrl: "https://ollama.com/v1",
		auth,
		models: Object.values(OLLAMA_CLOUD_MODELS),
		api: openAICompletionsApi(),
		refreshModels: async () => {
			const resolved = await auth.apiKey.resolve({
				ctx: defaultProviderAuthContext(),
				model: baseModel,
			});
			const apiKey = resolved?.auth.apiKey;
			if (!apiKey) {
				throw new Error("Ollama Cloud API key not configured");
			}
			return fetchOllamaCloudModels(apiKey);
		},
	});
}

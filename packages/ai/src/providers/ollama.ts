import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

const PLACEHOLDER_MODEL: Model<"openai-completions"> = {
	id: "local",
	name: "Ollama: local model",
	api: "openai-completions",
	provider: "ollama",
	baseUrl: "http://localhost:11434/v1",
	compat: {
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: false,
		maxTokensField: "max_tokens",
		supportsStrictMode: false,
		supportsLongCacheRetention: false,
	},
	reasoning: false,
	input: ["text", "image"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 128000,
	maxTokens: 4096,
};

function ollamaAuth(): ApiKeyAuth {
	return {
		name: "Ollama",
		resolve: async ({ ctx }) => {
			const baseUrl = await ctx.env("OLLAMA_BASE_URL");
			return {
				auth: { apiKey: "not-needed", baseUrl: baseUrl || undefined },
				source: "keyless local server",
			};
		},
	};
}

export interface OllamaModelListItem {
	id: string;
	object?: string;
}

export interface OllamaModelListResponse {
	object: "list";
	data: OllamaModelListItem[];
}

const DEFAULT_BASE_URL = "http://localhost:11434/v1";

export function resolveOllamaBaseUrl(override?: string): string {
	if (override) return override;
	if (typeof process !== "undefined" && process.env.OLLAMA_BASE_URL) {
		return process.env.OLLAMA_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

export function createOllamaModel(id: string, baseUrl?: string): Model<"openai-completions"> {
	return {
		id,
		name: `Ollama: ${id}`,
		api: "openai-completions",
		provider: "ollama",
		baseUrl: resolveOllamaBaseUrl(baseUrl),
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			supportsStrictMode: false,
			supportsLongCacheRetention: false,
		},
		reasoning: false,
		input: ["text", "image"],
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

export async function fetchOllamaModels(
	baseUrl?: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	const resolvedBaseUrl = resolveOllamaBaseUrl(baseUrl).replace(/\/$/, "");
	const res = await fetch(`${resolvedBaseUrl}/models`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`Ollama model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as OllamaModelListResponse;
	const list = json.data ?? [];
	return list.filter((entry) => entry.id).map((entry) => createOllamaModel(entry.id, baseUrl));
}

export function ollamaProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: ollamaAuth() };

	return createProvider({
		id: "ollama",
		name: "Ollama",
		baseUrl: resolveOllamaBaseUrl(),
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		refreshModels: async () => fetchOllamaModels(),
	});
}

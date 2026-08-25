import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";
import {
	fetchOllamaContextWindow,
	type OllamaTagsResponse,
	ollamaNativeOrigin,
	parseContextLengthFromModelInfo,
} from "./ollama-context.ts";

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

const DEFAULT_BASE_URL = "http://localhost:11434/v1";

export function resolveOllamaBaseUrl(override?: string): string {
	if (override) return override;
	if (typeof process !== "undefined" && process.env.OLLAMA_BASE_URL) {
		return process.env.OLLAMA_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

export function createOllamaModel(id: string, baseUrl?: string, contextWindow?: number): Model<"openai-completions"> {
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
		contextWindow: contextWindow && contextWindow > 0 ? contextWindow : 128000,
		maxTokens: 4096,
	};
}

export async function fetchOllamaModels(
	baseUrl?: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	// The local Ollama server serves model tags at the native /api/tags endpoint.
	// The OpenAI-compatible /v1/models list is also available but doesn't carry
	// context windows, so we prefer /api/tags (model_info.context_length) and
	// fill in details from /api/show when the server omits them — mirroring
	// Ollama Cloud.
	const resolvedBaseUrl = resolveOllamaBaseUrl(baseUrl);
	const origin = ollamaNativeOrigin(resolvedBaseUrl);
	if (!origin) {
		throw new Error(`Ollama model refresh failed: invalid base URL "${resolvedBaseUrl}"`);
	}
	const tagsRes = await fetch(`${origin}/api/tags`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!tagsRes.ok) {
		throw new Error(`Ollama model refresh failed: ${tagsRes.status} ${tagsRes.statusText}`);
	}
	const tagsJson = (await tagsRes.json()) as OllamaTagsResponse;
	const tags = tagsJson.models ?? [];

	const models: Model<"openai-completions">[] = [];
	for (const tag of tags) {
		const name = tag.name || tag.model;
		if (!name) continue;

		// Start with whatever /api/tags already tells us.
		const contextWindow = parseContextLengthFromModelInfo(tag.model_info);
		const base = createOllamaModel(name, baseUrl, contextWindow);

		// Probe /api/show for a more accurate context window when /api/tags
		// didn't include model_info or omitted context_length.
		if (!contextWindow) {
			const probed = await fetchOllamaContextWindow(resolvedBaseUrl, name, { signal });
			if (probed && probed > 0) {
				base.contextWindow = probed;
			}
		}

		models.push(base);
	}
	return models;
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

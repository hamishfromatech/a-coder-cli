import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

const PLACEHOLDER_MODEL: Model<"openai-completions"> = {
	id: "local",
	name: "llama.cpp: local model",
	api: "openai-completions",
	provider: "llama-cpp",
	baseUrl: "http://localhost:8080/v1",
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

function llamaCppAuth(): ApiKeyAuth {
	return {
		name: "llama.cpp",
		resolve: async ({ ctx }) => {
			const baseUrl = await ctx.env("LLAMACPP_BASE_URL");
			return {
				auth: { apiKey: "not-needed", baseUrl: baseUrl || undefined },
				source: "keyless local server",
			};
		},
	};
}

export interface LlamaCppModelListItem {
	id: string;
	object?: string;
	/** Newer llama.cpp builds include GGUF-derived metadata here. */
	meta?: {
		n_ctx?: number;
		n_ctx_train?: number;
	};
}

export interface LlamaCppModelListResponse {
	object: "list";
	data: LlamaCppModelListItem[];
}

const DEFAULT_BASE_URL = "http://localhost:8080/v1";

export function resolveLlamaCppBaseUrl(override?: string): string {
	if (override) return override;
	if (typeof process !== "undefined" && process.env.LLAMACPP_BASE_URL) {
		return process.env.LLAMACPP_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

export function createLlamaCppModel(id: string, baseUrl?: string, contextWindow?: number): Model<"openai-completions"> {
	return {
		id,
		name: `llama.cpp: ${id}`,
		api: "openai-completions",
		provider: "llama-cpp",
		baseUrl: resolveLlamaCppBaseUrl(baseUrl),
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
		contextWindow: contextWindow !== undefined && contextWindow > 0 ? contextWindow : 128000,
		maxTokens: 4096,
	};
}

/** The server's loaded context first, the model's trained context second. */
export function llamaCppContextWindow(entry: LlamaCppModelListItem): number | undefined {
	const served = entry.meta?.n_ctx;
	if (served !== undefined && served > 0) return served;
	const trained = entry.meta?.n_ctx_train;
	return trained !== undefined && trained > 0 ? trained : undefined;
}

export async function fetchLlamaCppModels(
	baseUrl?: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	const resolvedBaseUrl = resolveLlamaCppBaseUrl(baseUrl).replace(/\/$/, "");
	const res = await fetch(`${resolvedBaseUrl}/models`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`llama.cpp model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as LlamaCppModelListResponse;
	const list = json.data ?? [];
	return list
		.filter((entry) => entry.id)
		.map((entry) => createLlamaCppModel(entry.id, baseUrl, llamaCppContextWindow(entry)));
}

export function llamaCppProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: llamaCppAuth() };

	return createProvider({
		id: "llama-cpp",
		name: "llama.cpp",
		baseUrl: resolveLlamaCppBaseUrl(),
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		refreshModels: async () => fetchLlamaCppModels(),
	});
}

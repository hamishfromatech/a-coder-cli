import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { defaultProviderAuthContext } from "../auth/context.ts";
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
}

export interface LlamaCppModelListResponse {
	object: "list";
	data: LlamaCppModelListItem[];
}

const DEFAULT_BASE_URL = "http://localhost:8080/v1";

export function resolveLlamaCppBaseUrl(): string {
	if (typeof process !== "undefined" && process.env.LLAMACPP_BASE_URL) {
		return process.env.LLAMACPP_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

export function createLlamaCppModel(id: string): Model<"openai-completions"> {
	return {
		id,
		name: `llama.cpp: ${id}`,
		api: "openai-completions",
		provider: "llama-cpp",
		baseUrl: resolveLlamaCppBaseUrl(),
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

export async function fetchLlamaCppModels(signal?: AbortSignal): Promise<Model<"openai-completions">[]> {
	const baseUrl = resolveLlamaCppBaseUrl().replace(/\/$/, "");
	const res = await fetch(`${baseUrl}/models`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`llama.cpp model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as LlamaCppModelListResponse;
	const list = json.data ?? [];
	return list.filter((entry) => entry.id).map((entry) => createLlamaCppModel(entry.id));
}

export function llamaCppProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: llamaCppAuth() };
	const baseModel = PLACEHOLDER_MODEL;

	return createProvider({
		id: "llama-cpp",
		name: "llama.cpp",
		baseUrl: resolveLlamaCppBaseUrl(),
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		refreshModels: async () => {
			// llama.cpp is keyless; auth always resolves, so this just validates the
			// local server is reachable before we try to fetch models.
			await auth.apiKey.resolve({ ctx: defaultProviderAuthContext(), model: baseModel });
			return fetchLlamaCppModels();
		},
	});
}

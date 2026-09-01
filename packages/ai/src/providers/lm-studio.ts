import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

const PLACEHOLDER_MODEL: Model<"openai-completions"> = {
	id: "local",
	name: "LM Studio: local model",
	api: "openai-completions",
	provider: "lm-studio",
	baseUrl: "http://localhost:1234/v1",
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

function lmStudioAuth(): ApiKeyAuth {
	return {
		name: "LM Studio",
		resolve: async ({ ctx }) => {
			const baseUrl = await ctx.env("LM_STUDIO_BASE_URL");
			return {
				auth: { apiKey: "not-needed", baseUrl: baseUrl || undefined },
				source: "keyless local server",
			};
		},
	};
}

export interface LMStudioModelListItem {
	id: string;
	object?: string;
}

export interface LMStudioModelListResponse {
	object: "list";
	data: LMStudioModelListItem[];
}

/** Entry from LM Studio's REST `/api/v0/models` endpoint. */
export interface LMStudioV0ModelEntry {
	id: string;
	type?: string;
	state?: "loaded" | "not-loaded" | string;
	max_context_length?: number;
	loaded_context_length?: number;
	capabilities?: string[];
}

export interface LMStudioV0ModelListResponse {
	object?: string;
	data?: LMStudioV0ModelEntry[];
}

const DEFAULT_BASE_URL = "http://localhost:1234/v1";

export function resolveLMStudioBaseUrl(override?: string): string {
	if (override) return override;
	if (typeof process !== "undefined" && process.env.LM_STUDIO_BASE_URL) {
		return process.env.LM_STUDIO_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

export function createLMStudioModel(id: string, baseUrl?: string, contextWindow?: number): Model<"openai-completions"> {
	return {
		id,
		name: `LM Studio: ${id}`,
		api: "openai-completions",
		provider: "lm-studio",
		baseUrl: resolveLMStudioBaseUrl(baseUrl),
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

function contextWindowFromV0(entry: LMStudioV0ModelEntry): number | undefined {
	// Prefer the context actually served for the loaded instance over the
	// model's catalog max (LM Studio may cap it on load).
	const served = entry.loaded_context_length;
	if (served !== undefined && served > 0) return served;
	const max = entry.max_context_length;
	return max !== undefined && max > 0 ? max : undefined;
}

async function fetchLMStudioLoadedModels(
	resolvedBaseUrl: string,
	baseUrl: string | undefined,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	const res = await fetch(`${resolvedBaseUrl.replace(/\/v1$/, "")}/api/v0/models`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`LM Studio /api/v0/models failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as LMStudioV0ModelListResponse;
	const list = json.data ?? [];
	const models: Model<"openai-completions">[] = [];
	for (const entry of list) {
		// Only currently-loaded LM models can serve requests; embeddings are
		// not chat models.
		if (!entry.id || entry.type !== "llm" || entry.state !== "loaded") continue;
		models.push(createLMStudioModel(entry.id, baseUrl, contextWindowFromV0(entry)));
	}
	return models;
}

export async function fetchLMStudioModels(
	baseUrl?: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	const resolvedBaseUrl = resolveLMStudioBaseUrl(baseUrl).replace(/\/$/, "");
	try {
		// REST API first: reports only loaded models plus their real context
		// windows. Nothing loaded means an empty list.
		return await fetchLMStudioLoadedModels(resolvedBaseUrl, baseUrl, signal);
	} catch {
		// Older LM Studio builds predate /api/v0/models. Fall back to the
		// bare OpenAI-compatible list (ids only, default context window).
		const res = await fetch(`${resolvedBaseUrl}/models`, {
			headers: { accept: "application/json" },
			signal,
		});
		if (!res.ok) {
			throw new Error(`LM Studio model refresh failed: ${res.status} ${res.statusText}`);
		}
		const json = (await res.json()) as LMStudioModelListResponse;
		const list = json.data ?? [];
		return list.filter((entry) => entry.id).map((entry) => createLMStudioModel(entry.id, baseUrl));
	}
}

export function lmStudioProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: lmStudioAuth() };

	return createProvider({
		id: "lm-studio",
		name: "LM Studio",
		baseUrl: resolveLMStudioBaseUrl(),
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		refreshModels: async () => fetchLMStudioModels(),
	});
}

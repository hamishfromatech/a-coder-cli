import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

const PLACEHOLDER_MODEL: Model<"openai-completions"> = {
	id: "local",
	name: "Unsloth: local model",
	api: "openai-completions",
	provider: "unsloth",
	baseUrl: "http://localhost:8888/v1",
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
	maxTokens: 128000,
};

function unslothAuth(): ApiKeyAuth {
	return {
		name: "Unsloth",
		resolve: async ({ ctx }) => {
			const baseUrl = await ctx.env("UNSLOTH_BASE_URL");
			return {
				auth: { apiKey: "not-needed", baseUrl: baseUrl || undefined },
				source: "keyless local server",
			};
		},
	};
}

export interface UnslothModelListItem {
	id: string;
	object?: string;
	/** Human-friendly name from the server when available. */
	display_name?: string;
	/** Unsloth's server reports the model's context length directly. */
	context_length?: number;
	max_context_length?: number;
	/** Currently loaded model on the server. */
	loaded?: boolean;
	quant?: string;
}

export interface UnslothModelListResponse {
	object: "list";
	data: UnslothModelListItem[];
}

const DEFAULT_BASE_URL = "http://localhost:8888/v1";

export function resolveUnslothBaseUrl(override?: string): string {
	if (override) return override;
	if (typeof process !== "undefined" && process.env.UNSLOTH_BASE_URL) {
		return process.env.UNSLOTH_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

/**
 * Chat-worthiness filter for /v1/models entries. Unsloth Studio's server
 * surfaces everything in its model store — directory junk (".ollama",
 * ".unsloth/.cache"), embedding models (nomic-embed-text, mxbai-embed-large),
 * and ASR/audio models (whisper, qwen3-asr) that cannot serve completions.
 */
export function isChatWorthyUnslothModel(entry: { id: string; display_name?: string }): boolean {
	const haystack = `${entry.id} ${entry.display_name ?? ""}`.toLowerCase();
	if (haystack.includes("embed") || haystack.includes("whisper") || haystack.includes("asr")) {
		return false;
	}
	// Directory junk: a path segment starting with a dot (".ollama",
	// ".unsloth/.cache", ".clara/llama-models").
	return !entry.id.split("/").some((segment) => segment.startsWith("."));
}

export function createUnslothModel(
	id: string,
	baseUrl?: string,
	contextWindow?: number,
	displayName?: string,
): Model<"openai-completions"> {
	return {
		id,
		name: `Unsloth: ${displayName || id}`,
		api: "openai-completions",
		provider: "unsloth",
		baseUrl: resolveUnslothBaseUrl(baseUrl),
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
		maxTokens: 128000,
	};
}

/** Served context first, the model's max context second. */
export function unslothContextWindow(entry: UnslothModelListItem): number | undefined {
	const served = entry.context_length;
	if (served !== undefined && served > 0) return served;
	const max = entry.max_context_length;
	return max !== undefined && max > 0 ? max : undefined;
}

export async function fetchUnslothModels(
	baseUrl?: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	const resolvedBaseUrl = resolveUnslothBaseUrl(baseUrl).replace(/\/$/, "");
	const res = await fetch(`${resolvedBaseUrl}/models`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`Unsloth model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as UnslothModelListResponse;
	const list = json.data ?? [];
	return list
		.filter((entry) => entry.id)
		.filter(isChatWorthyUnslothModel)
		.map((entry) => createUnslothModel(entry.id, baseUrl, unslothContextWindow(entry), entry.display_name));
}

export function unslothProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: unslothAuth() };

	return createProvider({
		id: "unsloth",
		name: "Unsloth",
		baseUrl: resolveUnslothBaseUrl(),
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		fetchModels: async (context) => await fetchUnslothModels(undefined, context.signal),
	});
}

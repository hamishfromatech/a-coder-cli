import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

const PLACEHOLDER_MODEL: Model<"openai-completions"> = {
	id: "local",
	name: "vLLM: local model",
	api: "openai-completions",
	provider: "vllm",
	baseUrl: "http://localhost:8000/v1",
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

function vllmAuth(): ApiKeyAuth {
	return {
		name: "vLLM",
		resolve: async ({ ctx }) => {
			const baseUrl = await ctx.env("VLLM_BASE_URL");
			return {
				auth: { apiKey: "not-needed", baseUrl: baseUrl || undefined },
				source: "keyless local server",
			};
		},
	};
}

export interface VllmModelListItem {
	id: string;
	object?: string;
	/** vLLM reports the served context window directly (`--max-model-len`). */
	max_model_len?: number;
}

export interface VllmModelListResponse {
	object: "list";
	data: VllmModelListItem[];
}

const DEFAULT_BASE_URL = "http://localhost:8000/v1";
/** Fallback when the server does not report `max_model_len` (older vLLM). */
const DEFAULT_CONTEXT_WINDOW = 128000;

export function resolveVllmBaseUrl(override?: string): string {
	if (override) return override;
	if (typeof process !== "undefined" && process.env.VLLM_BASE_URL) {
		return process.env.VLLM_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

export function createVllmModel(id: string, baseUrl?: string, contextWindow?: number): Model<"openai-completions"> {
	const served = contextWindow !== undefined && contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW;
	return {
		id,
		name: `vLLM: ${id}`,
		api: "openai-completions",
		provider: "vllm",
		baseUrl: resolveVllmBaseUrl(baseUrl),
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
		contextWindow: served,
		// vLLM caps generation against the served context window (prompt +
		// completion share it), so the honest output budget is the served len.
		maxTokens: served,
	};
}

/** The served context window (`--max-model-len`), when the server reports it. */
export function vllmContextWindow(entry: VllmModelListItem): number | undefined {
	const len = entry.max_model_len;
	return len !== undefined && len > 0 ? len : undefined;
}

export async function fetchVllmModels(baseUrl?: string, signal?: AbortSignal): Promise<Model<"openai-completions">[]> {
	const resolvedBaseUrl = resolveVllmBaseUrl(baseUrl).replace(/\/$/, "");
	const res = await fetch(`${resolvedBaseUrl}/models`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`vLLM model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as VllmModelListResponse;
	const list = json.data ?? [];
	return list.map((entry) => createVllmModel(entry.id, baseUrl, vllmContextWindow(entry)));
}

export function vllmProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: vllmAuth() };

	return createProvider({
		id: "vllm",
		name: "vLLM",
		baseUrl: resolveVllmBaseUrl(),
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		fetchModels: async (context) => await fetchVllmModels(undefined, context.signal),
	});
}

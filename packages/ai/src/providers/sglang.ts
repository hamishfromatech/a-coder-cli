import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

const PLACEHOLDER_MODEL: Model<"openai-completions"> = {
	id: "local",
	name: "SGLang: local model",
	api: "openai-completions",
	provider: "sglang",
	baseUrl: "http://localhost:30000/v1",
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

function sglangAuth(): ApiKeyAuth {
	return {
		name: "SGLang",
		resolve: async ({ ctx }) => {
			const baseUrl = await ctx.env("SGLANG_BASE_URL");
			return {
				auth: { apiKey: "not-needed", baseUrl: baseUrl || undefined },
				source: "keyless local server",
			};
		},
	};
}

export interface SgLangModelListItem {
	id: string;
	object?: string;
	/**
	 * Some SGLang versions report the served context window in
	 * `/v1/models`; others omit it and the default applies.
	 */
	max_model_len?: number;
}

export interface SgLangModelListResponse {
	object: "list";
	data: SgLangModelListItem[];
}

const DEFAULT_BASE_URL = "http://localhost:30000/v1";
/** Fallback when the server does not report `max_model_len`. */
const DEFAULT_CONTEXT_WINDOW = 128000;

export function resolveSgLangBaseUrl(override?: string): string {
	if (override) return override;
	if (typeof process !== "undefined" && process.env.SGLANG_BASE_URL) {
		return process.env.SGLANG_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

export function createSgLangModel(id: string, baseUrl?: string, contextWindow?: number): Model<"openai-completions"> {
	const served = contextWindow !== undefined && contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW;
	return {
		id,
		name: `SGLang: ${id}`,
		api: "openai-completions",
		provider: "sglang",
		baseUrl: resolveSgLangBaseUrl(baseUrl),
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
		// SGLang clamps generation to the served context window (prompt +
		// completion share it), so the honest output budget is the served len.
		maxTokens: served,
	};
}

/** The served context window, when the server reports it. */
export function sgLangContextWindow(entry: SgLangModelListItem): number | undefined {
	const len = entry.max_model_len;
	return len !== undefined && len > 0 ? len : undefined;
}

export async function fetchSgLangModels(
	baseUrl?: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	const resolvedBaseUrl = resolveSgLangBaseUrl(baseUrl).replace(/\/$/, "");
	const res = await fetch(`${resolvedBaseUrl}/models`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`SGLang model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as SgLangModelListResponse;
	const list = json.data ?? [];
	return list.map((entry) => createSgLangModel(entry.id, baseUrl, sgLangContextWindow(entry)));
}

export function sgLangProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: sglangAuth() };

	return createProvider({
		id: "sglang",
		name: "SGLang",
		baseUrl: resolveSgLangBaseUrl(),
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		fetchModels: async (context) => await fetchSgLangModels(undefined, context.signal),
	});
}

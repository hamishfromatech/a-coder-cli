import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { defaultProviderAuthContext } from "../auth/context.ts";
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

const DEFAULT_BASE_URL = "http://localhost:1234/v1";

function resolveBaseUrl(): string {
	if (typeof process !== "undefined" && process.env.LM_STUDIO_BASE_URL) {
		return process.env.LM_STUDIO_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

export function createLMStudioModel(id: string): Model<"openai-completions"> {
	return {
		id,
		name: `LM Studio: ${id}`,
		api: "openai-completions",
		provider: "lm-studio",
		baseUrl: resolveBaseUrl(),
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

export async function fetchLMStudioModels(signal?: AbortSignal): Promise<Model<"openai-completions">[]> {
	const baseUrl = resolveBaseUrl().replace(/\/$/, "");
	const res = await fetch(`${baseUrl}/models`, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`LM Studio model refresh failed: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as LMStudioModelListResponse;
	const list = json.data ?? [];
	return list.filter((entry) => entry.id).map((entry) => createLMStudioModel(entry.id));
}

export function lmStudioProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: lmStudioAuth() };
	const baseModel = PLACEHOLDER_MODEL;

	return createProvider({
		id: "lm-studio",
		name: "LM Studio",
		baseUrl: resolveBaseUrl(),
		auth,
		models: [PLACEHOLDER_MODEL],
		api: openAICompletionsApi(),
		refreshModels: async () => {
			// LM Studio is keyless; auth always resolves, so this just validates the
			// local server is reachable before we try to fetch models.
			await auth.apiKey.resolve({ ctx: defaultProviderAuthContext(), model: baseModel });
			return fetchLMStudioModels();
		},
	});
}

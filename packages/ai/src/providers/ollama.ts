import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model, OpenAICompletionsCompat } from "../types.ts";
import {
	fetchOllamaShowCaps,
	type OllamaTagsResponse,
	ollamaNativeOrigin,
	parseContextLengthFromModelInfo,
} from "./ollama-context.ts";

/**
 * Ollama's OpenAI-compatible endpoint maps `reasoning_effort: "none"` to
 * thinking disabled and accepts the other effort levels as thinking on
 * (checked against Ollama 0.40 and ollama.com, 2026-11). Models without the
 * `thinking` capability never receive the parameter because `reasoning` stays
 * false for them.
 */
const OLLAMA_COMPAT: OpenAICompletionsCompat = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: true,
	maxTokensField: "max_tokens",
	supportsStrictMode: false,
	supportsLongCacheRetention: false,
};

const PLACEHOLDER_MODEL: Model<"openai-completions"> = {
	id: "local",
	name: "Ollama: local model",
	api: "openai-completions",
	provider: "ollama",
	baseUrl: "http://localhost:11434/v1",
	compat: { ...OLLAMA_COMPAT },
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

export function createOllamaModel(
	id: string,
	baseUrl?: string,
	contextWindow?: number,
	capabilities?: readonly string[],
): Model<"openai-completions"> {
	const resolvedContextWindow = contextWindow && contextWindow > 0 ? contextWindow : 128000;
	// `:cloud` models run on Ollama's hosted backend — the same servers as the
	// ollama-cloud provider, where the per-model output cap equals the context
	// window (probed 2026-09). The generic local default (4096, Ollama's
	// num_predict fallback) actively truncated these models mid-answer; the API
	// layer still retries without max_tokens if the server rejects the budget.
	const isCloudModel = id.toLowerCase().endsWith(":cloud");
	const maxTokens = isCloudModel ? resolvedContextWindow : 4096;
	// `/api/tags` and `/api/show` report `thinking` for reasoning models. Only
	// enable reasoning when the server says so; older servers omit capabilities.
	const reasoning = capabilities?.includes("thinking") ?? false;
	return {
		id,
		name: `Ollama: ${id}`,
		api: "openai-completions",
		provider: "ollama",
		baseUrl: resolveOllamaBaseUrl(baseUrl),
		compat: { ...OLLAMA_COMPAT },
		reasoning,
		thinkingLevelMap: reasoning ? { off: "none" } : undefined,
		// Kept permissive on purpose: servers that omit `capabilities` would
		// otherwise drop images for models the user knows are vision-capable.
		input: ["text", "image"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: resolvedContextWindow,
		maxTokens,
	};
}

export async function fetchOllamaModels(
	baseUrl?: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	// The local Ollama server serves model tags at the native /api/tags endpoint.
	// The OpenAI-compatible /v1/models list is also available but carries neither
	// context windows nor capabilities. Older servers include model_info on
	// /api/tags; current ones omit it and report capabilities instead, so probe
	// /api/show for whichever signal is missing — mirroring Ollama Cloud.
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

		// /api/tags carries context_length and capabilities on older servers;
		// current ones omit model_info and report capabilities. Probe /api/show
		// whenever either signal is missing (it returns both).
		let contextWindow = parseContextLengthFromModelInfo(tag.model_info);
		let capabilities = tag.capabilities;
		if (!contextWindow || !capabilities) {
			const caps = await fetchOllamaShowCaps(resolvedBaseUrl, name, { signal });
			if (caps) {
				if (!contextWindow && caps.contextWindow && caps.contextWindow > 0) {
					contextWindow = caps.contextWindow;
				}
				capabilities = caps.capabilities ?? capabilities;
			}
		}

		models.push(createOllamaModel(name, baseUrl, contextWindow, capabilities));
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
		fetchModels: async (context) => await fetchOllamaModels(undefined, context.signal),
	});
}

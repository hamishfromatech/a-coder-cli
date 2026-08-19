import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { defaultProviderAuthContext } from "../auth/context.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { OLLAMA_CLOUD_MODELS } from "./ollama-cloud.models.ts";
import { fetchOllamaContextWindow } from "./ollama-context.ts";

export interface OllamaCloudTagsModel {
	name: string;
	model: string;
	modified_at: string;
	size: number;
	digest: string;
	details: {
		parent_model: string;
		format: string;
		family: string;
		families: string[] | null;
		parameter_size: string;
		quantization_level: string;
	};
	capabilities?: string[];
	model_info?: Record<string, unknown>;
}

export interface OllamaCloudTagsResponse {
	models: OllamaCloudTagsModel[];
}

/** Parse the largest `*.context_length` value from Ollama model_info metadata. */
export function parseContextLengthFromModelInfo(modelInfo: Record<string, unknown> | undefined): number | undefined {
	if (!modelInfo) return undefined;
	let value: number | undefined;
	for (const [key, raw] of Object.entries(modelInfo)) {
		if (!key.endsWith(".context_length")) continue;
		const n = typeof raw === "number" ? raw : Number(raw);
		if (Number.isFinite(n) && n > 0 && (value === undefined || n > value)) {
			value = n;
		}
	}
	return value;
}

export async function resolveOllamaCloudModelCaps(
	id: string,
	apiKey: string,
	signal?: AbortSignal,
): Promise<Pick<Model<"openai-completions">, "contextWindow"> | undefined> {
	const contextWindow = await fetchOllamaContextWindow("https://ollama.com/v1", id, {
		apiKey,
		signal,
		timeoutMs: 8000,
	});
	if (!contextWindow || contextWindow <= 0) return undefined;
	return { contextWindow };
}

export function createOllamaCloudModel(
	id: string,
	caps?: { contextWindow?: number; maxTokens?: number; vision?: boolean },
): Model<"openai-completions"> {
	const isKimi = id.toLowerCase().includes("kimi");
	const defaultContextWindow = isKimi ? 1048576 : 128000;
	const contextWindow = caps?.contextWindow && caps.contextWindow > 0 ? caps.contextWindow : defaultContextWindow;
	// Ollama Cloud's /api/show returns context_length (input + output budget),
	// not the model's output-token cap. Keep a generous default maxTokens and
	// only let an explicit cap override it.
	const defaultMaxTokens = isKimi ? 131072 : 131072;
	const maxTokens =
		caps?.maxTokens && caps.maxTokens > 0 && caps.maxTokens <= contextWindow ? caps.maxTokens : defaultMaxTokens;
	return {
		id,
		name: `Ollama Cloud: ${id}`,
		api: "openai-completions",
		provider: "ollama-cloud",
		baseUrl: "https://ollama.com/v1",
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			supportsStrictMode: false,
			supportsLongCacheRetention: false,
		},
		reasoning: false,
		input: caps?.vision ? ["text", "image"] : ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow,
		maxTokens,
	};
}

export async function fetchOllamaCloudModels(
	apiKey: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	// Ollama Cloud serves model tags at the native /api/tags endpoint. The
	// OpenAI-compatible /v1/models list is also available but doesn't carry
	// context windows, so we prefer /api/tags and fill in details from
	// /api/show when the server exposes them.
	const tagsRes = await fetch("https://ollama.com/api/tags", {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			accept: "application/json",
		},
		signal,
	});
	if (!tagsRes.ok) {
		throw new Error(`Ollama Cloud model refresh failed: ${tagsRes.status} ${tagsRes.statusText}`);
	}
	const tagsJson = (await tagsRes.json()) as OllamaCloudTagsResponse;
	const tags = tagsJson.models ?? [];

	const models: Model<"openai-completions">[] = [];
	for (const tag of tags) {
		const name = tag.name || tag.model;
		if (!name) continue;

		// Start with whatever /api/tags already tells us.
		const contextWindow = parseContextLengthFromModelInfo(tag.model_info);
		const vision = tag.capabilities?.includes("vision") ?? false;
		const base = createOllamaCloudModel(name, {
			contextWindow,
			vision,
		});

		// Probe /api/show for a more accurate context window when /api/tags
		// didn't include model_info or omitted context_length.
		if (!contextWindow) {
			const caps = await resolveOllamaCloudModelCaps(name, apiKey, signal);
			if (caps) {
				base.contextWindow = caps.contextWindow;
			}
		}

		models.push(base);
	}
	return models;
}

export function ollamaCloudProvider(): Provider<"openai-completions"> {
	const auth = { apiKey: envApiKeyAuth("Ollama Cloud API key", ["OLLAMA_API_KEY"]) };
	const baseModel = Object.values(OLLAMA_CLOUD_MODELS)[0] ?? createOllamaCloudModel("llama3.3");

	return createProvider({
		id: "ollama-cloud",
		name: "Ollama Cloud",
		baseUrl: "https://ollama.com/v1",
		auth,
		models: Object.values(OLLAMA_CLOUD_MODELS),
		api: openAICompletionsApi(),
		refreshModels: async () => {
			const resolved = await auth.apiKey.resolve({
				ctx: defaultProviderAuthContext(),
				model: baseModel,
			});
			const apiKey = resolved?.auth.apiKey;
			if (!apiKey) {
				throw new Error("Ollama Cloud API key not configured");
			}
			return fetchOllamaCloudModels(apiKey);
		},
	});
}

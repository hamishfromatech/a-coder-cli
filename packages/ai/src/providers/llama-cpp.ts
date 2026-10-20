import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { ChatTemplateKwargValue, Model, OpenAICompletionsCompat, ThinkingLevelMap } from "../types.ts";

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
	input: ["text"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 128000,
	maxTokens: 128000,
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

/** Jinja template capabilities reported by GET /props. */
export interface LlamaCppChatTemplateCaps {
	supports_tools?: boolean;
	supports_tool_calls?: boolean;
	supports_system_role?: boolean;
	supports_parallel_tool_calls?: boolean;
	supports_preserve_reasoning?: boolean;
	supports_reasoning_effort?: boolean;
	supports_string_content?: boolean;
	supports_typed_content?: boolean;
	supports_object_arguments?: boolean;
}

export interface LlamaCppGenerationSettings {
	n_ctx?: number;
	n_ctx_train?: number;
	params?: Record<string, unknown>;
}

/** Subset of GET /props used by the model picker and request builder. */
export interface LlamaCppProps {
	build_info?: string;
	model_path?: string;
	total_slots?: number;
	is_sleeping?: boolean;
	chat_template?: string;
	chat_template_caps?: LlamaCppChatTemplateCaps;
	modalities?: {
		vision?: boolean;
		audio?: boolean;
	};
	default_generation_settings?: LlamaCppGenerationSettings;
}

export type LlamaCppReasoningFormat = "effort" | "enable-thinking" | "thinking" | "none";

export interface LlamaCppCapabilities {
	vision: boolean;
	reasoning: boolean;
	reasoningFormat: LlamaCppReasoningFormat;
	thinkingFormat?: "llama-cpp" | "chat-template";
	chatTemplateKwargs?: Record<string, ChatTemplateKwargValue>;
	thinkingLevelMap?: ThinkingLevelMap;
	supportsReasoningEffort: boolean;
	supportsTools: boolean;
	supportsPreserveReasoning: boolean;
	contextWindow?: number;
}

export interface LlamaCppServerInfo {
	baseUrl: string;
	props: LlamaCppProps;
	capabilities: LlamaCppCapabilities;
}

const DEFAULT_BASE_URL = "http://localhost:8080/v1";

/**
 * llama.cpp accepts all standard effort names. `none` is the special
 * OpenAI-compatible value that disables reasoning in llama-server.
 */
const EFFORT_LEVEL_MAP: ThinkingLevelMap = {
	off: "none",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

/**
 * Templates that only expose a boolean get one meaningful "on" level. Hiding
 * the other levels keeps the CLI cycle and desktop picker honest.
 */
const BOOLEAN_LEVEL_MAP: ThinkingLevelMap = {
	off: "off",
	minimal: null,
	low: "low",
	medium: null,
	high: null,
	xhigh: null,
	max: null,
};

export function resolveLlamaCppBaseUrl(override?: string): string {
	if (override) return override;
	if (typeof process !== "undefined" && process.env.LLAMACPP_BASE_URL) {
		return process.env.LLAMACPP_BASE_URL;
	}
	return DEFAULT_BASE_URL;
}

/** `/props` lives at the server root, not under `/v1`. */
export function resolveLlamaCppPropsUrl(baseUrl?: string): string {
	const resolved = resolveLlamaCppBaseUrl(baseUrl).replace(/\/+$/, "");
	return `${resolved.replace(/\/v1$/, "")}/props`;
}

function templateHasWord(template: string, word: string): boolean {
	return new RegExp(`\\b${word}\\b`).test(template);
}

/** A bare `thinking` variable inside a Jinja expression, not prose or `thinking_budget`. */
function templateHasThinkingVariable(template: string): boolean {
	return /\{\{[^}]*\bthinking\b(?!_)[^}]*\}\}|\{%[^%]*\bthinking\b(?!_)[^%]*%\}/.test(template);
}

/**
 * Derive reasoning controls from llama.cpp's own template metadata. This is
 * deliberately conservative: only models whose template or caps advertise a
 * thinking control become reasoning models.
 */
export function detectLlamaCppCapabilities(props?: LlamaCppProps | undefined): LlamaCppCapabilities {
	const caps = props?.chat_template_caps ?? {};
	const template = props?.chat_template ?? "";
	const supportsReasoningEffort =
		caps.supports_reasoning_effort === true || templateHasWord(template, "reasoning_effort");
	const hasEnableThinking = templateHasWord(template, "enable_thinking");
	const hasThinkingVariable = templateHasThinkingVariable(template);
	const supportsPreserveReasoning =
		caps.supports_preserve_reasoning === true || templateHasWord(template, "preserve_thinking");

	const reasoning = supportsReasoningEffort || hasEnableThinking || hasThinkingVariable;

	let reasoningFormat: LlamaCppReasoningFormat = "none";
	let thinkingFormat: LlamaCppCapabilities["thinkingFormat"];
	let chatTemplateKwargs: Record<string, ChatTemplateKwargValue> | undefined;
	let thinkingLevelMap: ThinkingLevelMap | undefined;

	if (supportsReasoningEffort) {
		reasoningFormat = "effort";
		thinkingFormat = "llama-cpp";
		thinkingLevelMap = EFFORT_LEVEL_MAP;
		chatTemplateKwargs = {
			...(hasEnableThinking ? { enable_thinking: { $var: "thinking.enabled" as const } } : {}),
			...(supportsPreserveReasoning ? { preserve_thinking: true } : {}),
		};
	} else if (hasEnableThinking) {
		reasoningFormat = "enable-thinking";
		thinkingFormat = "chat-template";
		thinkingLevelMap = BOOLEAN_LEVEL_MAP;
		chatTemplateKwargs = { enable_thinking: { $var: "thinking.enabled" } };
	} else if (hasThinkingVariable) {
		reasoningFormat = "thinking";
		thinkingFormat = "chat-template";
		thinkingLevelMap = BOOLEAN_LEVEL_MAP;
		chatTemplateKwargs = { thinking: { $var: "thinking.enabled" } };
	}

	return {
		// Older llama.cpp builds do not expose /props. Without modality metadata,
		// assume text so a text-only model never advertises image input falsely.
		vision: props?.modalities?.vision === true,
		reasoning,
		reasoningFormat,
		thinkingFormat,
		chatTemplateKwargs:
			chatTemplateKwargs && Object.keys(chatTemplateKwargs).length > 0 ? chatTemplateKwargs : undefined,
		thinkingLevelMap,
		supportsReasoningEffort,
		supportsTools:
			caps.supports_tools === true || caps.supports_tool_calls === true || templateHasWord(template, "tools"),
		supportsPreserveReasoning,
		contextWindow: props?.default_generation_settings?.n_ctx,
	};
}

export function createLlamaCppModel(
	id: string,
	baseUrl?: string,
	contextWindow?: number,
	props?: LlamaCppProps,
): Model<"openai-completions"> {
	const capabilities = detectLlamaCppCapabilities(props);
	const resolvedContextWindow =
		contextWindow !== undefined && contextWindow > 0
			? contextWindow
			: capabilities.contextWindow !== undefined && capabilities.contextWindow > 0
				? capabilities.contextWindow
				: 128000;
	const compat: OpenAICompletionsCompat = {
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: capabilities.supportsReasoningEffort,
		maxTokensField: "max_tokens",
		supportsStrictMode: false,
		supportsLongCacheRetention: false,
		...(capabilities.thinkingFormat ? { thinkingFormat: capabilities.thinkingFormat } : {}),
		...(capabilities.chatTemplateKwargs ? { chatTemplateKwargs: capabilities.chatTemplateKwargs } : {}),
		...(capabilities.reasoning ? { thinkingTokenBudgetField: "thinking_budget_tokens" as const } : {}),
	};

	return {
		id,
		name: `llama.cpp: ${id}`,
		api: "openai-completions",
		provider: "llama-cpp",
		baseUrl: resolveLlamaCppBaseUrl(baseUrl),
		compat,
		reasoning: capabilities.reasoning,
		thinkingLevelMap: capabilities.thinkingLevelMap,
		input: capabilities.vision ? ["text", "image"] : ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: resolvedContextWindow,
		maxTokens: Math.min(128000, resolvedContextWindow),
	};
}

/** The server's loaded context first, the model's trained context second. */
export function llamaCppContextWindow(entry: LlamaCppModelListItem, props?: LlamaCppProps): number | undefined {
	const served = entry.meta?.n_ctx ?? props?.default_generation_settings?.n_ctx;
	if (served !== undefined && served > 0) return served;
	const trained = entry.meta?.n_ctx_train;
	return trained !== undefined && trained > 0 ? trained : undefined;
}

export async function fetchLlamaCppProps(baseUrl?: string, signal?: AbortSignal): Promise<LlamaCppProps> {
	const res = await fetch(resolveLlamaCppPropsUrl(baseUrl), {
		headers: { accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`llama.cpp /props failed: ${res.status} ${res.statusText}`);
	}
	return (await res.json()) as LlamaCppProps;
}

export async function fetchLlamaCppServerInfo(baseUrl?: string, signal?: AbortSignal): Promise<LlamaCppServerInfo> {
	const resolvedBaseUrl = resolveLlamaCppBaseUrl(baseUrl).replace(/\/$/, "");
	const props = await fetchLlamaCppProps(resolvedBaseUrl, signal);
	return {
		baseUrl: resolvedBaseUrl,
		props,
		capabilities: detectLlamaCppCapabilities(props),
	};
}

export async function fetchLlamaCppModels(
	baseUrl?: string,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	const resolvedBaseUrl = resolveLlamaCppBaseUrl(baseUrl).replace(/\/$/, "");
	const [modelsRes, props] = await Promise.all([
		fetch(`${resolvedBaseUrl}/models`, {
			headers: { accept: "application/json" },
			signal,
		}),
		// /props is optional: older llama.cpp builds return 404.
		fetchLlamaCppProps(resolvedBaseUrl, signal).catch(() => undefined),
	]);
	if (!modelsRes.ok) {
		throw new Error(`llama.cpp model refresh failed: ${modelsRes.status} ${modelsRes.statusText}`);
	}
	const json = (await modelsRes.json()) as LlamaCppModelListResponse;
	const list = json.data ?? [];
	return list
		.filter((entry) => entry.id)
		.map((entry) =>
			createLlamaCppModel(
				entry.id,
				baseUrl,
				llamaCppContextWindow(entry, props) ?? detectLlamaCppCapabilities(props).contextWindow,
				props,
			),
		);
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
		fetchModels: async (context) => await fetchLlamaCppModels(undefined, context.signal),
	});
}

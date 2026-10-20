/**
 * Static decision-model rows plus the System One provider family.
 *
 * Cloud rows are sourced from the providers' published endpoint listings
 * (Jev via OpenRouter: $0.042/M prompt, $0 completion, 32k max prompt within a
 * 64k tokenizer window). Local rows are keyless, mirroring the chat-side
 * local-server providers (lm-studio.ts, llama-cpp.ts, ollama.ts): the auth
 * resolver honors per-server `<SERVER>_BASE_URL` env overrides, defaults to
 * "not-needed" for the key, and missing servers simply fail decisions — the
 * rows stay listed so `/decide` surfaces and settings can name targets.
 */

import { systemoneDecisionsApi } from "../../api/systemone.lazy.ts";
import { envApiKeyAuth } from "../../auth/helpers.ts";
import type { ProviderAuth } from "../../auth/types.ts";
import { createDecisionsProvider, type DecisionsProvider } from "../../decisions-models.ts";
import type { DecisionsModel } from "../../types.ts";
import { resolveOllamaBaseUrl } from "../ollama.ts";
import {
	type OllamaTagsModel,
	type OllamaTagsResponse,
	ollamaNativeOrigin,
	parseContextLengthFromModelInfo,
} from "../ollama-context.ts";

/** Local decision-model families currently shipped across the keyless hosts. */
export const LOCAL_DECISION_MODELS = [
	"clef-flash",
	"clef",
	"nimble",
	"nimble-v3",
	"tev1",
	"pplx-decider",
	"strands-decider",
	"kev",
	"laya",
] as const;

function localModels(providerId: string, defaultBaseUrl: string): DecisionsModel<"systemone">[] {
	const vision: ("text" | "image")[] = ["text", "image"];
	return [
		{
			id: "clef-flash",
			name: "Clef Flash (9B decision model, vision)",
			api: "systemone",
			provider: providerId,
			baseUrl: defaultBaseUrl,
			contextWindow: 64000,
			input: vision,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
		{
			id: "clef",
			name: "Clef (27B decision model, vision)",
			api: "systemone",
			provider: providerId,
			baseUrl: defaultBaseUrl,
			contextWindow: 64000,
			input: vision,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
		{
			id: "nimble",
			name: "Nimble (decision model)",
			api: "systemone",
			provider: providerId,
			baseUrl: defaultBaseUrl,
			contextWindow: 32000,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
	];
}

const DEFAULT_DECISION_CONTEXT = 32768;

function createLocalDecisionModel(
	providerId: string,
	baseUrl: string,
	tag: OllamaTagsModel,
): DecisionsModel<"systemone"> {
	const id = tag.name.replace(/:latest$/, "");
	const caps = tag.capabilities ?? [];
	const contextWindow =
		parseContextLengthFromModelInfo(tag.model_info) ??
		(tag.details as { context_length?: number }).context_length ??
		(id.startsWith("clef") ? 64000 : DEFAULT_DECISION_CONTEXT);
	return {
		id,
		name: `${tag.name} (decision${caps.includes("vision") ? ", vision" : ""})`,
		api: "systemone",
		provider: providerId,
		baseUrl,
		contextWindow,
		input: caps.includes("vision") ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

/**
 * Discover decision-capable models actually installed on an Ollama server.
 * `/api/tags` is the only local endpoint that advertises capabilities before a
 * model is loaded, so it is the source of truth for which pulled models can
 * serve `/v1/systemone`.
 */
export async function fetchOllamaDecisionModels(
	baseUrl = resolveOllamaBaseUrl(),
	signal?: AbortSignal,
): Promise<DecisionsModel<"systemone">[]> {
	const origin = ollamaNativeOrigin(baseUrl);
	if (!origin) return [];
	const res = await fetch(`${origin}/api/tags`, {
		headers: { accept: "application/json" },
		signal: signal ?? AbortSignal.timeout(3000),
	});
	if (!res.ok) throw new Error(`Ollama decision model refresh failed: ${res.status} ${res.statusText}`);
	const json = (await res.json()) as OllamaTagsResponse;
	const seen = new Set<string>();
	const models: DecisionsModel<"systemone">[] = [];
	for (const tag of json.models ?? []) {
		if (!tag.name || !tag.capabilities?.includes("decision")) continue;
		const model = createLocalDecisionModel("ollama", baseUrl, tag);
		if (seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
	}
	return models;
}

function jevModel(
	id: string,
	name: string,
	provider: "typesafe" | "openrouter",
	baseUrl: string,
	systemonePath?: string,
): DecisionsModel<"systemone"> {
	return {
		id,
		name,
		api: "systemone",
		provider,
		baseUrl,
		...(systemonePath ? { systemonePath } : {}),
		contextWindow: 32000,
		input: ["text"],
		cost: { input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

/** TypeSafe direct is early access behind a waitlist; the OpenRouter beta rows
 * are the documented stable route for Jev today. */
export function typesafeDecisionsProvider(): DecisionsProvider {
	return createDecisionsProvider({
		id: "typesafe",
		name: "TypeSafe (System One)",
		auth: { apiKey: envApiKeyAuth("TypeSafe API key", ["TYPESAFE_API_KEY"]) },
		models: [
			jevModel("jev-latest", "Jev (latest)", "typesafe", "https://api.typesafe.ai/v1"),
			jevModel("jev-1.13", "Jev 1.13", "typesafe", "https://api.typesafe.ai/v1"),
		],
		api: systemoneDecisionsApi(),
	});
}

export function openrouterDecisionsProvider(): DecisionsProvider {
	return createDecisionsProvider({
		id: "openrouter",
		name: "OpenRouter (System One beta)",
		auth: { apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]) },
		models: [
			jevModel(
				"~typesafe/jev-latest",
				"Jev (latest, beta)",
				"openrouter",
				"https://openrouter.ai/api",
				"/alpha/decisions",
			),
			jevModel(
				"typesafe/jev-1.13",
				"Jev 1.13 (beta)",
				"openrouter",
				"https://openrouter.ai/api",
				"/alpha/decisions",
			),
		],
		api: systemoneDecisionsApi(),
	});
}

interface LocalServerSpec {
	/** Provider id: matches the chat-side local provider so auth/env conventions carry over. */
	id: string;
	name: string;
	defaultBaseUrl: string;
	envVar: string;
}

export const LOCAL_DECISION_SERVERS: LocalServerSpec[] = [
	{ id: "ollama", name: "Ollama", defaultBaseUrl: "http://localhost:11434/v1", envVar: "OLLAMA_BASE_URL" },
	{ id: "lm-studio", name: "LM Studio", defaultBaseUrl: "http://localhost:1234/v1", envVar: "LM_STUDIO_BASE_URL" },
	{ id: "llama-cpp", name: "llama.cpp", defaultBaseUrl: "http://localhost:8080/v1", envVar: "LLAMACPP_BASE_URL" },
	{ id: "unsloth", name: "Unsloth", defaultBaseUrl: "http://localhost:8888/v1", envVar: "UNSLOTH_BASE_URL" },
];

function keylessLocalAuth(server: LocalServerSpec): ProviderAuth {
	return {
		apiKey: {
			name: server.name,
			resolve: async ({ ctx }) => {
				const baseUrl = await ctx.env(server.envVar);
				return {
					auth: { apiKey: "not-needed", baseUrl: baseUrl || undefined },
					source: "keyless local server",
				};
			},
		},
	};
}

/** One provider per keyless local host that now speaks the System One wire. */
export function localDecisionsProviders(): DecisionsProvider[] {
	return LOCAL_DECISION_SERVERS.map((server) =>
		createDecisionsProvider({
			id: server.id,
			name: `${server.name} (System One)`,
			auth: keylessLocalAuth(server),
			models: localModels(server.id, server.defaultBaseUrl),
			api: systemoneDecisionsApi(),
			...(server.id === "ollama"
				? {
						refreshModels: async () => {
							const refreshed = await fetchOllamaDecisionModels(resolveOllamaBaseUrl());
							// Keep the static rows when the server is reachable but has no
							// decision models installed; a later refresh can still find one.
							return refreshed.length > 0 ? refreshed : localModels(server.id, server.defaultBaseUrl);
						},
					}
				: {}),
		}),
	);
}

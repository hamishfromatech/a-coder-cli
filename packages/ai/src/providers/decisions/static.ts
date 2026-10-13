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

/** Local decision-model families currently shipped across the keyless hosts. */
export const LOCAL_DECISION_MODELS = ["clef-flash", "clef", "nimble"] as const;

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
		}),
	);
}

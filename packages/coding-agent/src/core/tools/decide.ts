/**
 * `decide` tool: runs a set of named questions against a System One decision
 * model (Jev via TypeSafe/OpenRouter, or a local Clef/Nimble through Ollama,
 * LM Studio, llama.cpp, Unsloth). One non-autoregressive scoring pass returns
 * typed answers with probabilities; read-only and approval-free.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
	DecisionResult,
	DecisionsContext,
	DecisionsModel,
	DecisionUsage,
	TextContent,
} from "@earendil-works/pi-ai";
import type { DecisionsModels } from "@earendil-works/pi-ai/compat";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

/** Policy cap below the wire's 64-question max: keeps requests within every
 * host's payload budget and results renderable. */
export const DECIDE_MAX_QUESTIONS = 16;

const questionUnion = Type.Union([
	Type.Object(
		{
			type: Type.Literal("choice"),
			instructions: Type.String(),
			criteria: Type.Record(Type.String(), Type.String()),
		},
		{ description: "Pick one option; every option gets a probability." },
	),
	Type.Object(
		{
			type: Type.Literal("noul"),
			instructions: Type.String(),
			criteria: Type.Optional(Type.Record(Type.String(), Type.String())),
		},
		{ description: "Bare true/false judgment; noul value 0..1 scores agreement." },
	),
	Type.Object(
		{
			type: Type.Literal("score"),
			instructions: Type.String(),
			criteria: Type.Array(Type.String(), { minItems: 1 }),
		},
		{ description: "Score against the ordered legend (0..n-1). " },
	),
]);

const decideSchema = Type.Object(
	{
		state: Type.Union([Type.String(), Type.Record(Type.String(), Type.Unknown())], {
			description:
				"The text (or a JSON object serialized as text) to judge. Not chat messages: put the whole context to be scored here.",
		}),
		questions: Type.Record(Type.String(), questionUnion, {
			description:
				"Named questions about the shared state. 1-16 questions. Answers are not passed into later questions.",
		}),
		provider: Type.Optional(
			Type.String({ description: "Decision provider override (e.g. ollama, openrouter, typesafe)." }),
		),
		model: Type.Optional(
			Type.String({ description: "Decision model id override (e.g. clef-flash, ~typesafe/jev-latest)." }),
		),
	},
	{ additionalProperties: false },
);

export type DecideToolInput = Static<typeof decideSchema>;

export interface DecideToolOptions {
	/** Pre-built decisions collection (tests inject one here). */
	models?: DecisionsModels;
	/** settings.decisions provider/model pick. */
	settings?: { provider?: string; model?: string };
}

/** Probe keyless local servers cheaply for a decision model to use. */
async function resolveLocalModel(
	models: DecisionsModels,
	signal?: AbortSignal,
): Promise<DecisionsModel<any> | undefined> {
	for (const provider of models.getProviders()) {
		const candidates = models.getModels(provider.id);
		if (candidates.length === 0) continue;
		const resolution = await models.getAuth(provider.id);
		const baseUrl = resolution?.auth.baseUrl ?? candidates[0].baseUrl;
		if (!baseUrl) continue;
		try {
			const probe = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/models`, {
				signal: AbortSignal.timeout(1500),
				...(signal ? { signal } : {}),
			});
			if (!probe.ok) continue;
			const list = (await probe.json()) as { data?: { id?: string }[] };
			for (const model of candidates) {
				if (list.data?.some((entry) => entry.id === model.id || entry.id?.startsWith(`${model.id}:`))) {
					return { ...model, baseUrl: String(baseUrl) };
				}
			}
		} catch {
			// Server absent/slow — try the next one.
		}
	}
	return undefined;
}

export async function resolveDecideModel(
	models: DecisionsModels,
	input: DecideToolInput,
	options?: DecideToolOptions,
	signal?: AbortSignal,
): Promise<DecisionsModel<any>> {
	const wantedProvider = input.provider ?? options?.settings?.provider;
	const wantedModel = input.model ?? options?.settings?.model;

	if (wantedProvider && wantedModel) {
		const model = models.getModel(wantedProvider, wantedModel);
		if (!model) {
			throw new Error(
				`Decision model not found: ${wantedProvider}/${wantedModel}. Known: ${models
					.getModels()
					.map((m) => `${m.provider}/${m.id}`)
					.join(", ")}`,
			);
		}
		return model;
	}

	if (wantedProvider || wantedModel) {
		const model = models
			.getModels()
			.find((m) => (wantedProvider ? m.provider === wantedProvider : false) || m.id === wantedModel);
		if (!model) {
			throw new Error(`Decision model not found: ${wantedProvider ?? wantedModel}`);
		}
		return model;
	}

	// Prefer the keyless local server that is actually running.
	const local = await resolveLocalModel(models, signal);
	if (local) return local;

	// Fall back to OpenRouter when a key is configured.
	const openrouterModel = models.getModel("openrouter", "~typesafe/jev-latest") ?? models.getModels("openrouter")[0];
	if (openrouterModel) {
		const auth = await models.getAuth(openrouterModel).catch(() => undefined);
		if (auth?.auth.apiKey) return openrouterModel;
	}

	throw new Error(
		"No decision model available. Start a local System One server (e.g. `ollama pull clef-flash`), or set OPENROUTER_API_KEY for the Jev beta, or configure settings.decisions { provider, model }.",
	);
}

export function formatDecisionResult(result: DecisionResult): string {
	if (result.stopReason === "error") {
		return `decide failed: ${result.errorMessage ?? "unknown error"}`;
	}
	const usage: DecisionUsage | undefined = result.usage;
	const lines = Object.entries(result.answers).map(([name, answer]) => {
		switch (answer.type) {
			case "choice": {
				const p = answer.probabilities?.[answer.choice];
				return `${name}: ${answer.choice}${typeof p === "number" ? ` p=${p}` : ""}`;
			}
			case "noul":
				return `${name}: noul=${answer.noul}`;
			default:
				return `${name}: score=${answer.score}`;
		}
	});
	const served = result.servedModel && result.servedModel !== result.model ? ` (served: ${result.servedModel})` : "";
	return [
		`Decision model ${result.model}${served} answered in ${Math.round(result.durationMs ?? 0)}ms:`,
		...lines,
		usage
			? `Usage: ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out${typeof usage.cost === "number" ? `, cost $${usage.cost}` : ""}`
			: "",
		JSON.stringify(result.answers),
	]
		.filter(Boolean)
		.join("\n");
}

function probabilityBar(value: number | undefined, theme: Theme): string {
	if (typeof value !== "number") return "";
	const filled = Math.max(0, Math.min(10, Math.round(value * 10)));
	return theme.fg("accent", `${"●".repeat(filled)}${"○".repeat(10 - filled)} `);
}

export interface DecideToolDefinitionContext {
	models?: DecisionsModels;
	settings?: { provider?: string; model?: string };
}

/** Details carried on every `decide` tool result. */
export interface DecideDetails {
	result?: DecisionResult;
	model?: string;
}

export function createDecideToolDefinition(
	context?: DecideToolDefinitionContext,
): ToolDefinition<typeof decideSchema, DecideDetails> {
	return {
		name: "decide",
		label: "decide",
		description:
			"Ask a System One decision model to answer named questions about a state — routing choices, true/false conditions (noul), or progress scores. The decision model is very fast and cheap (or free locally) but non-generative: it can only score typed questions, never explain or write. Use it to offload judgments (which option applies? is X failing? how far along is the task?) instead of burning a full LLM call.",
		promptSnippet: "Offload typed judgments to a System One decision model",
		promptGuidelines: [
			"Use for crisp judgments with enumerable answers — not for open-ended reasoning or text generation.",
			"Put everything to be judged into `state` (text or a compact JSON object); reference prior tool results by summarizing, the model cannot fetch them.",
			"Keep questions concrete and mutually exclusive; prefer one `choice` question per decision.",
		],
		parameters: decideSchema,
		async execute(_toolCallId, params: DecideToolInput, signal, _onUpdate, _rawContext?: ExtensionContext) {
			const questionCount = Object.keys(params.questions ?? {}).length;
			if (questionCount < 1 || questionCount > DECIDE_MAX_QUESTIONS) {
				throw new Error(`decide requires 1-${DECIDE_MAX_QUESTIONS} questions, got ${questionCount}`);
			}
			const models = context?.models ?? (await import("@earendil-works/pi-ai/compat")).builtinDecisionsModels();
			const model = await resolveDecideModel(models, params, context, signal);
			let state: string | object = params.state;
			if (typeof state !== "string") state = JSON.stringify(state);
			const decisionContext: DecisionsContext = { state, questions: params.questions };
			const result = await models.postDecisions(model, decisionContext, {
				...(signal ? { signal } : {}),
			});
			if (result.stopReason !== "stop") {
				throw new Error(result.errorMessage ?? "decide failed");
			}
			return {
				content: [{ type: "text", text: formatDecisionResult(result) } as TextContent],
				details: { result, model: model.id } satisfies DecideDetails,
			};
		},
		renderCall(args, theme, _renderContext) {
			const text = new Text("", 0, 0);
			const count = args?.questions ? Object.keys(args.questions).length : 0;
			text.setText(
				`${theme.fg("toolTitle", theme.bold("decide"))} ${theme.fg("accent", `${count} question${count === 1 ? "" : "s"}`)}`,
			);
			return text;
		},
		renderResult(result, _options, theme, _renderContext) {
			const text = new Text("", 0, 0);
			const output = result.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			const details = (result as { details?: DecideDetails }).details;
			const model = details?.result ? theme.fg("toolTitle", details.model ?? "") : "";
			const pretty = details?.result
				? Object.entries(details.result.answers)
						.map(([name, answer]) => {
							if (answer.type === "choice") {
								const p = answer.probabilities?.[answer.choice];
								return `${name}: ${probabilityBar(p, theme)}${answer.choice}${typeof p === "number" ? ` ${theme.fg("toolOutput", `p=${p}`)}` : ""}`;
							}
							if (answer.type === "noul") {
								return `${name}: ${probabilityBar(answer.noul, theme)}${theme.fg("toolOutput", `noul=${answer.noul}`)}`;
							}
							return `${name}: ${theme.fg("toolOutput", `score=${answer.score}`)}`;
						})
						.join("\n")
				: output;
			text.setText(`${model}\n${theme.fg("toolOutput", pretty)}`.trim());
			return text;
		},
	};
}

export function createDecideTool(context?: DecideToolDefinitionContext): AgentTool<typeof decideSchema, DecideDetails> {
	return wrapToolDefinition(createDecideToolDefinition(context));
}

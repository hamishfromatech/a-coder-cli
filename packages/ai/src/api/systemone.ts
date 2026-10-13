/**
 * System One decision-model wire (`POST {baseUrl}/systemone`, OpenRouter:
 * `POST /api/alpha/decisions`).
 *
 * One request shape everywhere: `{model, state, questions, images?, keep_alive?}`
 * → `{model, answers, usage}`. Decision models are non-generative: a single
 * scoring pass answers the typed questions (`choice` / `noul` / `score`).
 * Hosts known to speak this wire: Ollama, LM Studio, llama.cpp, and Unsloth
 * (keyless, route `/v1/systemone`), TypeSafe direct (`/v1/systemone`, API key),
 * OpenRouter (`/api/alpha/decisions`, OpenRouter key).
 */

import type {
	DecisionAnswer,
	DecisionResult,
	DecisionsContext,
	DecisionsFunction,
	DecisionsModel,
	DecisionsOptions,
	DecisionUsage,
} from "../types.ts";
import { formatProviderError, safeJsonStringify } from "../utils/error-body.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";

/** Largest request body accepted without images on the widest host (Ollama). */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Named questions per request accepted by the widest host (Ollama). */
export const MAX_QUESTIONS = 64;
/** The only answer/question types the wire knows. */
const WIRE_TYPES = new Set(["choice", "noul", "score"]);

type WireQuestion = {
	type: string;
	instructions: string;
	criteria?: Record<string, string | null> | string[];
};

interface SystemOneResponse {
	model?: unknown;
	id?: unknown;
	provider?: unknown;
	answers?: unknown;
	usage?: {
		input_tokens?: unknown;
		output_tokens?: unknown;
		cost?: unknown;
	};
}

/** An HTTP error annotated the way `retryProviderRequest` and
 * `normalizeProviderError` expect, so retries and error bodies work. */
class SystemOneHttpError extends Error {
	status: number;
	headers: Headers;
	body: string;

	constructor(response: Response, body: string) {
		let host = "unknown";
		try {
			host = new URL(response.url).host || "unknown";
		} catch {
			// Opaque/mocked responses may carry an empty URL.
		}
		super(`HTTP ${response.status} for ${host} System One request: ${truncate(body)}`);
		this.name = "SystemOneHttpError";
		this.status = response.status;
		this.headers = response.headers;
		this.body = body;
	}
}

function truncate(text: string, maxChars = 4000): string {
	return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function buildBody(model: DecisionsModel<"systemone">, context: DecisionsContext, options?: DecisionsOptions): string {
	let state = context.state;
	if (typeof state !== "string") {
		state = JSON.stringify(state);
	}
	if (typeof state !== "string" || state.trim().length === 0) {
		throw new Error("System One state must be a non-empty string or serializable object");
	}
	const entries = Object.entries(context.questions);
	const maxQuestions = model.maxQuestions ?? MAX_QUESTIONS;
	if (entries.length < 1 || entries.length > maxQuestions) {
		throw new Error(`System One requires 1-${maxQuestions} questions, got ${entries.length}`);
	}
	const questions: Record<string, WireQuestion> = {};
	for (const [name, question] of entries) {
		if (typeof question.instructions !== "string" || question.instructions.trim().length === 0) {
			throw new Error(`Question "${name}" requires instructions`);
		}
		switch (question.type) {
			case "choice":
				if (!question.criteria || typeof question.criteria !== "object" || Array.isArray(question.criteria)) {
					throw new Error(`Question "${name}" choice requires criteria mapping option names to descriptions`);
				}
				questions[name] = {
					type: "choice",
					instructions: question.instructions,
					criteria: { ...question.criteria },
				};
				break;
			case "noul":
				questions[name] = { type: "noul", instructions: question.instructions };
				if (question.criteria && typeof question.criteria === "object" && !Array.isArray(question.criteria)) {
					questions[name].criteria = { ...question.criteria };
				}
				break;
			case "score":
				if (!Array.isArray(question.criteria) || question.criteria.length === 0) {
					throw new Error(`Question "${name}" score requires a legend array of descriptions`);
				}
				questions[name] = { type: "score", instructions: question.instructions, criteria: [...question.criteria] };
				break;
			default: {
				throw new Error(`Question "${name}" has unknown type: ${String((question as { type: unknown }).type)}`);
			}
		}
	}
	const body: Record<string, unknown> = { model: model.id, state, questions };
	if (context.images?.length) {
		if (!model.input.includes("image")) {
			throw new Error(`Decision model ${model.id} does not accept images`);
		}
		body.images = context.images.map((image) => String(image));
	}
	if (options?.keepAlive !== undefined) body.keep_alive = options.keepAlive;
	return JSON.stringify(body);
}

function parseAnswer(raw: unknown): DecisionAnswer | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const answer = raw as Record<string, unknown>;
	const type = answer.type;
	if (typeof type !== "string" || !WIRE_TYPES.has(type)) return undefined;
	const probabilities = maybeProbabilities(answer.probabilities);
	const confidence = typeof answer.confidence === "number" ? { confidence: answer.confidence } : {};
	switch (type) {
		case "choice":
			if (typeof answer.choice !== "string" || answer.choice.length === 0) return undefined;
			return { type: "choice", choice: answer.choice, ...probabilities, ...confidence };
		case "noul":
			if (typeof answer.noul !== "number") return undefined;
			return { type: "noul", noul: answer.noul, ...probabilities, ...confidence };
		default:
			if (typeof answer.score !== "number") return undefined;
			return {
				type: "score",
				score: answer.score,
				...(typeof answer.legend === "object" && answer.legend !== null && !Array.isArray(answer.legend)
					? { legend: answer.legend as Record<string, string> }
					: {}),
				...probabilities,
				...confidence,
			};
	}
}

function maybeProbabilities(raw: unknown): { probabilities?: Record<string, number> } {
	if (typeof raw !== "object" || raw === null) return {};
	const out: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "number") out[key] = value;
	}
	return Object.keys(out).length > 0 ? { probabilities: out } : {};
}

function parseUsage(raw: SystemOneResponse["usage"]): DecisionUsage | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const usage: DecisionUsage = {};
	if (typeof raw.input_tokens === "number") usage.inputTokens = raw.input_tokens;
	if (typeof raw.output_tokens === "number") usage.outputTokens = raw.output_tokens;
	if (typeof raw.cost === "number") usage.cost = raw.cost;
	return Object.keys(usage).length > 0 ? usage : undefined;
}

function validateAnswers(raw: unknown, requestedNames: string[]): Record<string, DecisionAnswer> {
	if (typeof raw !== "object" || raw === null) {
		throw new Error("System One response missing answers");
	}
	const source = raw as Record<string, unknown>;
	const answers: Record<string, DecisionAnswer> = {};
	for (const name of requestedNames) {
		const answer = parseAnswer(source[name]);
		if (!answer) {
			throw new Error(`System One response missing or malformed answer for "${name}"`);
		}
		answers[name] = answer;
	}
	return answers;
}

/** Every host reports the served model with each answer; only an entirely
 * different model family (jev vs clef vs nimble) indicates a substitution. */
function assertServedModel(model: DecisionsModel<"systemone">, servedModel: unknown): string | undefined {
	if (typeof servedModel !== "string" || servedModel.length === 0) return;
	const family = (id: string): string => id.split("/").pop()!.replace(/^~/, "").split("-")[0].toLowerCase();
	const served = family(servedModel);
	if (served !== family(model.id)) {
		throw new Error(`System One model mismatch: requested ${model.id}, served ${servedModel}`);
	}
	return servedModel;
}

function buildUrl(model: DecisionsModel<"systemone">, options?: DecisionsOptions): string {
	const base = (options?.env?.baseUrlOverride ?? model.baseUrl ?? "").replace(/\/+$/, "");
	if (!base) throw new Error(`No base URL for provider: ${model.provider}`);
	return `${base}${model.systemonePath ?? "/systemone"}`;
}

export const postDecisions: DecisionsFunction<"systemone", DecisionsOptions> = async (
	model: DecisionsModel<"systemone">,
	context: DecisionsContext,
	options?: DecisionsOptions,
) => {
	const result: DecisionResult = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: "stop",
		timestamp: Date.now(),
	};
	const startedAt = performance.now();
	try {
		const body = buildBody(model, context, options);
		if (!context.images?.length && body.length > MAX_PAYLOAD_BYTES) {
			throw new Error(
				`System One request body is ${body.length} bytes; ${MAX_PAYLOAD_BYTES} is the widest host limit without images`,
			);
		}
		const url = buildUrl(model, options);
		if (context.images?.length && !url.startsWith("http")) {
			throw new Error(`Invalid System One endpoint: ${url}`);
		}
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(providerHeadersToRecord({ ...model.headers, ...options?.headers }) ?? {}),
		};
		if (options?.apiKey && options.apiKey !== "not-needed") {
			headers.Authorization = `Bearer ${options.apiKey}`;
		}
		const doFetch = options?.fetch ?? globalThis.fetch;
		const response = await retryProviderRequest(
			async () => {
				const attempt = await doFetch(url, {
					method: "POST",
					headers,
					body,
					...(options?.signal ? { signal: options.signal } : {}),
				});
				// Non-ok must throw INSIDE the retry wrapper so 429/529-style
				// failures (TypeSafe's retry guidance) go through the backoff.
				if (!attempt.ok) {
					throw new SystemOneHttpError(attempt, await attempt.text());
				}
				return attempt;
			},
			{
				maxRetries: options?.maxRetries ?? 2,
				maxRetryDelayMs: options?.maxRetryDelayMs,
				signal: options?.signal,
			},
		);
		await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
		const raw = (await response.json()) as SystemOneResponse;
		result.servedModel = assertServedModel(model, raw.model);
		result.requestId = typeof raw.id === "string" ? raw.id : undefined;
		result.usage = parseUsage(raw.usage);
		result.answers = validateAnswers(raw.answers, Object.keys(context.questions));
		result.durationMs = performance.now() - startedAt;
		return result;
	} catch (error) {
		result.stopReason = options?.signal?.aborted ? "aborted" : "error";
		result.errorMessage =
			error instanceof SystemOneHttpError
				? formatProviderError({
						status: error.status,
						body: error.body,
						message: error.message,
						messageCarriesBody: false,
					})
				: error instanceof Error
					? error.message
					: safeJsonStringify(error);
		result.durationMs = performance.now() - startedAt;
		return result;
	}
};

import type { Api, Model } from "../types.ts";

/**
 * Ollama reports a model's real context length only through the native
 * `/api/show` endpoint — the OpenAI-compatible `/v1/models` endpoint omits it.
 *
 * The `/api/show` response carries two relevant signals:
 *   - `model_info` contains architecture-specific keys such as
 *     `llama.context_length` / `gemma4.context_length` — the model's maximum
 *     context length as baked into the GGUF.
 *   - `parameters` is the Modelfile parameter block as text, which may set
 *     `num_ctx <n>` to override the runtime context window.
 *
 * Effective context window = `num_ctx` when the user set it (they deliberately
 * chose a runtime window), otherwise the architecture `context_length`. We do
 * NOT assume Ollama's tiny built-in default (2048/4096) when `num_ctx` is
 * absent, because that default is not present in the response and a coding
 * agent needs the model's real capacity to size compaction and the usage bar.
 *
 * Reference: https://docs.ollama.com/api-reference/show-model-details
 */

export interface OllamaShowResponse {
	/** Modelfile parameter block, e.g. "temperature 0.7\nnum_ctx 131072". */
	parameters?: string;
	/** Low-level architecture metadata; keys like "<arch>.context_length". */
	model_info?: Record<string, unknown>;
}

/** A minimal model view for Ollama detection. */
type OllamaLikeModel = Pick<Model<Api>, "provider" | "baseUrl">;

/**
 * Derive the native Ollama server origin from a baseUrl.
 * `"http://localhost:11434/v1"` → `"http://localhost:11434"`,
 * `"https://ollama.com/v1"` → `"https://ollama.com"`. Returns undefined for an
 * unparseable URL.
 */
export function ollamaNativeOrigin(baseUrl: string | undefined): string | undefined {
	if (!baseUrl) return undefined;
	try {
		const url = new URL(baseUrl);
		// OpenAI-compatible mounts live under /v1; the native API is at the origin.
		return `${url.protocol}//${url.host}`;
	} catch {
		return undefined;
	}
}

/**
 * True if a model is served by an Ollama server worth probing for a real
 * context window. Conservative: matches the built-in Ollama providers, the
 * default local port 11434, or hosts containing "ollama". Avoids hitting
 * unrelated OpenAI-compatible servers (vLLM, LM Studio, etc.).
 */
export function looksLikeOllama(model: OllamaLikeModel): boolean {
	if (model.provider === "ollama-cloud" || model.provider === "ollama") return true;
	const origin = ollamaNativeOrigin(model.baseUrl);
	if (!origin) return false;
	try {
		const host = new URL(origin).host.toLowerCase();
		if (host === "localhost:11434" || host === "127.0.0.1:11434" || host === "[::1]:11434") return true;
		if (host.endsWith(":11434")) return true;
		if (host.includes("ollama")) return true;
		return false;
	} catch {
		return false;
	}
}

/** Parse an `/api/show` response into an effective context length (tokens). */
export function parseOllamaContextLength(response: OllamaShowResponse): number | undefined {
	const numCtx = parseNumCtxFromParameters(response.parameters);
	if (numCtx !== undefined && numCtx > 0) return numCtx;
	const contextLength = parseContextLengthFromModelInfo(response.model_info);
	if (contextLength !== undefined && contextLength > 0) return contextLength;
	return undefined;
}

function parseNumCtxFromParameters(parameters: string | undefined): number | undefined {
	if (!parameters) return undefined;
	// `num_ctx` may appear anywhere in the block; match the first integer after it.
	const match = parameters.match(/\bnum_ctx\s+(-?\d+)/);
	if (!match) return undefined;
	const n = Number.parseInt(match[1] ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseContextLengthFromModelInfo(modelInfo: Record<string, unknown> | undefined): number | undefined {
	if (!modelInfo) return undefined;
	// Pick the largest `*.context_length` value (vision/audio sub-models can
	// carry their own smaller context_length; the text head is what we want).
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

export interface FetchOllamaContextWindowOptions {
	/** Abort the lookup (e.g. on session teardown). */
	signal?: AbortSignal;
	/** Inject a fetch implementation for tests. Defaults to globalThis.fetch. */
	fetch?: typeof fetch;
	/** Per-request timeout. Defaults to 6s — Ollama /api/show is fast and local. */
	timeoutMs?: number;
	/** Optional API key for authenticated Ollama Cloud /api/show requests. */
	apiKey?: string;
}

/**
 * Fetch the effective context window for an Ollama model via `/api/show`.
 * Best-effort: returns undefined on any network/parse failure so callers can
 * fall back to the static catalog value.
 */
export async function fetchOllamaContextWindow(
	baseUrl: string,
	modelId: string,
	options: FetchOllamaContextWindowOptions = {},
): Promise<number | undefined> {
	const origin = ollamaNativeOrigin(baseUrl);
	if (!origin) return undefined;
	const doFetch = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? 6000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onParentAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onParentAbort, { once: true });
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (options.apiKey) {
		headers.authorization = `Bearer ${options.apiKey}`;
	}
	try {
		const res = await doFetch(`${origin}/api/show`, {
			method: "POST",
			headers,
			body: JSON.stringify({ model: modelId, verbose: true }),
			signal: controller.signal,
		});
		if (!res.ok) return undefined;
		const json = (await res.json()) as OllamaShowResponse;
		return parseOllamaContextLength(json);
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onParentAbort);
	}
}

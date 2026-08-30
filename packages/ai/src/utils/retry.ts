import type { AssistantMessage } from "../types.ts";

/**
 * Extract a provider-requested retry delay (the `Retry-After` / `Retry-After-Ms`
 * HTTP headers, or SDK-specific `retryAfter`/`retryAfterMs` fields) from a
 * thrown provider error, normalized to milliseconds. Returns undefined when
 * the error carries no such hint.
 *
 * Supported value shapes:
 * - `retry-after-ms` header / `retryAfterMs` field: milliseconds number or numeric string
 * - `retry-after` header / `retryAfter` field: seconds number, numeric string, or HTTP-date
 */
export function extractRetryAfterMs(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const source = error as {
		headers?: Headers | Record<string, unknown>;
		$metadata?: { attempts?: unknown };
		$response?: { headers?: unknown };
		retryAfter?: unknown;
		retryAfterMs?: unknown;
	};

	const fromHeaders = readRetryAfterFromHeaders(source.headers);
	if (fromHeaders !== undefined) return fromHeaders;

	const fromResponse = readRetryAfterFromHeaders(source.$response?.headers);
	if (fromResponse !== undefined) return fromResponse;

	if (typeof source.retryAfterMs === "number" && source.retryAfterMs >= 0) {
		return source.retryAfterMs;
	}
	if (typeof source.retryAfterMs === "string") {
		const millis = Number(source.retryAfterMs);
		if (Number.isFinite(millis) && millis >= 0) return millis;
	}
	// OpenAI SDK exposes `error.retryAfter` as a number of milliseconds.
	if (typeof source.retryAfter === "number" && source.retryAfter >= 0) {
		return source.retryAfter;
	}
	return undefined;
}

function readRetryAfterFromHeaders(headers: unknown): number | undefined {
	const get = (name: string): string | undefined => {
		if (headers && typeof (headers as Headers).get === "function") {
			return (headers as Headers).get(name) ?? undefined;
		}
		if (headers && typeof headers === "object") {
			const value = (headers as Record<string, unknown>)[name];
			return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
		}
		return undefined;
	};

	const retryAfterMs = get("retry-after-ms");
	if (retryAfterMs !== undefined) {
		const millis = Number(retryAfterMs);
		if (Number.isFinite(millis) && millis >= 0) return millis;
	}

	const retryAfter = get("retry-after");
	if (retryAfter === undefined) return undefined;
	return parseRetryAfterValue(retryAfter);
}

/**
 * Parse a single `Retry-After` value: seconds or an HTTP-date.
 */
export function parseRetryAfterValue(value: string): number | undefined {
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) {
		const millis = Number(trimmed) * 1000;
		return millis >= 0 ? millis : undefined;
	}
	const date = Date.parse(trimmed);
	if (!Number.isNaN(date)) {
		const delta = date - Date.now();
		return delta >= 0 ? delta : 0;
	}
	return undefined;
}

function buildProviderErrorPattern(patterns: readonly string[]): RegExp {
	return new RegExp(patterns.join("|"), "i");
}

const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
	// OpenCode Go/free-tier limits returned as 429 JSON error types by OpenCode's
	// Zen API. These are subscription/account limits, not transient throttles.
	"GoUsageLimitError",
	"FreeUsageLimitError",

	// OpenCode Go subscription-limit text asks users to enable available-balance
	// usage after rolling/weekly/monthly limits are reached.
	"Monthly usage limit reached",
	"available balance",

	// Generic quota/budget/billing exhaustion. `insufficient_quota` is OpenAI's
	// quota/billing error code; the other strings cover common gateway wording.
	"insufficient_quota",
	"out of budget",
	"quota exceeded",
	"billing",
]);

const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
	// Generic provider load, HTTP status, and server-side transient failures.
	"overloaded",
	"rate.?limit",
	"too many requests",
	"429",
	"500",
	"502",
	"503",
	"504",
	"service.?unavailable",
	"server.?error",
	"internal.?error",

	// Wrapper/provider text for transient upstream failures, including OpenRouter
	// "Provider returned error" responses (#2264).
	"provider.?returned.?error",

	// Network, proxy, and fetch transport failures. This includes OpenAI Codex
	// raw-fetch failures such as "upstream connect", "connection refused", and
	// "reset before headers" (#733), plus OpenRouter connection drops (#3317).
	"network.?error",
	"connection.?error",
	"connection.?refused",
	"connection.?lost",
	"other side closed",
	"fetch failed",
	"upstream.?connect",
	"reset before headers",
	"socket hang up",
	"timed? out",
	"timeout",
	"terminated",

	// WebSocket transports can report close/error text instead of HTTP/fetch text.
	"websocket.?closed",
	"websocket.?error",

	// Premature stream endings from SDKs and transports. Anthropic can throw
	// "stream ended without ..." and "Anthropic stream ended before message_stop"
	// (#4433); Bedrock/Smithy can throw an HTTP/2 no-response error (#3594).
	"ended without",
	"stream ended before message_stop",
	"http2 request did not get a response",

	// Provider-requested retry delay cap failures should flow through the outer
	// retry policy so callers can surface/abort the backoff (#1123).
	"retry delay",

	// Explicit retry guidance emitted mid-stream by OpenAI Responses and Bedrock
	// stream exceptions (#6019).
	"you can retry your request",
	"try your request again",
	"please retry your request",
]);

/**
 * Classifies whether a failed assistant message looks like a transient provider
 * or transport error, so callers can decide if the last assistant turn should be
 * restarted.
 *
 * This does not implement retry policy. Callers should first handle context
 * overflow separately, then apply their own retry budget, backoff, and reporting
 * before restarting the assistant turn.
 */
export function isRetryableAssistantError(message: AssistantMessage): boolean {
	if (message.stopReason !== "error" || !message.errorMessage) return false;
	const errorMessage = message.errorMessage;
	if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage)) return false;
	return RETRYABLE_PROVIDER_ERROR_PATTERN.test(errorMessage);
}

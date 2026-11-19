/**
 * Anthropic usage as it appears on message_start / message_delta, including
 * the optional per-iteration breakdown used by server-tool loops and compaction.
 *
 * The shape follows Anthropic's Messages API (`BetaIterationsUsage`). It is
 * typed loosely so proxies that add or omit fields still fit.
 */
export type AnthropicUsageLike = {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
	iterations?: ReadonlyArray<AnthropicUsageIterationLike> | null;
};

export type AnthropicUsageIterationLike = {
	type?: string | null;
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
};

export type AnthropicUsageComponents = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

function tokensFromParts(
	input: number | null | undefined,
	output: number | null | undefined,
	cacheRead: number | null | undefined,
	cacheWrite: number | null | undefined,
): number {
	return (input || 0) + (output || 0) + (cacheRead || 0) + (cacheWrite || 0);
}

/**
 * Context size for the next request.
 *
 * Top-level `input_tokens` / cache fields are the billed totals. After a
 * server-tool loop they are the sum of every executor step, which can exceed
 * the window even when the live prompt does not. Anthropic documents that the
 * true context window size comes from the last `message` iteration, and that a
 * trailing `compaction` entry must not be used. A terminal `fallback_message`
 * entry replaces `message` for the hop that served the response.
 *
 * Billing keeps using the top-level (summed) component fields.
 */
export function anthropicContextTokens(
	usage: AnthropicUsageLike | undefined,
	fallback: AnthropicUsageComponents,
): number {
	const iterations = usage?.iterations;
	if (Array.isArray(iterations)) {
		for (let i = iterations.length - 1; i >= 0; i--) {
			const iteration = iterations[i];
			if (!iteration) continue;
			if (iteration.type === "message" || iteration.type === "fallback_message") {
				return tokensFromParts(
					iteration.input_tokens,
					iteration.output_tokens,
					iteration.cache_read_input_tokens,
					iteration.cache_creation_input_tokens,
				);
			}
		}
	}
	return tokensFromParts(fallback.input, fallback.output, fallback.cacheRead, fallback.cacheWrite);
}

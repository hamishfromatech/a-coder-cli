import "./providers/decisions/register-builtins.ts";

import { getDecisionsApiProvider } from "./decisions-api-registry.ts";
import type { DecisionResult, DecisionsApi, DecisionsContext, DecisionsModel, DecisionsOptions } from "./types.ts";

function resolveDecisionsApiProvider(api: DecisionsApi) {
	const provider = getDecisionsApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

/**
 * Run one System One decision: `{state, questions}` → typed answers with
 * probabilities. Never rejects; failures resolve to a `DecisionResult`
 * with `stopReason: "error"`.
 */
export async function postDecisions<TApi extends DecisionsApi>(
	model: DecisionsModel<TApi>,
	context: DecisionsContext,
	options?: DecisionsOptions,
): Promise<DecisionResult> {
	const provider = resolveDecisionsApiProvider(model.api);
	return provider.postDecisions(model, context, options);
}

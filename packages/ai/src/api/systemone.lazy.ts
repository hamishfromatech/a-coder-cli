/**
 * Lazy wrapper for the System One decision API. The implementation module
 * loads on the first `postDecisions` call; load failures resolve to an
 * error-shaped `DecisionResult` (never rejects), matching the eager surface.
 */
import type { DecisionResult, DecisionsFunction, DecisionsModel } from "../types.ts";

type SystemOneModule = {
	postDecisions: (model: DecisionsModel<"systemone">, context: any, options?: any) => Promise<DecisionResult>;
};

let modulePromise: Promise<SystemOneModule> | undefined;

function loadModule(): Promise<SystemOneModule> {
	modulePromise ||= import("./systemone.ts");
	return modulePromise;
}

export const systemoneDecisionsApi = (): DecisionsFunction => {
	return async (model, context, options) => {
		const startedAt = performance.now();
		const result: DecisionResult = {
			api: model.api,
			provider: model.provider,
			model: model.id,
			answers: {},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		try {
			const module = await loadModule();
			return await module.postDecisions(model as DecisionsModel<"systemone">, context, options);
		} catch (error) {
			result.stopReason = options?.signal?.aborted ? "aborted" : "error";
			result.errorMessage = error instanceof Error ? error.message : String(error);
			result.durationMs = performance.now() - startedAt;
			return result;
		}
	};
};

import type { DecisionsApi, DecisionsContext, DecisionsFunction, DecisionsModel, DecisionsOptions } from "./types.ts";

export interface DecisionsApiProvider<
	TApi extends DecisionsApi = DecisionsApi,
	TOptions extends DecisionsOptions = DecisionsOptions,
> {
	api: TApi;
	postDecisions: DecisionsFunction<TApi, TOptions>;
}

interface DecisionsApiProviderInternal {
	api: DecisionsApi;
	postDecisions: DecisionsFunction;
}

type RegisteredDecisionsApiProvider = {
	provider: DecisionsApiProviderInternal;
	sourceId?: string;
};

const decisionsApiProviderRegistry = new Map<string, RegisteredDecisionsApiProvider>();

function wrapPostDecisions<TApi extends DecisionsApi, TOptions extends DecisionsOptions>(
	api: TApi,
	postDecisions: DecisionsFunction<TApi, TOptions>,
): DecisionsFunction {
	return (model: DecisionsModel<DecisionsApi>, context: DecisionsContext, options?: DecisionsOptions) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return postDecisions(model as DecisionsModel<TApi>, context, options as TOptions);
	};
}

export function registerDecisionsApiProvider<TApi extends DecisionsApi, TOptions extends DecisionsOptions>(
	provider: DecisionsApiProvider<TApi, TOptions>,
	sourceId?: string,
): void {
	decisionsApiProviderRegistry.set(provider.api, {
		provider: {
			api: provider.api,
			postDecisions: wrapPostDecisions(provider.api, provider.postDecisions),
		},
		sourceId,
	});
}

export function getDecisionsApiProvider(api: DecisionsApi): DecisionsApiProviderInternal | undefined {
	return decisionsApiProviderRegistry.get(api)?.provider;
}

import { defaultProviderAuthContext as defaultAuthContext } from "./auth/context.ts";
import { InMemoryCredentialStore } from "./auth/credential-store.ts";
import { type AuthResolutionOverrides, ModelsError, resolveProviderAuth } from "./auth/resolve.ts";
import type { AuthContext, AuthResult, CredentialStore, ProviderAuth } from "./auth/types.ts";
import type { CreateModelsOptions } from "./models.ts";
import type {
	DecisionResult,
	DecisionsApi,
	DecisionsContext,
	DecisionsFunction,
	DecisionsModel,
	DecisionsOptions,
} from "./types.ts";

/**
 * A decision-model provider: the decision-side counterpart of `Provider` and
 * `ImagesProvider`. Owns id/name metadata, auth, and model listing.
 */
export interface DecisionsProvider {
	readonly id: string;
	readonly name: string;

	/**
	 * Required: at least one of `apiKey`/`oauth`, matching chat providers.
	 * Keyless local servers provide an apiKey that resolves to "not-needed".
	 */
	readonly auth: ProviderAuth;

	/**
	 * Current known models, sync. Static providers return their catalog;
	 * dynamic providers return the list as of the last `refreshModels()`
	 * (empty before the first). Must not throw.
	 */
	getModels(): readonly DecisionsModel<DecisionsApi>[];

	/**
	 * Dynamic providers only (e.g. local discovery): fetch and update the
	 * model list. May reject; on rejection the list stays at its last-known
	 * state and a later call retries.
	 */
	refreshModels?(): Promise<void>;

	postDecisions(
		model: DecisionsModel<DecisionsApi>,
		context: DecisionsContext,
		options?: DecisionsOptions,
	): Promise<DecisionResult>;
}

export interface CreateDecisionsProviderOptions {
	id: string;
	name?: string;
	auth: ProviderAuth;
	models: readonly DecisionsModel<DecisionsApi>[];
	api: DecisionsFunction;
	refreshModels?: () => Promise<readonly DecisionsModel<DecisionsApi>[]>;
}

/**
 * Runtime collection of decision-model providers plus auth application and a
 * `postDecisions` convenience: the decision-side counterpart of `Models`.
 */
export interface DecisionsModels {
	getProviders(): readonly DecisionsProvider[];
	getProvider(id: string): DecisionsProvider | undefined;

	/**
	 * Sync read of last-known models from one provider or all providers.
	 * Best-effort: a provider whose `getModels()` throws yields no models.
	 */
	getModels(provider?: string): readonly DecisionsModel<DecisionsApi>[];

	/** Sync runtime model lookup against last-known lists. */
	getModel(provider: string, id: string): DecisionsModel<DecisionsApi> | undefined;

	/**
	 * Ask dynamic providers to re-fetch their model lists. With a provider id,
	 * rejects with `ModelsError` ("model_source") on that provider's fetch
	 * failure; without one, refreshes all providers concurrently best-effort.
	 * Static providers (no `refreshModels`) are no-ops.
	 */
	refresh(provider?: string): Promise<void>;

	/**
	 * Resolve request auth by provider id or decision model. Same contract as
	 * `Models.getAuth()`: undefined when unknown/unconfigured, rejects with
	 * `ModelsError` ("oauth"/"auth") on real failures.
	 */
	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	getAuth(model: DecisionsModel<DecisionsApi>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;

	/**
	 * Run one decision through the owning provider with auth resolved and
	 * merged (explicit options win per field). Never rejects; failures are
	 * returned as a `DecisionResult` with `stopReason: "error"`.
	 */
	postDecisions(
		model: DecisionsModel<DecisionsApi>,
		context: DecisionsContext,
		options?: DecisionsOptions,
	): Promise<DecisionResult>;
}

export interface MutableDecisionsModels extends DecisionsModels {
	/** Upsert/replace by provider.id. Provider ids are unique. */
	setProvider(provider: DecisionsProvider): void;
	deleteProvider(id: string): void;
	clearProviders(): void;
}

function createErrorResult(model: DecisionsModel<DecisionsApi>, error: unknown): DecisionResult {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

class DecisionsModelsImpl implements MutableDecisionsModels {
	private providers = new Map<string, DecisionsProvider>();
	private credentials: CredentialStore;
	private authContext: AuthContext;

	constructor(options?: CreateModelsOptions) {
		this.credentials = options?.credentials ?? new InMemoryCredentialStore();
		this.authContext = options?.authContext ?? defaultAuthContext();
	}

	setProvider(provider: DecisionsProvider): void {
		this.providers.set(provider.id, provider);
	}

	deleteProvider(id: string): void {
		this.providers.delete(id);
	}

	clearProviders(): void {
		this.providers.clear();
	}

	getProviders(): readonly DecisionsProvider[] {
		return Array.from(this.providers.values());
	}

	getProvider(id: string): DecisionsProvider | undefined {
		return this.providers.get(id);
	}

	getModels(provider?: string): readonly DecisionsModel<DecisionsApi>[] {
		if (provider !== undefined) {
			const entry = this.providers.get(provider);
			if (!entry) return [];
			try {
				return entry.getModels();
			} catch {
				return [];
			}
		}

		const models: DecisionsModel<DecisionsApi>[] = [];
		for (const entry of this.providers.values()) {
			try {
				models.push(...entry.getModels());
			} catch {
				// Best-effort: ill-behaved providers yield no models.
			}
		}
		return models;
	}

	getModel(provider: string, id: string): DecisionsModel<DecisionsApi> | undefined {
		return this.getModels(provider).find((model) => model.id === id);
	}

	async refresh(provider?: string): Promise<void> {
		if (provider !== undefined) {
			const entry = this.providers.get(provider);
			if (!entry?.refreshModels) return;
			try {
				await entry.refreshModels();
			} catch (error) {
				if (error instanceof ModelsError) throw error;
				throw new ModelsError("model_source", `Model refresh failed for ${provider}`, { cause: error });
			}
			return;
		}

		await Promise.allSettled(Array.from(this.providers.values(), async (entry) => entry.refreshModels?.()));
	}

	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	getAuth(model: DecisionsModel<DecisionsApi>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	async getAuth(
		providerOrModel: string | DecisionsModel<DecisionsApi>,
		overrides?: AuthResolutionOverrides,
	): Promise<AuthResult | undefined> {
		const providerId = typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
		const provider = this.providers.get(providerId);
		if (!provider) return undefined;
		return resolveProviderAuth(provider, this.credentials, this.authContext, overrides);
	}

	async postDecisions(
		model: DecisionsModel<DecisionsApi>,
		context: DecisionsContext,
		options?: DecisionsOptions,
	): Promise<DecisionResult> {
		try {
			const provider = this.providers.get(model.provider);
			if (!provider) {
				throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
			}

			const resolution = await this.getAuth(model, {
				apiKey: options?.apiKey,
				env: options?.env,
				signal: options?.signal,
			});
			const auth = resolution?.auth;
			if (!auth) {
				return provider.postDecisions(model, context, options);
			}

			const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;

			// Explicit request options win per-field; headers/env merge per key.
			const apiKey = options?.apiKey ?? auth.apiKey;
			const headers = auth.headers || options?.headers ? { ...auth.headers, ...options?.headers } : undefined;
			const env =
				resolution.env || options?.env ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) } : undefined;

			return await provider.postDecisions(requestModel, context, { ...options, apiKey, headers, env });
		} catch (error) {
			return createErrorResult(model, error);
		}
	}
}

export function createDecisionsModels(options?: CreateModelsOptions): MutableDecisionsModels {
	return new DecisionsModelsImpl(options);
}

export function createDecisionsProvider(input: CreateDecisionsProviderOptions): DecisionsProvider {
	let models = input.models;
	let inflightRefresh: Promise<void> | undefined;
	const refreshModels = input.refreshModels;

	return {
		id: input.id,
		name: input.name ?? input.id,
		auth: input.auth,
		getModels: () => models,
		refreshModels: refreshModels
			? () => {
					inflightRefresh ??= (async () => {
						try {
							models = await refreshModels();
						} finally {
							inflightRefresh = undefined;
						}
					})();
					return inflightRefresh;
				}
			: undefined,
		postDecisions: (model, context, options) => input.api(model, context, options),
	};
}

/** Convenience: first available model across providers (provider order first). */
export function firstAvailableDecisionsModel(models: DecisionsModels): DecisionsModel<DecisionsApi> | undefined {
	return models.getModels()[0];
}

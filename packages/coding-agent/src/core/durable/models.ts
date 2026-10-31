/**
 * `Models` over the engine's `ModelRegistry`.
 *
 * Durable generation, compaction and hooks take a pi-ai `Models` — model lookup plus
 * streaming. The engine resolves models, credentials and request configs through its
 * own `ModelRegistry`, so this adapter routes every call back into the registry
 * (auth at request time included) while normalizing durable's system-message
 * transcripts into the request shape our providers accept.
 */

import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	Models,
	ModelsApiStreamOptions,
	ModelsDeferredCancelOptions,
	ModelsDeferredFetchOptions,
	ModelsSimpleStreamOptions,
	Provider,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, toRequestContext } from "@earendil-works/pi-ai";
import { failedAssistantStream, type ModelRegistry } from "../model-registry.ts";

/**
 * Durable consumes a synchronously returned stream; the registry resolves request
 * auth asynchronously, so forward the pending stream's events into a live one.
 */
function pipeStream(model: Model<Api>, pending: Promise<AssistantMessageEventStream>): AssistantMessageEventStream {
	const out = createAssistantMessageEventStream();
	void pending
		.then(async (inner) => {
			for await (const event of inner) out.push(event);
		})
		.catch(async (error: unknown) => {
			const failure = failedAssistantStream(model, error instanceof Error ? error.message : String(error));
			for await (const event of failure) out.push(event);
		});
	return out;
}

/** Adapt a `ModelRegistry` to the pi-ai `Models` surface durable consumes. */
export function createRegistryModels(registry: ModelRegistry): Models {
	return new RegistryModels(registry);
}

class RegistryModels implements Models {
	private readonly registry: ModelRegistry;

	constructor(registry: ModelRegistry) {
		this.registry = registry;
	}

	getProviders(): readonly Provider[] {
		// Provider objects carry auth/stream behavior we do not model here;
		// durable looks models up via `getModel()`, which this adapter serves.
		return [];
	}

	getProvider(_id: string): Provider | undefined {
		return undefined;
	}

	getModels(provider?: string): readonly Model<Api>[] {
		const models = this.registry.getAll();
		return provider === undefined ? models : models.filter((model) => model.provider === provider);
	}

	getModel(provider: string, id: string): Model<Api> | undefined {
		return this.registry.find(provider, id);
	}

	async refresh(): Promise<{ aborted: boolean; errors: ReadonlyMap<string, Error> }> {
		const errors = new Map<string, Error>();
		try {
			this.registry.refresh();
		} catch (error) {
			errors.set("registry", error instanceof Error ? error : new Error(String(error)));
		}
		return { aborted: false, errors };
	}

	async checkAuth(providerId: string): Promise<{ source?: string; type: "api_key" | "oauth" } | undefined> {
		const status = this.registry.getProviderAuthStatus(providerId);
		if (!status.configured) return undefined;
		return {
			type: this.registry.authStorage.get(providerId)?.type ?? "api_key",
			...(status.source === undefined ? {} : { source: status.source }),
		};
	}

	async getAvailable(providerId?: string): Promise<readonly Model<Api>[]> {
		const models = this.registry.getAvailable();
		return providerId === undefined ? models : models.filter((model) => model.provider === providerId);
	}

	async getAuth(): Promise<undefined> {
		// Credentials resolve inside `ModelRegistry.streamSimple` per request.
		return undefined;
	}

	async login(): Promise<never> {
		throw new Error("Durable runs resolve credentials through the engine auth store; login is not available here.");
	}

	async logout(): Promise<void> {
		throw new Error("Durable runs resolve credentials through the engine auth store; logout is not available here.");
	}

	stream<TApi extends Api>(
		model: Model<TApi>,
		context: Context,
		options?: ModelsApiStreamOptions<TApi>,
	): AssistantMessageEventStream {
		return pipeStream(
			model,
			this.registry.stream(model, toRequestContext(context), options as ModelsSimpleStreamOptions),
		);
	}

	async complete<TApi extends Api>(
		model: Model<TApi>,
		context: Context,
		options?: ModelsApiStreamOptions<TApi>,
	): Promise<AssistantMessage> {
		return (
			await this.registry.stream(model, toRequestContext(context), options as ModelsSimpleStreamOptions)
		).result();
	}

	streamSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions): AssistantMessageEventStream {
		return pipeStream(
			model,
			this.registry.streamSimple(model, toRequestContext(context), options as ModelsSimpleStreamOptions),
		);
	}

	async completeSimple(
		model: Model<Api>,
		context: Context,
		options?: ModelsSimpleStreamOptions,
	): Promise<AssistantMessage> {
		return (await this.registry.streamSimple(model, toRequestContext(context), options)).result();
	}

	streamDeferred(
		_model: Model<Api>,
		_handle: unknown,
		_options?: ModelsDeferredFetchOptions,
	): AssistantMessageEventStream {
		throw new Error("Deferred responses are not supported by the engine model registry.");
	}

	async fetchDeferred(
		_model: Model<Api>,
		_handle: unknown,
		_options?: ModelsDeferredFetchOptions,
	): Promise<AssistantMessage> {
		throw new Error("Deferred responses are not supported by the engine model registry.");
	}

	async cancelDeferred(_model: Model<Api>, _handle: unknown, _options?: ModelsDeferredCancelOptions): Promise<void> {
		throw new Error("Deferred responses are not supported by the engine model registry.");
	}
}

import {
	type Context,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
	type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createRegistryModels } from "../../src/core/durable/models.ts";
import type { ModelRegistry } from "../../src/core/model-registry.ts";

const model = {
	id: "faux-1",
	name: "Faux",
	provider: "faux",
	api: "faux",
} as unknown as Model<"faux">;

function streamOf(message: ReturnType<typeof fauxAssistantMessage>) {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({ type: "start", partial: message });
		stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}

function fakeRegistry(seen: Context[]): ModelRegistry {
	return {
		find: (provider: string, id: string) => (provider === "faux" && id === "faux-1" ? model : undefined),
		getAll: () => [model],
		getAvailable: () => [model],
		getProviderAuthStatus: () => ({ configured: true }),
		refresh: () => {},
		authStorage: { get: () => undefined },
		streamSimple: async (_model: Model<"faux">, context: Context, _options?: ModelsSimpleStreamOptions) => {
			seen.push(context);
			return streamOf(fauxAssistantMessage("bridge answer"));
		},
	} as unknown as ModelRegistry;
}

describe("durable Models bridge", () => {
	it("serves model lookup from the registry", () => {
		const models = createRegistryModels(fakeRegistry([]));
		expect(models.getModel("faux", "faux-1")).toBe(model);
		expect(models.getModel("faux", "missing")).toBeUndefined();
		expect(models.getModels()).toEqual([model]);
	});

	it("returns a synchronously iterable stream and normalizes system messages", async () => {
		const seen: Context[] = [];
		const models = createRegistryModels(fakeRegistry(seen));
		const stream = models.streamSimple(model, {
			systemPrompt: "from durable",
			messages: [
				{ role: "system", content: "durable system", timestamp: 0 },
				{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 },
			],
		});

		const events: string[] = [];
		for await (const event of stream) events.push(event.type);
		expect(events).toEqual(["start", "done"]);
		expect(await stream.result()).toMatchObject({ role: "assistant" });
		// System entries travel as `systemPrompt`, appended to the existing prompt.
		expect(seen[0]?.messages.map((message) => message.role)).toEqual(["user"]);
		expect(seen[0]?.systemPrompt).toContain("durable system");
		expect(seen[0]?.systemPrompt).toContain("from durable");
	});

	it("turns a failed request into an error event on the piped stream", async () => {
		const registry = fakeRegistry([]);
		(registry as unknown as { streamSimple: () => Promise<never> }).streamSimple = async () => {
			throw new Error("auth missing");
		};
		const models = createRegistryModels(registry);
		const stream = models.streamSimple(model, {
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
		});
		const events = [];
		for await (const event of stream) events.push(event);
		expect(events.at(-1)).toMatchObject({
			type: "error",
			error: { role: "assistant", stopReason: "error", errorMessage: "auth missing" },
		});
		// Async entry points reject; the engine registry itself converts auth failures
		// to error streams, so this only covers an unexpected throw.
		await expect(
			models.completeSimple(model, {
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
			}),
		).rejects.toThrow("auth missing");
	});
});

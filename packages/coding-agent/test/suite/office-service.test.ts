import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AssistantMessage,
	type FauxResponseFactory,
	fauxAssistantMessage,
	registerFauxProvider,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_OFFICE_DIR } from "../../src/config.ts";
import {
	type CreateAgentSessionRuntimeFactory,
	clearAgentSessionServicesCache,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { OfficeService } from "../../src/core/office/service.ts";
import * as store from "../../src/core/office/store.ts";
import type {
	OfficeActivityEvent,
	OfficeHuddleDelta,
	OfficeHuddlePayload,
	OfficeSnapshot,
} from "../../src/core/office/types.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return typeof part === "object" && part !== null && (part as { type?: string }).type === "text";
		})
		.map((part) => part.text)
		.join("\n");
}

describe("OfficeService chat backend", () => {
	const cleanups: Array<() => Promise<void> | void> = [];
	const previousOfficeDir = process.env[ENV_OFFICE_DIR];

	beforeEach(() => {
		clearAgentSessionServicesCache();
	});

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
		if (previousOfficeDir === undefined) delete process.env[ENV_OFFICE_DIR];
		else process.env[ENV_OFFICE_DIR] = previousOfficeDir;
		clearAgentSessionServicesCache();
	});

	async function createService(options: { turnTimeoutMs?: number } = {}) {
		const tempDir = mkdtempSync(join(tmpdir(), "office-service-"));
		const officeDir = join(tempDir, "office");
		mkdirSync(officeDir, { recursive: true });
		process.env[ENV_OFFICE_DIR] = officeDir;

		const faux = registerFauxProvider({ models: [{ id: "faux-1" }] });
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");
		const settingsManager = SettingsManager.inMemory({});
		const modelRegistry = ModelRegistry.inMemory(authStorage);
		modelRegistry.registerProvider(faux.getModel().provider, {
			baseUrl: faux.getModel().baseUrl,
			apiKey: "faux-key",
			api: faux.api,
			models: faux.models.map((model) => ({
				id: model.id,
				name: model.name,
				api: model.api,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
			})),
		});

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir: tempDir,
				authStorage,
				settingsManager,
				modelRegistry,
				disableCache: true,
				resourceLoaderOptions: {
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
				},
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					model: faux.getModel(),
					noTools: "all",
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});
		await runtime.session.bindExtensions({});

		const updates: OfficeSnapshot[] = [];
		const huddles: OfficeHuddlePayload[] = [];
		const deltas: OfficeHuddleDelta[] = [];
		const activity: OfficeActivityEvent[] = [];
		const service = new OfficeService({
			runtime,
			turnTimeoutMs: options.turnTimeoutMs,
			sink: {
				update: (snapshot) => updates.push(snapshot),
				huddle: (payload) => huddles.push(payload),
				delta: (delta) => deltas.push(delta),
				activity: (event) => activity.push(event),
			},
		});
		service.start();
		await service.snapshot();

		cleanups.push(async () => {
			await service.dispose();
			await runtime.dispose();
			faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		return { service, runtime, faux, tempDir, officeDir, updates, huddles, deltas, activity };
	}

	async function createDm(service: OfficeService) {
		const coworker = await service.createCoworker({ name: "Atlas", title: "Scout" });
		const dmId = await service.ensureDmHuddle(coworker.id);
		return { coworker, dmId };
	}

	it("drops a redirected reply and leaves the newer user message for the next drive", async () => {
		const { service, faux, tempDir } = await createService();
		const { dmId } = await createDm(service);

		const started = deferred<void>();
		const release = deferred<AssistantMessage>();
		const contexts: string[] = [];
		faux.setResponses([
			((context) => {
				contexts.push(context.messages.map((message) => textOf(message.content)).join("\n"));
				started.resolve();
				return release.promise;
			}) satisfies FauxResponseFactory,
			((context) => {
				contexts.push(context.messages.map((message) => textOf(message.content)).join("\n"));
				return fauxAssistantMessage("fresh answer");
			}) satisfies FauxResponseFactory,
		]);

		await service.sendToHuddle(dmId, "first question");
		await started.promise;
		await service.sendToHuddle(dmId, "second question");
		release.resolve(fauxAssistantMessage("stale answer"));

		expect(await service.waitForHuddleIdle(dmId, 5_000)).toBe(true);
		const data = await service.getHuddle(dmId);
		const messages = data?.data.log ?? [];
		expect(messages.some((message) => message.text === "stale answer")).toBe(false);
		expect(messages.some((message) => message.text === "fresh answer")).toBe(true);
		expect(contexts[1]).toContain("second question");
		expect(tempDir.length).toBeGreaterThan(0);
	});

	it("does not commit a reply after Stop", async () => {
		const { service, faux } = await createService();
		const { dmId } = await createDm(service);

		const started = deferred<void>();
		const release = deferred<AssistantMessage>();
		faux.setResponses([
			((_context) => {
				started.resolve();
				return release.promise;
			}) satisfies FauxResponseFactory,
		]);

		await service.sendToHuddle(dmId, "work on this");
		await started.promise;
		const stopping = service.stopHuddle(dmId);
		release.resolve(fauxAssistantMessage("must not land"));
		await stopping;
		expect(await service.waitForHuddleIdle(dmId, 5_000)).toBe(true);

		const data = await service.getHuddle(dmId);
		const messages = data?.data.log ?? [];
		expect(messages.some((message) => message.text === "must not land")).toBe(false);
		expect(messages.some((message) => message.from.kind === "system")).toBe(true);
		expect(data?.data.running).toBeUndefined();
	});

	it("recovers interrupted drive state on startup", async () => {
		const { service, runtime, officeDir } = await createService();
		await service.dispose();
		await store.saveHuddle({ id: "h-recover", name: "Recover", members: ["a1"], createdAt: 1 }, officeDir);
		await store.updateHuddleData(
			"h-recover",
			(room) => {
				room.running = { startedAt: 1, thread: 0, current: "Atlas" };
				room.stranded = { a1: { before: 0, thread: 0, turnId: "missing" } };
			},
			officeDir,
		);

		const recoveredService = new OfficeService({
			runtime,
			sink: { update: () => {}, huddle: () => {}, delta: () => {} },
		});
		recoveredService.start();
		await recoveredService.snapshot();
		const data = await store.loadHuddleData("h-recover", officeDir);
		expect(data.running).toBeUndefined();
		expect(data.stranded).toBeUndefined();
		await recoveredService.dispose();
	});

	it("deletes a user message and shifts watermarks and stranded pointers", async () => {
		const { service, officeDir } = await createService();
		await store.saveHuddle({ id: "h-delete", name: "Delete room", members: ["a1"], createdAt: 1 }, officeDir);
		await store.updateHuddleData(
			"h-delete",
			(room) => {
				room.log.push(
					{ id: "m1", at: 1, from: { kind: "user", name: "User" }, text: "remove me" },
					{ id: "m2", at: 2, from: { kind: "coworker", id: "a1", name: "Atlas" }, text: "keep me" },
				);
				room.watermarks.a1 = 2;
				room.stranded = { a1: { before: 2, thread: 0, turnId: "turn" } };
			},
			officeDir,
		);
		expect(await service.deleteMessage("h-delete", "m1")).toBe(true);
		const data = await store.loadHuddleData("h-delete", officeDir);
		expect(data.log.map((message) => message.id)).toEqual(["m2"]);
		expect(data.watermarks.a1).toBe(1);
		expect(data.stranded?.a1.before).toBe(1);
		await expect(service.deleteMessage("h-delete", "m2")).rejects.toThrow("Only your own messages");
	});

	it("searches every stored room, including rooms that were never opened", async () => {
		const { service, officeDir } = await createService();
		await store.saveHuddle({ id: "h-search", name: "Release room", members: ["a1"], createdAt: 1 }, officeDir);
		await store.updateHuddleData(
			"h-search",
			(room) => {
				room.log.push(
					{ id: "m1", at: 10, from: { kind: "user", name: "User" }, text: "the deploy is blocked on CI" },
					{ id: "m2", at: 20, from: { kind: "coworker", id: "a1", name: "Atlas" }, text: "I will unblock CI" },
				);
			},
			officeDir,
		);
		const hits = await service.searchHuddles("unblock");
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ huddleId: "h-search", title: "Release room", author: "Atlas", messageId: "m2" });
		expect(hits[0]?.snippet).toContain("unblock");
		expect((await service.searchHuddles("release"))[0]).toMatchObject({ author: "Room", snippet: "Room name" });
	});

	it("rejects oversized attachment sets before appending the message", async () => {
		const { service } = await createService();
		const { dmId } = await createDm(service);
		const image = { name: "a.png", kind: "image" as const, data: "data:image/png;base64,AAAA" };
		await expect(
			service.sendToHuddle(
				dmId,
				"many files",
				Array.from({ length: 5 }, (_, i) => ({ ...image, name: `${i}.png` })),
			),
		).rejects.toThrow("At most");
		const data = await service.getHuddle(dmId);
		expect(data?.data.log).toEqual([]);
	});

	it("does not commit a turn that finishes after dispose", async () => {
		const { service, faux, officeDir } = await createService();
		const { dmId } = await createDm(service);
		const started = deferred<void>();
		const release = deferred<AssistantMessage>();
		faux.setResponses([
			(() => {
				started.resolve();
				return release.promise;
			}) satisfies FauxResponseFactory,
		]);

		await service.sendToHuddle(dmId, "work on this");
		await started.promise;
		const disposing = service.dispose();
		release.resolve(fauxAssistantMessage("late after dispose"));
		await disposing;
		await new Promise((resolve) => setTimeout(resolve, 100));
		const data = await store.loadHuddleData(dmId, officeDir);
		expect(data.log.some((message) => message.text === "late after dispose")).toBe(false);
	});
});

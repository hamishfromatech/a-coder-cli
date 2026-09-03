import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as store from "../../src/core/office/store.ts";
import type { Coworker, OfficeMessage } from "../../src/core/office/types.ts";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "office-store-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function coworker(id: string, handle: string): Coworker {
	return {
		id,
		name: id,
		handle,
		soul: "",
		face: { shape: "circle" },
		autonomy: "supervised",
		createdAt: 1,
		sessions: {},
	};
}

describe("office store", () => {
	it("round-trips coworkers with save/update/delete", async () => {
		const root = tempRoot();
		await store.saveCoworker(coworker("a1", "atlas"), root);
		await store.saveCoworker(coworker("n1", "nova"), root);
		expect((await store.listCoworkers(root)).map((c) => c.id)).toEqual(["a1", "n1"]);

		await store.saveCoworker({ ...coworker("a1", "atlas2"), title: "Scout" }, root);
		const after = await store.listCoworkers(root);
		expect(after).toHaveLength(2);
		expect(after.find((c) => c.id === "a1")?.title).toBe("Scout");

		await store.deleteCoworker("a1", root);
		expect((await store.listCoworkers(root)).map((c) => c.id)).toEqual(["n1"]);
	});

	it("corrupt or missing huddle data falls back to an empty room", async () => {
		const root = tempRoot();
		const data = await store.loadHuddleData("missing", root);
		expect(data.log).toEqual([]);
		expect(data.epoch).toBe(0);
		expect(data.watermarks).toEqual({});
	});

	it("updateHuddleData serializes read-modify-write and appendHuddleMessage advances the reader watermark", async () => {
		const root = tempRoot();
		await store.saveHuddle({ id: "h1", name: "Room", members: ["a1"], createdAt: 1 }, root);
		const message: OfficeMessage = { id: "m1", at: 1, from: { kind: "user", name: "User" }, text: "hello" };
		await store.appendHuddleMessage("h1", message, "a1", root);
		await store.appendHuddleMessage("h1", { ...message, id: "m2" }, undefined, root);

		const data = await store.loadHuddleData("h1", root);
		expect(data.log).toHaveLength(2);
		expect(data.watermarks.a1).toBe(1);

		const updated = await store.updateHuddleData(
			"h1",
			(room) => {
				room.epoch += 1;
			},
			root,
		);
		expect(updated.epoch).toBe(1);
		expect(updated.log).toHaveLength(2);

		await store.deleteHuddle("h1", root);
		expect(await store.loadHuddleData("h1", root)).toEqual(await store.emptyHuddleData());
		expect(await store.listHuddles(root)).toEqual([]);
	});

	it("deleteCoworkerEverywhere removes the DM huddle and membership everywhere", async () => {
		const root = tempRoot();
		await store.saveCoworker(coworker("a1", "atlas"), root);
		await store.saveCoworker(coworker("n1", "nova"), root);
		await store.saveHuddle({ id: "dm:a1", name: "Atlas", members: ["a1"], createdAt: 1 }, root);
		await store.saveHuddle({ id: "room", name: "Room", members: ["a1", "n1"], createdAt: 1 }, root);

		await store.deleteCoworkerEverywhere("a1", "dm:a1", root);
		expect((await store.listCoworkers(root)).map((c) => c.id)).toEqual(["n1"]);
		const huddles = await store.listHuddles(root);
		expect(huddles.find((h) => h.id === "room")?.members).toEqual(["n1"]);
		expect(huddles.some((h) => h.id === "dm:a1")).toBe(false);
	});

	it("errand CRUD and partial updates work", async () => {
		const root = tempRoot();
		const errand = {
			id: "e1",
			coworkerId: "a1",
			name: "Sweep",
			prompt: "look around",
			schedule: { kind: "every" as const, minutes: 30 },
			continuity: true,
			delivery: "dm" as const,
			enabled: true,
			createdAt: 1,
		};
		await store.saveErrand(errand, root);
		await store.updateErrand(
			"e1",
			(e) => {
				e.lastStatus = "ok";
				e.nextRunAt = 42;
			},
			root,
		);
		const loaded = await store.listErrands(root);
		expect(loaded[0].nextRunAt).toBe(42);
		expect(loaded[0].lastStatus).toBe("ok");

		await store.deleteErrand("e1", root);
		expect(await store.listErrands(root)).toEqual([]);
	});
});

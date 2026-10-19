import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as store from "../../src/core/office/store.ts";
import {
	type Coworker,
	type HuddleData,
	OFFICE_MAX_LOG_MESSAGES,
	type OfficeMessage,
} from "../../src/core/office/types.ts";

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

	it("stores the log append-only and keeps state separately", async () => {
		const root = tempRoot();
		const message = (id: string): OfficeMessage => ({
			id,
			at: 1,
			from: { kind: "user", name: "User" },
			text: id,
		});
		await store.appendHuddleMessage("h1", message("m1"), "a1", root);
		await store.appendHuddleMessage("h1", message("m2"), undefined, root);

		const logPath = join(root, "huddles-data", "h1.log.jsonl");
		const statePath = join(root, "huddles-data", "h1.state.json");
		expect(existsSync(logPath)).toBe(true);
		expect(existsSync(statePath)).toBe(true);
		expect(existsSync(join(root, "huddles-data", "h1.json"))).toBe(false);
		const lines = readFileSync(logPath, "utf-8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[1] ?? "{}").id).toBe("m2");

		const data = await store.loadHuddleData("h1", root);
		expect(data.log.map((m) => m.id)).toEqual(["m1", "m2"]);
		expect(data.watermarks.a1).toBe(1);
	});

	it("migrates a legacy combined huddle file on first write", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "huddles-data"), { recursive: true });
		const legacy: HuddleData = {
			epoch: 3,
			log: [{ id: "old", at: 1, from: { kind: "user", name: "User" }, text: "old" }],
			watermarks: { a1: 1 },
			holds: {},
		};
		writeFileSync(join(root, "huddles-data", "legacy.json"), JSON.stringify(legacy), "utf-8");

		const loaded = await store.loadHuddleData("legacy", root);
		expect(loaded.epoch).toBe(3);
		expect(loaded.log.map((m) => m.id)).toEqual(["old"]);

		await store.updateHuddleData(
			"legacy",
			(room) => {
				room.log.push({ id: "new", at: 2, from: { kind: "user", name: "User" }, text: "new" });
			},
			root,
		);
		const migrated = await store.loadHuddleData("legacy", root);
		expect(migrated.epoch).toBe(3);
		expect(migrated.log.map((m) => m.id)).toEqual(["old", "new"]);
		expect(migrated.watermarks.a1).toBe(1);
		const lines = readFileSync(join(root, "huddles-data", "legacy.log.jsonl"), "utf-8")
			.trim()
			.split("\n");
		expect(lines).toHaveLength(2);
	});

	it("caps the huddle log and shifts read pointers", async () => {
		const root = tempRoot();
		const total = OFFICE_MAX_LOG_MESSAGES + 7;
		await store.updateHuddleData(
			"h1",
			(room) => {
				for (let i = 0; i < total; i += 1) {
					room.log.push({
						id: `m${i}`,
						at: i,
						from: { kind: "user", name: "User" },
						text: `message ${i}`,
					});
				}
				room.watermarks.a1 = total;
				room.stranded = { a1: { before: total, thread: 1 } };
			},
			root,
		);

		const data = await store.loadHuddleData("h1", root);
		expect(data.log).toHaveLength(OFFICE_MAX_LOG_MESSAGES);
		expect(data.log[0]?.id).toBe("m7");
		expect(data.watermarks.a1).toBe(OFFICE_MAX_LOG_MESSAGES);
		expect(data.stranded?.a1.before).toBe(OFFICE_MAX_LOG_MESSAGES);
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

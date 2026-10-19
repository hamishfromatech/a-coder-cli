import { describe, expect, it } from "vitest";
import { collectCoworkerLines } from "./huddle-call";
import type { OfficeMessage } from "./rpc";

function message(id: string, at: number, kind: "user" | "coworker" | "system", text = id): OfficeMessage {
	return {
		id,
		at,
		text,
		from: { kind, id: kind === "coworker" ? "coworker-1" : undefined, name: kind === "coworker" ? "Atlas" : "User" },
	};
}

describe("collectCoworkerLines", () => {
	it("skips history, user entries and system lines", () => {
		const spoken = new Set<string>();
		const log = [
			message("old", 500, "coworker"),
			message("user", 1_500, "user"),
			message("system", 1_600, "system"),
			message("new", 1_700, "coworker"),
		];
		const fresh = collectCoworkerLines(log, spoken, 1_000);
		expect(fresh.map((m) => m.id)).toEqual(["new"]);
		// History is still marked so a later full-log push does not replay it.
		expect(spoken.has("old")).toBe(true);
		expect(spoken.has("new")).toBe(true);
	});

	it("returns only entries that arrived since the previous payload", () => {
		const spoken = new Set<string>();
		const first = [message("a", 1_100, "coworker")];
		expect(collectCoworkerLines(first, spoken, 1_000)).toHaveLength(1);

		const second = [...first, message("b", 1_200, "coworker")];
		const fresh = collectCoworkerLines(second, spoken, 1_000);
		expect(fresh.map((m) => m.id)).toEqual(["b"]);
	});
});

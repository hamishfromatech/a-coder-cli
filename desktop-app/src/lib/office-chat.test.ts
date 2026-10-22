import { describe, expect, it } from "vitest";
import {
	applyMention,
	dayLabel,
	filterMentionCandidates,
	findMentionMatch,
	loadOfficeDraft,
	saveOfficeDraft,
} from "./office-chat";
import type { OfficeCoworker } from "./rpc";

function coworker(id: string, name: string, handle: string, title?: string): OfficeCoworker {
	return {
		id,
		name,
		handle,
		title,
		soul: "",
		face: { shape: "circle" },
		autonomy: "supervised",
		createdAt: 0,
		sessions: {},
	};
}

const ATLAS = coworker("a1", "Atlas", "atlas", "Scout");
const NOVA = coworker("n1", "Nova", "nova", "Builder");

describe("office chat helpers", () => {
	it("finds a mention token at the cursor", () => {
		expect(findMentionMatch("hey @atl", 8, [ATLAS, NOVA])).toEqual({ start: 4, end: 8, query: "atl" });
		expect(findMentionMatch("@", 1, [ATLAS])).toEqual({ start: 0, end: 1, query: "" });
	});

	it("does not treat email addresses or ordinary words as mentions", () => {
		expect(findMentionMatch("hello@atlas", 12, [ATLAS])).toBeNull();
		expect(findMentionMatch("hey there", 9, [ATLAS])).toBeNull();
	});

	it("filters candidates by handle, name, or title", () => {
		expect(filterMentionCandidates([ATLAS, NOVA], "atl").map((c) => c.id)).toEqual(["a1"]);
		expect(filterMentionCandidates([ATLAS, NOVA], "build").map((c) => c.id)).toEqual(["n1"]);
		expect(filterMentionCandidates([ATLAS, NOVA], "").length).toBe(2);
	});

	it("inserts the selected mention and moves the cursor", () => {
		const match = findMentionMatch("hey @at", 7, [ATLAS]);
		expect(match).not.toBeNull();
		if (!match) return;
		const applied = applyMention("hey @at", match, "atlas");
		expect(applied.text).toBe("hey @atlas ");
		expect(applied.cursor).toBe(11);
	});

	it("labels today, yesterday, and older days", () => {
		const now = new Date(2026, 9, 22, 12).getTime();
		expect(dayLabel(now, now).label).toBe("Today");
		expect(dayLabel(new Date(2026, 9, 21, 12).getTime(), now).label).toBe("Yesterday");
		expect(dayLabel(new Date(2026, 8, 1, 12).getTime(), now).label).toContain("2026");
	});

	it("persists and clears a per-room draft", () => {
		const storage = new Map<string, string>();
		const original = globalThis.window;
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {
				localStorage: {
					getItem: (key: string) => storage.get(key) ?? null,
					setItem: (key: string, value: string) => storage.set(key, value),
					removeItem: (key: string) => storage.delete(key),
				},
			},
		});
		try {
			saveOfficeDraft("dm:a1", "half written");
			expect(loadOfficeDraft("dm:a1")).toBe("half written");
			saveOfficeDraft("dm:a1", "");
			expect(loadOfficeDraft("dm:a1")).toBe("");
		} finally {
			Object.defineProperty(globalThis, "window", { configurable: true, value: original });
		}
	});
});

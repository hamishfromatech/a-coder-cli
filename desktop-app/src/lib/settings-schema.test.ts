import { describe, expect, it } from "vitest";
import { listNavGroups, listNavItems, SETTINGS_SECTIONS } from "./settings-schema";

describe("settings navigation", () => {
	it("covers every nav page exactly once", () => {
		const expected = [...new Set(SETTINGS_SECTIONS.map((section) => section.navId))];
		const actual = listNavItems().map((item) => item.id);
		expect(actual.sort()).toEqual(expected.sort());
		expect(new Set(actual).size).toBe(actual.length);
	});

	it("puts the everyday pages first", () => {
		const groups = listNavGroups();
		expect(groups[0]?.label).toBe("App");
		expect(groups[0]?.items.map((item) => item.id)).toEqual([
			"general",
			"account",
		]);
		const flat = listNavItems().map((item) => item.id);
		expect(flat.indexOf("general")).toBeLessThan(flat.indexOf("advanced"));
	});

	it("labels every group and keeps only non-empty groups", () => {
		for (const group of listNavGroups()) {
			expect(group.label.length).toBeGreaterThan(0);
			expect(group.items.length).toBeGreaterThan(0);
		}
	});
});

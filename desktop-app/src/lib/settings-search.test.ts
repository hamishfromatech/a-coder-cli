import { describe, expect, it } from "vitest";
import {
	countSettingsSearchHits,
	groupSettingsSearchHits,
	searchSettings,
} from "./settings-search";

describe("settings search", () => {
	it("returns nothing for an empty query", () => {
		expect(searchSettings("")).toEqual([]);
		expect(searchSettings("   ")).toEqual([]);
	});

	it("finds fields by label and hint", () => {
		const llama = searchSettings("llama");
		expect(
			llama.some(
				(hit) =>
					hit.kind === "field" &&
					hit.path === "localProviders.llamaCppBaseUrl" &&
					hit.navId === "ai-model",
			),
		).toBe(true);
		expect(llama.some((hit) => hit.path === "llamaCppControls")).toBe(true);

		const privacy = searchSettings("anonymised");
		expect(privacy.some((hit) => hit.path === "enableAnalytics")).toBe(true);
	});

	it("matches page and merged-section titles", () => {
		const pages = searchSettings("privacy");
		expect(
			pages.some(
				(hit) => hit.kind === "page" && hit.navId === "privacy",
			),
		).toBe(true);

		const local = searchSettings("local models");
		expect(
			local.some(
				(hit) =>
					hit.kind === "section" &&
					hit.sectionId === "local-providers" &&
					hit.navId === "ai-model",
			),
		).toBe(true);
	});

	it("ranks exact and prefix label matches first", () => {
		const hits = searchSettings("model");
		expect(hits[0]?.label).toBe("Models");
		expect(hits[0]?.kind).toBe("page");
		expect(hits.some((hit) => hit.path === "defaultProvider")).toBe(true);
	});

	it("groups hits by page and counts them", () => {
		const grouped = groupSettingsSearchHits(searchSettings("thinking"));
		expect(grouped.length).toBeGreaterThan(0);
		const total = countSettingsSearchHits(grouped);
		expect(total).toBe(searchSettings("thinking").length);
		expect(
			grouped.every((group) =>
				group.hits.every((hit) => hit.navId === group.navId),
			),
		).toBe(true);
	});
});

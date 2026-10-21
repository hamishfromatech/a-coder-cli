import {
	listNavItems,
	SETTINGS_SECTIONS,
	type SettingsSection,
} from "./settings-schema";

/**
 * Cross-page settings search.
 *
 * The settings tree is declarative (settings-schema.ts), so search can be a
 * pure projection over it. Results carry the nav id and the field path needed
 * to jump straight to the control after the panel closes the results view.
 */
export type SettingsSearchHitKind = "page" | "section" | "field";

export interface SettingsSearchHit {
	kind: SettingsSearchHitKind;
	/** Canonical nav id (aliases are already resolved in the schema). */
	navId: string;
	sectionId: string;
	pageLabel: string;
	sectionLabel: string;
	/** Dotted settings path for field hits. */
	path?: string;
	label: string;
	hint?: string;
	score: number;
}

export interface SettingsSearchGroup {
	navId: string;
	label: string;
	hits: SettingsSearchHit[];
}

/** Minimum score for a hit; keeps noisy single-character queries quiet. */
const MIN_SCORE = 12;
/** Hard cap so a one-letter query cannot render the entire schema. */
const MAX_HITS = 80;

function normalized(query: string): string {
	return query.trim().toLowerCase();
}

function scoreText(text: string | undefined, query: string, base: number): number {
	if (!text) return 0;
	const value = text.toLowerCase();
	if (value === query) return base + 40;
	if (value.startsWith(query)) return base + 25;
	if (value.includes(query)) return base + 10;
	return 0;
}

function sectionFields(section: SettingsSection) {
	return [
		...(section.fields ?? []),
		...(section.cards?.flatMap((card) => card.fields) ?? []),
	];
}

/**
 * Search page titles, merged-section titles, field labels, hints and dotted
 * paths. Field labels outrank hints and page copy; exact matches outrank
 * prefixes; everything is case-insensitive.
 */
export function searchSettings(query: string): SettingsSearchHit[] {
	const q = normalized(query);
	if (q.length < 2) return [];

	const nav = listNavItems();
	const pageLabel = new Map(nav.map((item) => [item.id, item.label]));
	const navOrder = new Map(nav.map((item, index) => [item.id, index]));
	const sectionOrder = new Map<string, number>(
		SETTINGS_SECTIONS.map((section, index) => [section.id, index]),
	);
	const hits: SettingsSearchHit[] = [];
	const seen = new Set<string>();
	const pageKeys = new Set<string>();

	const add = (hit: SettingsSearchHit) => {
		const key = `${hit.kind}:${hit.navId}:${hit.sectionId}:${hit.path ?? ""}`;
		if (seen.has(key)) return;
		seen.add(key);
		hits.push(hit);
	};

	for (const item of nav) {
		const score = scoreText(item.label, q, 60);
		if (score < MIN_SCORE) continue;
		const first = SETTINGS_SECTIONS.find((section) => section.navId === item.id);
		if (!first) continue;
		pageKeys.add(`${item.id}:${item.label}`);
		add({
			kind: "page",
			navId: item.id,
			sectionId: first.id,
			pageLabel: item.label,
			sectionLabel: item.label,
			label: item.label,
			hint: first.description,
			score,
		});
	}

	for (const section of SETTINGS_SECTIONS) {
		const page = pageLabel.get(section.navId) ?? section.label;
		const sectionScore = Math.max(
			scoreText(section.label, q, 45),
			scoreText(section.description, q, 15),
		);
		if (
			sectionScore >= MIN_SCORE &&
			!pageKeys.has(`${section.navId}:${section.label}`)
		) {
			add({
				kind: "section",
				navId: section.navId,
				sectionId: section.id,
				pageLabel: page,
				sectionLabel: section.label,
				label: section.label,
				hint: section.description,
				score: sectionScore,
			});
		}

		for (const field of sectionFields(section)) {
			const score = Math.max(
				scoreText(field.label, q, 55),
				scoreText(field.hint, q, 22),
				scoreText(field.path, q, 14),
			);
			if (score < MIN_SCORE) continue;
			add({
				kind: "field",
				navId: section.navId,
				sectionId: section.id,
				pageLabel: page,
				sectionLabel: section.label,
				path: field.path,
				label: field.label,
				hint: field.hint,
				score,
			});
		}
	}

	return hits
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			const navDelta =
				(navOrder.get(a.navId) ?? Number.MAX_SAFE_INTEGER) -
				(navOrder.get(b.navId) ?? Number.MAX_SAFE_INTEGER);
			if (navDelta !== 0) return navDelta;
			const sectionDelta =
				(sectionOrder.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER) -
				(sectionOrder.get(b.sectionId) ?? Number.MAX_SAFE_INTEGER);
			if (sectionDelta !== 0) return sectionDelta;
			const kindRank = { field: 0, section: 1, page: 2 } as const;
			if (kindRank[a.kind] !== kindRank[b.kind]) {
				return kindRank[a.kind] - kindRank[b.kind];
			}
			return a.label.localeCompare(b.label);
		})
		.slice(0, MAX_HITS);
}

/** Group flat hits by their settings page, preserving result order. */
export function groupSettingsSearchHits(
	hits: SettingsSearchHit[],
): SettingsSearchGroup[] {
	const groups = new Map<string, SettingsSearchGroup>();
	for (const hit of hits) {
		const existing = groups.get(hit.navId);
		if (existing) {
			existing.hits.push(hit);
		} else {
			groups.set(hit.navId, {
				navId: hit.navId,
				label: hit.pageLabel,
				hits: [hit],
			});
		}
	}
	return [...groups.values()];
}

export function countSettingsSearchHits(groups: SettingsSearchGroup[]): number {
	return groups.reduce((total, group) => total + group.hits.length, 0);
}

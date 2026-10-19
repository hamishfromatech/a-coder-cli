import type { OfficeCoworker, OfficeHuddlePayload, OfficeSnapshot } from "./rpc";

/** Sort rooms pinned-first, then by most recent activity. */
export function sortOfficeRooms<T extends { id: string; lastActive?: number }>(
	rooms: T[],
	pinned: ReadonlySet<string>,
): T[] {
	return [...rooms].sort(
		(a, b) =>
			Number(pinned.has(b.id)) - Number(pinned.has(a.id)) ||
			(b.lastActive ?? 0) - (a.lastActive ?? 0),
	);
}

export interface OfficeSearchHit {
	huddleId: string;
	title: string;
	snippet: string;
	at: number;
}

function roomTitle(snapshot: OfficeSnapshot | null, huddleId: string): string {
	if (!snapshot) return huddleId;
	const room = snapshot.huddles.find((huddle) => huddle.id === huddleId);
	if (room) return room.name;
	if (huddleId.startsWith("dm:")) {
		const id = huddleId.slice(3);
		return snapshot.coworkers.find((coworker) => coworker.id === id)?.name ?? huddleId;
	}
	return huddleId;
}

function snippetFor(text: string, index: number, length: number): string {
	const start = Math.max(0, index - 36);
	const end = Math.min(text.length, index + length + 60);
	return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Search room names and the most recent 200 messages of each loaded room. */
export function searchOffice(
	snapshot: OfficeSnapshot | null,
	huddles: Record<string, OfficeHuddlePayload>,
	query: string,
	limit = 20,
): OfficeSearchHit[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];
	const hits: OfficeSearchHit[] = [];

	for (const room of snapshot?.huddles ?? []) {
		if (room.name.toLowerCase().includes(needle)) {
			hits.push({
				huddleId: room.id,
				title: room.name,
				snippet: "Room name",
				at: room.lastActive ?? 0,
			});
		}
	}

	for (const [huddleId, payload] of Object.entries(huddles)) {
		const title = roomTitle(snapshot, huddleId);
		const log = payload.data.log.slice(-200);
		for (const message of log) {
			const index = message.text.toLowerCase().indexOf(needle);
			if (index < 0) continue;
			hits.push({
				huddleId,
				title,
				snippet: snippetFor(message.text, index, needle.length),
				at: message.at,
			});
		}
	}

	hits.sort((a, b) => b.at - a.at);
	return hits.slice(0, limit);
}

/** Coworker roster order for DM rows (pinned by `dm:<id>`, then activity). */
export function sortCoworkers(
	coworkers: OfficeCoworker[],
	lastActive: (id: string) => number | undefined,
	pinned: ReadonlySet<string>,
): OfficeCoworker[] {
	return [...coworkers].sort(
		(a, b) =>
			Number(pinned.has(`dm:${b.id}`)) - Number(pinned.has(`dm:${a.id}`)) ||
			(lastActive(b.id) ?? 0) - (lastActive(a.id) ?? 0),
	);
}

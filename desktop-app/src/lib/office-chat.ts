import type { OfficeCoworker } from "./rpc";

export interface MentionMatch {
	start: number;
	end: number;
	query: string;
}

export interface OfficeDayLabel {
	key: string;
	label: string;
}

const DRAFT_PREFIX = "a-coder.office.draft:";

/** Find the @mention token under the cursor. Only a token at the start of the
 *  text or after whitespace/punctuation is treated as a mention, so email
 *  addresses do not open the picker. */
export function findMentionMatch(text: string, cursor: number, members: OfficeCoworker[]): MentionMatch | null {
	const before = text.slice(0, cursor);
	const at = before.lastIndexOf("@");
	if (at < 0) return null;
	if (at > 0 && !/[\s([{]/.test(before[at - 1] ?? "")) return null;
	const query = before.slice(at + 1);
	if (!/^[a-z0-9._-]*$/i.test(query)) return null;
	if (members.length === 0) return null;
	return { start: at, end: cursor, query };
}

export function filterMentionCandidates(
	members: OfficeCoworker[],
	query: string,
	limit = 6,
): OfficeCoworker[] {
	const needle = query.toLowerCase().replace(/^@/, "");
	if (!needle) return members.slice(0, limit);
	return members
		.filter((member) => {
			return (
				member.handle.toLowerCase().includes(needle) ||
				member.name.toLowerCase().includes(needle) ||
				member.title?.toLowerCase().includes(needle)
			);
		})
		.slice(0, limit);
}

/** Replace the active mention token with `@handle ` and return the new cursor. */
export function applyMention(
	text: string,
	match: MentionMatch,
	handle: string,
): { text: string; cursor: number } {
	const token = `@${handle} `;
	const next = `${text.slice(0, match.start)}${token}${text.slice(match.end)}`;
	return { text: next, cursor: match.start + token.length };
}

export function dayLabel(at: number, now = Date.now()): OfficeDayLabel {
	const date = new Date(at);
	const today = new Date(now);
	const yesterday = new Date(now);
	yesterday.setDate(today.getDate() - 1);
	const sameDay = (a: Date, b: Date): boolean =>
		a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
	const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
	const label = sameDay(date, today)
		? "Today"
		: sameDay(date, yesterday)
			? "Yesterday"
			: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
	return { key, label };
}

export function loadOfficeDraft(huddleId: string): string {
	if (typeof window === "undefined") return "";
	try {
		return window.localStorage.getItem(`${DRAFT_PREFIX}${huddleId}`) ?? "";
	} catch {
		return "";
	}
}

export function saveOfficeDraft(huddleId: string, text: string): void {
	if (typeof window === "undefined") return;
	try {
		const key = `${DRAFT_PREFIX}${huddleId}`;
		if (text) window.localStorage.setItem(key, text);
		else window.localStorage.removeItem(key);
	} catch {
		// Storage can be disabled; the in-memory draft still works.
	}
}

/** Copy text with a fallback for environments without the async clipboard API. */
export async function copyOfficeText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

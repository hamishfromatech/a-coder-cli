/**
 * Huddle coordination — who speaks, in what order, for how long.
 *
 * Behavioral model (clean-room, inspired by bounded round-robin coordination
 * over a shared room log): a user send triggers at most OFFICE_MAX_ROUNDS
 * serial round-robin rounds over the seated roster — never parallel, no LLM
 * router. Who speaks each round is a deterministic @mention parse since the
 * last user message (mentioned coworkers only, else everyone); whether a
 * coworker actually speaks is its own turn's choice — replying with exactly
 * "(pass)" (or nothing, or failing) is silence. A round in which everyone
 * passed means the conversation settled.
 *
 * Everything here is pure and unit-tested; the service drives it.
 */

import { identityReminder } from "./soul.ts";
import type { Coworker, HuddleData, OfficeMessage, OfficeMessageAuthor } from "./types.ts";
import {
	OFFICE_HISTORY_LIMIT,
	OFFICE_MAX_MEMBERS,
	OFFICE_MAX_PROMPT_CHARS,
	OFFICE_MAX_PROMPT_MESSAGE_CHARS,
	OFFICE_TURN_RULES,
} from "./types.ts";

/** Parse @mentions: @handle, @everyone/@all. Handles match case-insensitively
 *  against coworker handles, collapsed no-space forms, and display names. */
export function parseMentions(text: string, members: Coworker[]): { everyone: boolean; mentioned: Set<string> } {
	const source = String(text || "");
	const mentioned = new Set<string>();
	let everyone = false;
	const forms = new Map<string, string>();

	for (const member of members) {
		const candidateForms = new Set([
			member.handle.toLowerCase(),
			member.handle.toLowerCase().replace(/[\s_-]+/g, ""),
			member.name.toLowerCase(),
			member.name.toLowerCase().replace(/[\s_-]+/g, ""),
		]);
		if (member.title) {
			candidateForms.add(member.title.toLowerCase());
			candidateForms.add(member.title.toLowerCase().replace(/[\s_-]+/g, ""));
		}
		for (const form of candidateForms) {
			if (form && !forms.has(form)) {
				forms.set(form, member.id);
			}
		}
	}

	for (const match of source.matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)) {
		const handle = match[1].toLowerCase();
		if (handle === "everyone" || handle === "all") {
			everyone = true;
			continue;
		}
		if (handle === "user") {
			continue;
		}
		const resolved = forms.get(handle) ?? forms.get(handle.replace(/[._-]+/g, ""));
		if (resolved) {
			mentioned.add(resolved);
		}
	}

	return { everyone, mentioned };
}

/** Coworkers who should take a turn this round: everyone when nothing since
 *  the last user entry is @-mentioned (or @everyone appears), otherwise only
 *  the mentioned coworkers. Recomputed every round so a coworker pulled in
 *  mid-conversation joins the next round. */
export function resolveResponders(log: OfficeMessage[], members: Coworker[]): Coworker[] {
	let sinceLastUser: OfficeMessage[] = [];
	for (let i = log.length - 1; i >= 0; i--) {
		if (log[i].from.kind === "user") {
			sinceLastUser = log.slice(i);
			break;
		}
	}

	let everyone = false;
	const mentioned = new Set<string>();
	for (const entry of sinceLastUser) {
		const parsed = parseMentions(entry.text, members);
		if (parsed.everyone) {
			everyone = true;
		}
		for (const id of parsed.mentioned) {
			mentioned.add(id);
		}
	}

	if (everyone || mentioned.size === 0) {
		return members;
	}
	return members.filter((m) => mentioned.has(m.id));
}

/** Rotate the roster so a different coworker leads each round. */
export function rotateSpeakers(members: Coworker[], round: number): Coworker[] {
	if (members.length < 2) {
		return members;
	}
	const shift = round % members.length;
	return [...members.slice(shift), ...members.slice(0, shift)];
}

/** Seat cap: the last members win (the editor enforces this too). */
export function seatMembers(members: Coworker[]): Coworker[] {
	return members.slice(0, OFFICE_MAX_MEMBERS);
}

/** One room-log line as a coworker sees it: `Name (user): …` / `Name: …` /
 *  `Name (you): …`. Long text is truncated for the prompt; the stored log
 *  keeps the full message. */
export function formatRoomLine(entry: OfficeMessage, viewerId?: string): string {
	const attached = entry.images?.length
		? ` ${entry.images.map((img) => `[attached ${img.kind}: ${img.name}]`).join(" ")}`
		: "";
	const text = truncatePromptText(entry.text, OFFICE_MAX_PROMPT_MESSAGE_CHARS);
	if (entry.from.kind === "user") {
		return `${entry.from.name || "User"} (user): ${text}${attached}`;
	}
	const suffix = viewerId && entry.from.id === viewerId ? " (you)" : "";
	return `${entry.from.name}${suffix}: ${text}${attached}`;
}

/** Fit a room delta into one prompt. Keeps the newest lines, truncates one
 *  oversized line, and marks how many older lines were omitted. */
export function formatRoomLines(
	entries: OfficeMessage[],
	viewerId?: string,
	maxChars = OFFICE_MAX_PROMPT_CHARS,
): string[] {
	const lines = entries.map((entry) => formatRoomLine(entry, viewerId));
	const kept: string[] = [];
	let used = 0;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (!line) continue;
		const cost = line.length + (kept.length > 0 ? 1 : 0);
		// Always keep the newest line, even if the caller set a tiny budget.
		if (kept.length > 0 && used + cost > maxChars) break;
		kept.unshift(line);
		used += cost;
	}
	const omitted = lines.length - kept.length;
	if (omitted > 0) {
		kept.unshift(`… ${omitted} earlier message${omitted === 1 ? "" : "s"} omitted …`);
	}
	return kept;
}

function truncatePromptText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const cut = text.lastIndexOf(" ", maxChars);
	return `${text.slice(0, cut > 0 ? cut : maxChars).trimEnd()} …`;
}

export interface TurnPromptInput {
	coworker: Coworker;
	groupName: string;
	members: Coworker[];
	deltaLines: string[];
	/** The user addressed the whole room, so a personal answer is expected. */
	requiresResponse?: boolean;
}

/** Detect a user message addressed to the whole room rather than one person. */
export function isRoomAddress(text: string): boolean {
	const value = String(text || "").toLowerCase();
	return (
		/(^|\s)@(everyone|all)\b/.test(value) || /\b(both|everyone|you two|you both|all of you|guys|team)\b/.test(value)
	);
}

/** The full per-turn payload for one coworker: identity + participation rules
 *  + the room delta. Rules travel in the turn payload (not the soul) so every
 *  existing coworker can join a huddle without a session migration. */
export function buildHuddleTurnPrompt({
	coworker,
	groupName,
	members,
	deltaLines,
	requiresResponse = false,
}: TurnPromptInput): string {
	const peers = members
		.filter((m) => m.id !== coworker.id)
		.map((m) => `@${m.handle}${m.title ? ` (${m.title})` : ""}`)
		.join(", ");

	return [
		`[Huddle: "${groupName}"] ${identityReminder(coworker)} One participant among ${peers || "no one else yet"} and the user.`,
		"",
		"New messages in the room since your last turn (oldest first):",
		...deltaLines.map((line) => `  ${line}`),
		"",
		"Rules for this room:",
		...(requiresResponse
			? [
					"- The newest user message addresses the whole room. Answer in your own voice; do not pass just because a teammate already replied.",
				]
			: []),
		OFFICE_TURN_RULES,
	].join("\n");
}

/** A DM turn payload: no room etiquette, just the message. */
export function buildDmTurnPrompt(coworker: Coworker, fromName: string, text: string, attachmentNote?: string): string {
	const head = `[DM from ${fromName}] ${identityReminder(coworker)}`;
	return attachmentNote ? `${head}\n\n${text}\n\n${attachmentNote}` : `${head}\n\n${text}`;
}

/** True for "(pass)" (loosely: (pass) / pass. / empty) — the coworker stayed
 *  silent. */
export function isPassText(text: string | null | undefined): boolean {
	const trimmed = String(text || "").trim();
	if (!trimmed) return true;
	return /^\(?\s*pass\s*\)?\.?$/i.test(trimmed);
}

/** Coworkers cited by @mention in a coworker reply who have not posted any
 *  entry after the citing one — the unresolved-handoff detector. A mention
 *  inside a member reply is visible to the NEXT round's responder selection,
 *  but the round loop exits first when nobody has new delta to read, so the
 *  room settles while a called coworker never answers. Returns coworker ids
 *  still owed a turn. */
export function unaddressedMentions(log: OfficeMessage[], members: Coworker[]): string[] {
	const citedAt = new Map<string, number>();
	const lastPostAt = new Map<string, number>();
	// Only handoffs from the current user turn can still be owed. A mention
	// from an earlier turn was already settled (or consciously dropped) and
	// must not pull a coworker back into every future quiet round.
	let start = 0;
	for (let i = log.length - 1; i >= 0; i--) {
		if (log[i]?.from.kind === "user") {
			start = i;
			break;
		}
	}
	for (let i = start; i < log.length; i++) {
		const entry = log[i];
		if (entry.from.kind !== "coworker" || !entry.from.id) continue;
		lastPostAt.set(entry.from.id, i);
		const parsed = parseMentions(entry.text, members);
		for (const id of parsed.mentioned) {
			// Never count a coworker citing itself as a pending handoff.
			if (id !== entry.from.id) {
				citedAt.set(id, i);
			}
		}
	}
	return [...citedAt.keys()].filter((id) => {
		const answeredAt = lastPostAt.get(id);
		const citedAtIdx = citedAt.get(id) ?? -1;
		return answeredAt === undefined || answeredAt <= citedAtIdx;
	});
}

/** Byte-identical echo insurance: TRUE when the last log entry is the same
 *  coworker posting identical text — a residual double-append (a harvest
 *  racing a commit) fires back-to-back; two legitimately identical replies
 *  with anything in between never match. */
export function isEchoOfLastEntry(log: OfficeMessage[], coworkerId: string, text: string): boolean {
	const last = log[log.length - 1];
	return Boolean(last && last.from.kind === "coworker" && last.from.id === coworkerId && last.text === text);
}

interface ReplyLike {
	role?: string;
	text?: string;
}

/** Pick the reply a finished turn should surface among messages appended
 *  since `before`. Scans newest-first and prefers the last substantive
 *  (non-pass) assistant answer over a trailing pass. Returns null only when
 *  no assistant message appears in that range. */
export function pickReply(messages: ReplyLike[], before: number): string | null {
	let passText: string | null = null;
	for (let i = messages.length - 1; i >= before; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const replyText = String(message.text ?? "").trim();
		if (isPassText(replyText)) {
			if (passText === null) passText = replyText;
			continue;
		}
		return replyText;
	}
	return passText;
}

/** Classify a USER huddle message's effect on coworker holds. Conservative on
 *  purpose: any standalone stop/halt/pause word next to a mention holds those
 *  coworkers — "don't stop @x" therefore also holds, which errs toward the
 *  coworker staying quiet until re-addressed. A non-stop direct mention
 *  releases the mentioned coworkers — the user addressing a coworker directly
 *  overrides its hold. `everyone` (from @all/@everyone) scopes stop/resume to
 *  ALL members via `allIds`; a bare "@all" with no stop/resume word changes
 *  nothing. */
export function classifyHoldDirective(
	text: string,
	mentionedIds: Iterable<string>,
	everyone: boolean,
	allIds: string[] = [],
): { hold: string[]; release: string[] } {
	const value = String(text || "");
	const mentioned = [...mentionedIds];
	const stop = /\b(stop|halt|pause)\b/i.test(value);
	const resume = /\b(resume|go ahead|continue|carry on)\b/i.test(value);

	if (stop) {
		return { hold: everyone ? [...allIds] : mentioned, release: [] };
	}
	if (resume) {
		return { hold: [], release: everyone ? [...allIds] : mentioned };
	}
	if (everyone) {
		return { hold: [], release: [] };
	}
	if (mentioned.length > 0) {
		return { hold: [], release: mentioned };
	}
	return { hold: [], release: [] };
}

/** Watermark advance for a held coworker: consume the delta exactly once so
 *  the same entries never re-trigger the skip. */
export function heldWatermarkAdvance(seen: number | undefined, logLength: number): number | null {
	const current = seen ?? 0;
	return current < logLength ? logLength : null;
}

/** Whether a drive should commit a turn that finished after an epoch bump:
 *  same epoch always commits; a stale epoch commits only when no newer user
 *  entry landed in the meantime (the reply still belongs in the room). */
export function shouldCommitTurn(epochAtDispatch: number, currentEpoch: number, newerUserEntry: boolean): boolean {
	if (epochAtDispatch === currentEpoch) {
		return true;
	}
	return !newerUserEntry;
}

/** The delta a coworker should see: log entries after its watermark, oldest
 *  first, capped to the history limit. */
export function deltaFor(data: HuddleData, coworkerId: string): OfficeMessage[] {
	const seen = data.watermarks[coworkerId] ?? 0;
	const delta = data.log.slice(Math.max(0, seen));
	return delta.slice(-OFFICE_HISTORY_LIMIT);
}

/** A minted message id: monotonic enough for one process, sortable. */
export function mintMessageId(): string {
	return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Author helpers. */
export function userAuthor(name = "User"): OfficeMessageAuthor {
	return { kind: "user", name };
}

export function coworkerAuthor(coworker: Coworker): OfficeMessageAuthor {
	return { kind: "coworker", id: coworker.id, name: coworker.name };
}

export function systemAuthor(name = "Office"): OfficeMessageAuthor {
	return { kind: "system", name };
}

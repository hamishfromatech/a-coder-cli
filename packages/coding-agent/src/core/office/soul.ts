/**
 * The soul a coworker is born with, and the collaboration protocol every
 * turn prompt carries.
 *
 * Two surfaces need pieces of this and neither owns it: the roster editors
 * compose a new soul, and the office service appends the identity reminder
 * to every turn. The soul is pinned into the coworker's canonical session in
 * its first message; turn prompts only carry the compact rules header, so
 * existing coworkers can join huddles without a session migration.
 */

import type { Coworker } from "./types.ts";

/** @mention slug from a display name: lowercase, collapse separators, strip
 *  non-word chars. Collision-safe only by uniqueness check at create time. */
export function handleFromName(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "coworker";
}

/** The collaboration protocol as a coworker's soul carries it (teammate
 *  roster + huddle etiquette). Composed once at create/edit time so the
 *  persona knows who it works with — the live roster can grow after. */
function collaborationSection(handle: string, roster: Coworker[]): string {
	const teammates = roster.filter((c) => c.handle !== handle && !c.hidden);
	const lines = [
		"",
		"## Working with your office",
		"",
		"You are one of several named coworkers. You share huddles (group",
		"conversations) with them and with the user. When you speak in a huddle,",
		"your reply goes to the room verbatim; the user and other coworkers see",
		"it under your name. Address teammates as @handle to pull them in.",
		"",
		"The user may message you directly (a DM) or in a huddle. Errands may",
		"arrive on a schedule — treat each as a task from the user, do the work,",
		"and report the result.",
		"",
		"Teammates when you were created:",
		...(teammates.length
			? teammates.map((t) => {
					const role = t.title ? ` — ${t.title}` : "";
					return `- @${t.handle}${role}${t.description ? `: ${t.description}` : ""}`;
				})
			: ["- (none yet — you may be the first)"]),
	];
	return lines.join("\n");
}

export interface ComposeSoulOptions {
	/** The user's own soul text, when the editor supplied one. */
	customSoul?: string;
	description?: string;
	handle?: string;
	name: string;
	roster: Coworker[];
	title?: string;
}

/** Full soul text for a new coworker: identity (or the user's custom text)
 *  + the collaboration section. */
export function composeSoul({ name, title, description, handle, roster, customSoul }: ComposeSoulOptions): string {
	const slug = handle ?? handleFromName(name);
	const custom = customSoul?.trim();
	if (custom) {
		return `${custom}\n${collaborationSection(slug, roster)}`;
	}

	const displayName = title ? `${name} (${title})` : name;
	const identity = [
		`# ${displayName}`,
		"",
		title ? `**Role:** ${title}` : null,
		description ? `**Mission:** ${description}` : null,
		"",
		`You are ${displayName}, a named coworker in the user's office.`,
		"You keep your own memory, skills, and conversation history across",
		"sessions. You do real work with real tools — read, write, run, search —",
		"and you report results plainly.",
	]
		.filter((line) => line !== null)
		.join("\n");

	return identity + collaborationSection(slug, roster);
}

/** One-line identity reminder for a turn prompt header. */
export function identityReminder(coworker: Coworker): string {
	const role = coworker.title ? `, ${coworker.title}` : "";
	return `You are @${coworker.handle} (${coworker.name}${role}).`;
}

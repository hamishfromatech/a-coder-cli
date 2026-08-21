/**
 * Teammate mailbox — JSON-array inbox per team member.
 *
 * On-disk shape: `~/.a-coder-cli/teams/<team>/inboxes/<name>.json`, an array of
 * TeammateMessage records. Writes rewrite the full file atomically (write +
 * rename); pi-mono teammates run in-process and therefore serialize naturally
 * on the event loop, so no per-file lock is required (unlike easy-agent, which
 * kept proper-lockfile for its tmux backend).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getTeamDir, sanitizeName } from "./team-file.ts";

/** One inbox entry, persisted as-is inside the JSON-array file. */
export interface TeammateMessage {
	/** Sender's `name` (NOT agentId). Lead messages use `TEAM_LEAD_NAME`. */
	from: string;
	/** Plain text body. */
	text: string;
	/** ISO timestamp set at write time. */
	timestamp: string;
	/** False until the recipient consumes the message. */
	read: boolean;
	/** Optional short preview. */
	summary?: string;
}

/** Returns the absolute path to a teammate's inbox file. */
export function getInboxPath(agentName: string, teamName: string): string {
	const safeName = sanitizeName(agentName);
	return join(getTeamDir(teamName), "inboxes", `${safeName}.json`);
}

async function ensureInboxFile(agentName: string, teamName: string): Promise<string> {
	const inboxPath = getInboxPath(agentName, teamName);
	await mkdir(join(getTeamDir(teamName), "inboxes"), { recursive: true });
	try {
		await writeFile(inboxPath, "[]", { encoding: "utf-8", flag: "wx" });
	} catch (error: unknown) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (code !== "EEXIST") throw error;
	}
	return inboxPath;
}

/** Read every message in an inbox; [] on missing/corrupt file. */
export async function readMailbox(agentName: string, teamName: string): Promise<TeammateMessage[]> {
	try {
		const content = await readFile(getInboxPath(agentName, teamName), "utf-8");
		const parsed = JSON.parse(content);
		return Array.isArray(parsed) ? (parsed as TeammateMessage[]) : [];
	} catch {
		return [];
	}
}

/** Append one message to a teammate's inbox. */
export async function writeToMailbox(
	recipientName: string,
	message: Omit<TeammateMessage, "read">,
	teamName: string,
): Promise<void> {
	const inboxPath = await ensureInboxFile(recipientName, teamName);
	const messages = await readMailbox(recipientName, teamName);
	messages.push({ ...message, read: false });
	await writeFile(inboxPath, JSON.stringify(messages, null, 2), "utf-8");
}

/** Flip every unread message to read. No-op if nothing unread. */
export async function markMessagesAsRead(agentName: string, teamName: string): Promise<void> {
	const messages = await readMailbox(agentName, teamName);
	if (messages.length === 0) return;
	let changed = false;
	for (const m of messages) {
		if (!m.read) {
			m.read = true;
			changed = true;
		}
	}
	if (changed) {
		await writeFile(getInboxPath(agentName, teamName), JSON.stringify(messages, null, 2), "utf-8");
	}
}

/**
 * Atomically read + clear unread messages. Returns only the messages that were
 * unread at the moment of the call. Used by the teammate runner to inject
 * messages into the model's context at spawn time.
 */
export async function drainUnreadMessages(agentName: string, teamName: string): Promise<TeammateMessage[]> {
	const messages = await readMailbox(agentName, teamName);
	const unread = messages.filter((m) => !m.read);
	if (unread.length === 0) return [];
	for (const m of messages) {
		m.read = true;
	}
	await writeFile(getInboxPath(agentName, teamName), JSON.stringify(messages, null, 2), "utf-8");
	return unread;
}

/** Format mailbox messages as a single user-side context block. */
export function formatMailboxAttachment(messages: TeammateMessage[]): string {
	if (messages.length === 0) return "";
	const blocks = messages.map((m) => {
		const attrs: string[] = [`from="${m.from}"`, `at="${m.timestamp}"`];
		if (m.summary) attrs.push(`summary="${m.summary}"`);
		return `<teammate-message ${attrs.join(" ")}>\n${m.text}\n</teammate-message>`;
	});
	return [
		"<teammate-messages>",
		"The following message(s) were sent to you by other team members while you were working.",
		"Read them as authoritative team coordination input — treat them like user instructions.",
		"",
		...blocks,
		"</teammate-messages>",
	].join("\n");
}

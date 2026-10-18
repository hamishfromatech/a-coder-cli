import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Convert a stored session's JSONL into a readable Markdown transcript.
 *
 * Session files are append-only entry logs (`type: "message"` entries carrying
 * an `AgentMessage`, plus header/metadata entries). This walks the linear file
 * order — the same order the session list renders — and formats the
 * conversation, ignoring bookkeeping entries (model changes, snapshots,
 * labels). Tool calls/results are kept: a transcript without them reads as if
 * the agent did nothing between two answers.
 */

interface SessionEntry {
	type?: string;
	id?: string;
	timestamp?: string;
	name?: string;
	message?: AgentMessage;
	customType?: string;
}

function contentBlocks(message: AgentMessage): Array<Record<string, unknown>> {
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];
}

function textOf(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content.trim();
	return contentBlocks(message)
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("\n\n")
		.trim();
}

function fence(text: string, lang = ""): string {
	const body = text.trim();
	if (!body) return "";
	return `\`\`\`${lang}\n${body}\n\`\`\``;
}

function toolCallSection(block: Record<string, unknown>): string {
	const name = typeof block.name === "string" ? block.name : "tool";
	const args = block.arguments;
	return `**Tool call:** \`${name}\`\n\n${fence(JSON.stringify(args ?? {}, null, 2), "json")}`;
}

function formatMessage(message: AgentMessage): string {
	switch (message.role) {
		case "user": {
			const text = textOf(message);
			return text ? `## User\n\n${text}` : "";
		}
		case "assistant": {
			const parts: string[] = [];
			const text = textOf(message);
			if (text) parts.push(text);
			for (const block of contentBlocks(message)) {
				if (block.type === "toolCall") parts.push(toolCallSection(block));
			}
			return parts.length > 0 ? `## Assistant\n\n${parts.join("\n\n")}` : "";
		}
		case "toolResult": {
			const name =
				(typeof (message as { toolName?: string }).toolName === "string" &&
					(message as { toolName?: string }).toolName) ||
				"tool";
			const text = textOf(message);
			const error = (message as { isError?: boolean }).isError ? " (error)" : "";
			return text ? `**Tool result${error}:** \`${name}\`\n\n${fence(text)}` : "";
		}
		default:
			return "";
	}
}

export interface SessionTranscript {
	/** Session display name from the last `session_info` entry, if any. */
	name: string | undefined;
	/** Session creation timestamp from the header, if any. */
	timestamp: string | undefined;
	cwd: string | undefined;
	markdown: string;
	messageCount: number;
}

export function sessionJsonlToMarkdown(raw: string): SessionTranscript {
	let name: string | undefined;
	let timestamp: string | undefined;
	let cwd: string | undefined;
	const sections: string[] = [];
	let messageCount = 0;

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let entry: SessionEntry;
		try {
			entry = JSON.parse(trimmed) as SessionEntry;
		} catch {
			// A truncated final line (crash mid-write) must not sink the export.
			continue;
		}
		if (entry.type === "session") {
			timestamp = entry.timestamp;
			cwd = (entry as { cwd?: string }).cwd;
			continue;
		}
		if (entry.type === "session_info") {
			const entryName = (entry as { name?: string }).name;
			if (entryName) name = entryName;
			continue;
		}
		if (entry.type !== "message" || !entry.message) continue;
		const section = formatMessage(entry.message);
		if (!section) continue;
		messageCount += 1;
		sections.push(section);
	}

	const title = name || (cwd ? cwd.split(/[/\\]/).filter(Boolean).at(-1) : undefined) || "Session";
	const header = [`# ${title}`];
	if (timestamp) header.push(`_Started ${new Date(timestamp).toLocaleString()}_`);
	if (cwd) header.push(`_Working directory: \`${cwd}\`_`);

	return {
		name,
		timestamp,
		cwd,
		messageCount,
		markdown: `${header.join("\n\n")}\n\n${sections.join("\n\n---\n\n")}\n`,
	};
}

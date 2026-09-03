/**
 * Task-notification pills (easy-agent extractTaskNotification parity).
 *
 * Background-task completion notes are stamped onto the user's next
 * submission (or delivered alone on the idle wake turn). Rendering that raw
 * text inside the user bubble is noisy — the output tail alone can be dozens
 * of lines. Instead each note renders as a compact one-line status pill:
 *
 *   ✓ npm test completed (exit code 0) after 3.2s
 *   ✗ Background subagent "explore" (Explore) failed · 7 tool uses · 12.3s
 *
 * The display is derived at render time; the model still receives the full
 * note text unchanged.
 */

export type TaskNotificationStatus = "completed" | "failed" | "killed" | "unknown";

export interface TaskNotificationNote {
	status: TaskNotificationStatus;
	/** Compact first-line summary (command / subagent id + counts + duration). */
	header: string;
}

/** Prefixes a note produced by AgentSession._formatBackgroundProcessNotification / _formatSubAgentNotification. */
const NOTE_PREFIXES = ["Background process `", "[Background subagent ", "Background subagent "] as const;

const WAKE_BOILERPLATE = "Background task results above — report the findings to the user in your reply.";

function classifyStatus(header: string): TaskNotificationStatus {
	if (/\bcompleted\b/.test(header)) return "completed";
	if (/\bfailed\b/.test(header)) return "failed";
	if (/\bkilled\b/.test(header)) return "killed";
	return "unknown";
}

function looksLikeNote(chunk: string): boolean {
	return NOTE_PREFIXES.some((prefix) => chunk.startsWith(prefix));
}

export interface ParsedUserMessage {
	/** Leading background-task notes to render as pills. */
	notes: TaskNotificationNote[];
	/** The actual user-typed text (may be empty for wake turns). */
	userText: string;
}

/**
 * Split a user-message text into leading task-notification notes and the
 * actual user text. Handles both delivery shapes:
 *
 *   1. Stamped onto a submission: notes joined by blank lines, then the
 *      user's text (`notes.join("\n\n") + "\n\n" + text`).
 *   2. The wake turn: `<task-notification>` wrapper around the notes plus a
 *      boilerplate instruction line.
 *
 * Returns the text unchanged (notes: []) when nothing matches.
 */
export function parseTaskNotificationMessage(text: string): ParsedUserMessage {
	// Wake turn: <task-notification> ... </task-notification> + boilerplate.
	if (text.startsWith("<task-notification>")) {
		const end = text.indexOf("</task-notification>");
		if (end !== -1) {
			const inner = text.slice(text.indexOf("\n", text.indexOf("<task-notification>")) + 1, end).trim();
			let rest = text.slice(end + "</task-notification>".length).trim();
			if (rest === WAKE_BOILERPLATE) rest = "";
			const notes: TaskNotificationNote[] = [];
			for (const chunk of inner.split(/\n\n+/)) {
				const trimmed = chunk.trim();
				if (!trimmed || !looksLikeNote(trimmed)) continue;
				const header = trimmed.split("\n", 1)[0]?.trim() ?? trimmed;
				notes.push({ status: classifyStatus(header), header });
			}
			// Nothing recognizable — never swallow the message.
			if (notes.length === 0) {
				return { notes: [], userText: text };
			}
			return { notes, userText: rest };
		}
	}

	// Stamped notes: leading chunks that look like notes.
	const chunks = text.split(/\n\n+/);
	const notes: TaskNotificationNote[] = [];
	let index = 0;
	while (index < chunks.length && looksLikeNote(chunks[index])) {
		const chunk = chunks[index].trim();
		const header = chunk.split("\n", 1)[0]?.trim() ?? chunk;
		notes.push({ status: classifyStatus(header), header });
		index++;
	}
	if (notes.length === 0) {
		return { notes: [], userText: text };
	}
	return { notes, userText: chunks.slice(index).join("\n\n") };
}

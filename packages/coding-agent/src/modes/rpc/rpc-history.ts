/**
 * Pure helpers for RPC history paging and flat session trees.
 *
 * History pages index the live context array (`session.messages`), not the
 * session file. A page never starts on a tool result: the start walks back to
 * the assistant/user message that owns the tool call, so a "load older" page
 * cannot render results without their calls.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry, SessionTreeNode } from "../../core/session-manager.ts";
import type { RpcSessionTreeFlatNode, RpcTranscriptEntry } from "./rpc-types.ts";

const MAX_PAGE_SIZE = 2000;
const DEFAULT_OLDER_PAGE_SIZE = 200;

export interface MessagePage {
	messages: AgentMessage[];
	total: number;
	start: number;
	end: number;
	hasMore: boolean;
}

export function pageMessages(all: AgentMessage[], options: { limit?: number; before?: number } = {}): MessagePage {
	const total = all.length;
	const requested = options.limit;
	const limit =
		typeof requested === "number" && Number.isFinite(requested) && requested > 0
			? Math.min(Math.floor(requested), MAX_PAGE_SIZE)
			: options.before !== undefined
				? DEFAULT_OLDER_PAGE_SIZE
				: undefined;

	let end = total;
	if (typeof options.before === "number" && Number.isFinite(options.before)) {
		end = Math.max(0, Math.min(total, Math.floor(options.before)));
	}
	let start = limit === undefined ? 0 : Math.max(0, end - limit);
	while (start > 0 && all[start]?.role === "toolResult") start--;

	const messages = all.slice(start, end);
	return { messages, total, start, end: start + messages.length, hasMore: start > 0 };
}

/** Flatten a nested session tree depth-first. Iterative so a long chain cannot
 *  overflow the stack on either side of the wire. */
export function flattenSessionTree(tree: SessionTreeNode[]): RpcSessionTreeFlatNode[] {
	const out: RpcSessionTreeFlatNode[] = [];
	const stack: SessionTreeNode[] = [...tree].reverse();
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		const entry = node.entry;
		out.push({
			id: entry.id,
			parentId: entry.parentId,
			type: entry.type,
			messageRole: entry.type === "message" ? entry.message.role : undefined,
			timestamp: entry.timestamp,
			label: node.label,
			labelTimestamp: node.labelTimestamp,
		});
		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push(node.children[i]);
		}
	}
	return out;
}

export interface TranscriptPage {
	entries: RpcTranscriptEntry[];
	total: number;
	start: number;
	end: number;
	hasMore: boolean;
}

/** Project session entries into the transcript wire shape. Only entries that
 *  a reader can display (messages, summaries, custom messages) survive. */
export function toTranscriptEntries(entries: readonly SessionEntry[]): RpcTranscriptEntry[] {
	const out: RpcTranscriptEntry[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			out.push({
				id: entry.id,
				parentId: entry.parentId,
				type: entry.type,
				timestamp: entry.timestamp,
				message: entry.message,
			});
		} else if (entry.type === "compaction") {
			out.push({
				id: entry.id,
				parentId: entry.parentId,
				type: entry.type,
				timestamp: entry.timestamp,
				summary: entry.summary,
				firstKeptEntryId: entry.firstKeptEntryId,
				tokensBefore: entry.tokensBefore,
			});
		} else if (entry.type === "branch_summary") {
			out.push({
				id: entry.id,
				parentId: entry.parentId,
				type: entry.type,
				timestamp: entry.timestamp,
				summary: entry.summary,
				fromId: entry.fromId,
			});
		} else if (entry.type === "custom_message") {
			out.push({
				id: entry.id,
				parentId: entry.parentId,
				type: entry.type,
				timestamp: entry.timestamp,
				customType: entry.customType,
				content: entry.content,
				display: entry.display,
			});
		}
	}
	return out;
}

export function pageTranscriptEntries(
	all: readonly RpcTranscriptEntry[],
	options: { limit?: number; before?: number } = {},
): TranscriptPage {
	const total = all.length;
	const requested = options.limit;
	const limit =
		typeof requested === "number" && Number.isFinite(requested) && requested > 0
			? Math.min(Math.floor(requested), MAX_PAGE_SIZE)
			: options.before !== undefined
				? DEFAULT_OLDER_PAGE_SIZE
				: undefined;
	let end = total;
	if (typeof options.before === "number" && Number.isFinite(options.before)) {
		end = Math.max(0, Math.min(total, Math.floor(options.before)));
	}
	let start = limit === undefined ? 0 : Math.max(0, end - limit);
	while (start > 0 && all[start]?.type === "message" && all[start]?.message?.role === "toolResult") {
		start--;
	}
	const entries = all.slice(start, end);
	return { entries, total, start, end: start + entries.length, hasMore: start > 0 };
}

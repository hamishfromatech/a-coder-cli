/**
 * Reducer for events forwarded from detached (background) sessions. It mirrors
 * the active transcript's message handling into a per-session cache, but does
 * not touch the active store or the live UI. Drafts are flushed at ~7Hz so a
 * switch paints the in-flight turn without paying an array copy per token.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { RpcEvent } from "./rpc";
import { setCachedSessionMessages } from "./session-cache";
import { useSessionTranscriptsStore } from "../stores/session-transcripts-store";
import { useToolProgressStore } from "../stores/tool-progress-store";

interface Draft {
	messageId: string;
	message: AssistantMessage;
	timer: ReturnType<typeof setTimeout> | null;
}

const drafts = new Map<string, Draft>();

function cloneMessage(message: AssistantMessage): AssistantMessage {
	const content = Array.isArray(message.content)
		? message.content.map((block) => ({ ...block }))
		: message.content;
	return { ...message, content } as AssistantMessage;
}

function flush(sessionFile: string): void {
	const draft = drafts.get(sessionFile);
	if (!draft) return;
	if (draft.timer) {
		clearTimeout(draft.timer);
		draft.timer = null;
	}
	const message = draft.message;
	useSessionTranscriptsStore.getState().update(sessionFile, (previous) => {
		const messages = [...previous.messages];
		if (messages[messages.length - 1]?.role === "assistant") {
			messages[messages.length - 1] = message;
		} else {
			messages.push(message);
		}
		return {
			...previous,
			messages,
			total: Math.max(previous.total, messages.length),
			lastActivity: Date.now(),
		};
	});
	setCachedSessionMessages(sessionFile, useSessionTranscriptsStore.getState().transcripts[sessionFile]?.messages ?? []);
}

function schedule(sessionFile: string): void {
	const draft = drafts.get(sessionFile);
	if (!draft || draft.timer) return;
	draft.timer = setTimeout(() => flush(sessionFile), 150);
}

function append(sessionFile: string, message: AgentMessage): void {
	useSessionTranscriptsStore.getState().update(sessionFile, (previous) => ({
		...previous,
		messages: [...previous.messages, message],
		total: previous.total + 1,
		lastActivity: Date.now(),
	}));
	setCachedSessionMessages(sessionFile, useSessionTranscriptsStore.getState().transcripts[sessionFile]?.messages ?? []);
}

function appendUser(sessionFile: string, message: AgentMessage): void {
	const previous = useSessionTranscriptsStore.getState().transcripts[sessionFile];
	const last = previous?.messages[previous.messages.length - 1];
	if (
		last?.role === "user" &&
		JSON.stringify(last.content) === JSON.stringify((message as { content?: unknown }).content)
	) {
		return;
	}
	append(sessionFile, message);
}

function replaceToolResult(sessionFile: string, message: AgentMessage): void {
	const id = (message as { toolCallId?: string }).toolCallId;
	if (!id) return;
	useSessionTranscriptsStore.getState().update(sessionFile, (previous) => {
		const messages = [...previous.messages];
		const index = messages.findLastIndex(
			(entry) => entry.role === "toolResult" && (entry as { toolCallId?: string }).toolCallId === id,
		);
		if (index >= 0) messages[index] = message;
		else messages.push(message);
		return { ...previous, messages, total: Math.max(previous.total, messages.length), lastActivity: Date.now() };
	});
	setCachedSessionMessages(sessionFile, useSessionTranscriptsStore.getState().transcripts[sessionFile]?.messages ?? []);
}

/** Apply one tagged frame from a subscribed background session. */
export function applyBackgroundSessionEvent(sessionFile: string, event: RpcEvent): void {
	switch (event.type) {
		case "agent_start":
			useSessionTranscriptsStore.getState().update(sessionFile, (previous) => ({
				...previous,
				running: true,
				lastActivity: Date.now(),
			}));
			break;
		case "agent_end":
			flush(sessionFile);
			drafts.delete(sessionFile);
			useSessionTranscriptsStore.getState().update(sessionFile, (previous) => ({
				...previous,
				running: false,
				unread: previous.unread + 1,
				lastActivity: Date.now(),
			}));
			break;
		case "message_start": {
			if (event.message.role === "user") {
				appendUser(sessionFile, event.message);
			} else if (event.message.role === "assistant") {
				const messageId = (event as { messageId?: string }).messageId ?? "";
				drafts.set(sessionFile, {
					messageId,
					message: cloneMessage(event.message),
					timer: null,
				});
			}
			break;
		}
		case "message_delta": {
			const draft = drafts.get(sessionFile);
			if (!draft || (draft.messageId && event.messageId !== draft.messageId)) break;
			const content = draft.message.content;
			if (!Array.isArray(content)) break;
			const index = Math.max(0, event.contentIndex);
			const block = content[index] as { type?: string; text?: string; thinking?: string } | undefined;
			if (event.kind === "text") {
				if (block?.type === "text") block.text = (block.text ?? "") + event.delta;
				else content[index] = { type: "text", text: event.delta } as never;
			} else if (block?.type === "thinking") {
				block.thinking = (block.thinking ?? "") + event.delta;
			} else {
				content[index] = { type: "thinking", thinking: event.delta } as never;
			}
			schedule(sessionFile);
			break;
		}
		case "message_snapshot": {
			drafts.set(sessionFile, {
				messageId: event.messageId,
				message: cloneMessage(event.message),
				timer: null,
			});
			schedule(sessionFile);
			break;
		}
		case "message_update": {
			if (event.message.role !== "assistant") break;
			drafts.set(sessionFile, {
				messageId: (event as { messageId?: string }).messageId ?? "",
				message: cloneMessage(event.message as AssistantMessage),
				timer: null,
			});
			schedule(sessionFile);
			break;
		}
		case "message_end": {
			if (event.message.role === "assistant") {
				const final = event.message;
				const draft = drafts.get(sessionFile);
				if (draft?.timer) clearTimeout(draft.timer);
				drafts.delete(sessionFile);
				useSessionTranscriptsStore.getState().update(sessionFile, (previous) => {
					const messages = [...previous.messages];
					if (messages[messages.length - 1]?.role === "assistant") {
						messages[messages.length - 1] = final;
					} else {
						messages.push(final);
					}
					return { ...previous, messages, total: Math.max(previous.total, messages.length), lastActivity: Date.now() };
				});
				setCachedSessionMessages(sessionFile, useSessionTranscriptsStore.getState().transcripts[sessionFile]?.messages ?? []);
			} else if (event.message.role === "toolResult") {
				replaceToolResult(sessionFile, event.message);
			}
			break;
		}
		case "tool_start":
			useToolProgressStore.getState().start(event.toolCallId, event.toolName);
			break;
		case "tool_delta":
			useToolProgressStore
				.getState()
				.append(event.toolCallId, event.stream, event.delta, event.reset);
			break;
		case "tool_end":
			useToolProgressStore.getState().end(event.toolCallId, event.isError);
			break;
		default:
			break;
	}
}

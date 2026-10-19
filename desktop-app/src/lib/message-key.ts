import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Stable row key: timestamp/role survive appends and prepends, unlike an
 *  array index (which shifts when older history is prepended). */
export function messageKey(message: AgentMessage): string {
	if (message.role === "toolResult") return `tool:${message.toolCallId}`;
	const timestamp = (message as { timestamp?: number }).timestamp ?? 0;
	const content = "content" in message ? message.content : undefined;
	if (message.role === "assistant") {
		const responseId = (message as { responseId?: string }).responseId ?? "";
		return `assistant:${timestamp}:${responseId}`;
	}
	const text = typeof content === "string" ? content.slice(0, 24) : "";
	return `user:${timestamp}:${text}`;
}

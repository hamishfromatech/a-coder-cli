/**
 * ACP (Agent Communication Protocol) types for a-coder-cli's server.
 *
 * Based on the i-am-bee/acp open standard — the same standard the A-Coder IDE
 * implements as a client (see IDE's acpServiceTypes.ts). a-coder-cli exposes
 * itself as an ACP server so the IDE can discover and call it as a tool with
 * zero IDE changes.
 *
 * Endpoints:
 *   GET  /agents          → { agents: AcpAgent[] }
 *   POST /runs            → create+execute a run (sync / async / stream)
 *   GET  /runs/{run_id}   → poll an async run's status
 *
 * The server accepts both the spec request shape (`agent_name`, `mode`) and
 * the A-Coder IDE's simplified shape (`agent`, no `mode` → sync).
 */

/** An agent the server exposes (returned by GET /agents). */
export interface AcpAgent {
	name: string;
	description?: string;
	input_content_types?: string[];
	output_content_types?: string[];
	capabilities?: Record<string, unknown>;
	/** Optional metadata (spec allows a free-form metadata object). */
	metadata?: Record<string, unknown>;
}

/** One part of a message (content + type). */
export interface AcpMessagePart {
	content: string;
	content_type: string;
}

/** A message in a run's input or output. */
export interface AcpMessage {
	role?: string;
	parts: AcpMessagePart[];
}

/** Run execution mode. */
export type AcpRunMode = "sync" | "async" | "stream";

/** POST /runs request body. Accepts both spec and IDE shapes. */
export interface AcpRunRequest {
	/** Spec field. */
	agent_name?: string;
	/** IDE field (alias for agent_name). */
	agent?: string;
	/** Execution mode. Defaults to "sync". */
	mode?: AcpRunMode;
	/** Input messages. */
	input: AcpMessage[];
	/** Optional session id to resume a prior run's context. */
	session_id?: string;
}

/** POST /runs response (sync / async). */
export interface AcpRunResponse {
	run_id: string;
	agent_name: string;
	session_id: string | null;
	status: "completed" | "failed" | "awaiting" | "in-progress";
	output: AcpMessage[];
	error: { code?: string; message: string } | null;
}

/** A single SSE event in a streaming run. */
export interface AcpRunEvent {
	type:
		| "run.created"
		| "run.in-progress"
		| "run.awaiting"
		| "run.completed"
		| "run.failed"
		| "message"
		| "thought"
		| "tool_call";
	run?: AcpRunResponse;
	message?: AcpMessage;
	content?: string;
	error?: { code?: string; message: string };
}

/** Resolve the agent name from a request (supports both spec and IDE shapes). */
export function resolveAgentName(request: AcpRunRequest): string | undefined {
	return request.agent_name ?? request.agent;
}

/** Extract the concatenated text content from input messages. */
export function inputToText(input: AcpMessage[] | undefined): string {
	if (!input) return "";
	const parts: string[] = [];
	for (const message of input) {
		for (const part of message.parts) {
			if (part.content_type === "text/plain" || part.content_type === "text/markdown" || !part.content_type) {
				parts.push(part.content);
			}
		}
	}
	return parts.join("\n");
}

/** Build an output message with the given text from the named agent. */
export function textOutput(agentName: string, text: string): AcpMessage[] {
	if (!text) return [];
	return [{ role: `agent/${agentName}`, parts: [{ content: text, content_type: "text/plain" }] }];
}

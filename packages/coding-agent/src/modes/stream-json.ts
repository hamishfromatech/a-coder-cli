/**
 * Stream-JSON output for print mode: a Claude-Code-flavored NDJSON envelope
 * over the session event stream, for scripting and tooling.
 *
 * Shape:
 *   {"type":"system","subtype":"init", ...session/tool summary}
 *   {"type":"assistant","message":{role, model, content, stopReason, usage}}
 *   {"type":"user","message":{role, content}}
 *   {"type":"event","event":{...}}   (everything else, losslessly)
 *   {"type":"result","subtype":"success"|"error","num_turns","duration_ms",
 *    "usage":{...},"total_cost_usd":X,"is_error":bool,"result":"<text>"}
 */

import type { Usage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "../core/agent-session.ts";

export interface StreamJsonInitInfo {
	sessionId: string;
	cwd: string;
	model: string | undefined;
	tools: string[];
}

export interface StreamJsonUsageState {
	input: number;
	output: number;
	cacheRead: number;
	totalTokens: number;
	totalCostUsd: number;
	numTurns: number;
}

function emptyUsageState(): StreamJsonUsageState {
	return { input: 0, output: 0, cacheRead: 0, totalTokens: 0, totalCostUsd: 0, numTurns: 0 };
}

/** Build the `system/init` line emitted once before the first event. */
export function buildStreamJsonInit(info: StreamJsonInitInfo): string {
	return JSON.stringify({
		type: "system",
		subtype: "init",
		session_id: info.sessionId,
		cwd: info.cwd,
		model: info.model,
		tools: info.tools,
	});
}

/** Accumulate one turn's usage into the running totals. */
export function accumulateUsage(state: StreamJsonUsageState, usage: Usage | undefined): void {
	if (!usage) return;
	state.input += usage.input ?? 0;
	state.output += usage.output ?? 0;
	state.cacheRead += usage.cacheRead ?? 0;
	state.totalTokens += usage.totalTokens ?? 0;
	state.totalCostUsd += usage.cost?.total ?? 0;
	state.numTurns += 1;
}

/**
 * Map one session event to zero or more stream-json lines. Returns [] for
 * events that are folded into the result line only (turn_end) or duplicates.
 */
export function mapEventToStreamJson(event: AgentSessionEvent, state: StreamJsonUsageState): string[] {
	if (event.type === "message_start" || event.type === "message_update") {
		return []; // message_end carries the final message
	}
	if (event.type === "message_end") {
		const message = event.message;
		if (message.role === "assistant") {
			return [
				JSON.stringify({
					type: "assistant",
					message: normalizeMessage(message),
				}),
			];
		}
		return [JSON.stringify({ type: "user", message: normalizeMessage(message) })];
	}
	if (event.type === "turn_end") {
		accumulateUsage(state, event.usage);
		return [];
	}
	return [JSON.stringify({ type: "event", event })];
}

/** Strip non-JSON-serializable / bulky internals from an agent message. */
function normalizeMessage(message: unknown): unknown {
	if (!message || typeof message !== "object") return message;
	const m = message as Record<string, unknown>;
	return {
		role: m.role,
		model: m.model,
		content: m.content,
		stopReason: m.stopReason,
		errorMessage: m.errorMessage,
		usage: m.usage,
	};
}

/** Build the final `result` line. */
export function buildStreamJsonResult(options: {
	state: StreamJsonUsageState;
	startedAt: number;
	resultText: string;
	isError: boolean;
	errorMessage?: string;
}): string {
	return JSON.stringify({
		type: "result",
		subtype: options.isError ? "error" : "success",
		num_turns: options.state.numTurns,
		duration_ms: Date.now() - options.startedAt,
		usage: {
			input: options.state.input,
			output: options.state.output,
			cacheRead: options.state.cacheRead,
			totalTokens: options.state.totalTokens,
		},
		total_cost_usd: options.state.totalCostUsd,
		is_error: options.isError,
		result: options.resultText,
		...(options.isError && options.errorMessage ? { error_message: options.errorMessage } : {}),
	});
}

export { emptyUsageState };

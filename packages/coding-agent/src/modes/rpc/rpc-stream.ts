/**
 * Outbound RPC stream shaping.
 *
 * Contract-1 clients get exactly the AgentSessionEvent stream (plus additive
 * session identity). Contract-2 clients opt into:
 *
 *   - `message_delta` / `message_snapshot` instead of full-message
 *     `message_update` per token;
 *   - `event_batch` frames at ~30Hz;
 *   - a monotonic `seq` and `sessionId`/`sessionFile`/`activationId` on every
 *     session frame so late frames from a prior switch can be discarded.
 *
 * Responses and extension UI requests bypass batching; pending events are
 * flushed first so ordering on the wire never changes.
 */

import type { RpcCapability } from "./rpc-types.ts";

export interface RpcStreamSessionInfo {
	sessionId: string;
	sessionFile?: string;
	activationId: number;
}

interface RpcStreamOptions {
	/** Coalescing window for batch-capable clients. */
	batchMs?: number;
	/** Flush early once this many events are queued. */
	maxBatch?: number;
}

type Frame = Record<string, unknown>;

/** Event types whose latency matters or that mark a structural boundary. */
const IMMEDIATE_EVENTS = new Set([
	"agent_start",
	"agent_end",
	"message_start",
	"message_end",
	"session_start",
	"session_info_changed",
	"compaction_start",
	"compaction_end",
	"queue_update",
	"auto_retry_start",
	"auto_retry_end",
	"thinking_level_changed",
	"plan_mode_changed",
	"tool_permission_update",
]);

export class RpcSessionEventStream {
	private capabilities = new Set<RpcCapability>();
	private pending: Frame[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private seq = 0;
	private messageCounter = 0;
	private assistantMessageIds = new Map<string, string>();
	private toolStreams = new Map<string, { stdout: string; stderr: string }>();
	private readonly write: (frame: Frame) => void;
	private readonly sessionInfo: () => RpcStreamSessionInfo;
	private readonly options: RpcStreamOptions;

	constructor(write: (frame: Frame) => void, sessionInfo: () => RpcStreamSessionInfo, options: RpcStreamOptions = {}) {
		this.write = write;
		this.sessionInfo = sessionInfo;
		this.options = options;
	}

	setCapabilities(capabilities: Iterable<RpcCapability>): void {
		this.capabilities = new Set(capabilities);
	}

	has(capability: RpcCapability): boolean {
		return this.capabilities.has(capability);
	}

	/** Send a response frame immediately, after flushing pending events.
	 *  Responses are correlated by `id`, so they carry no event sequence. */
	pushResponse(frame: Frame): void {
		this.flush();
		this.write(frame);
	}

	/** Send a non-session event (office, cron, runtime registry) immediately. */
	pushImmediate(frame: Frame): void {
		this.flush();
		this.write({ seq: ++this.seq, ...frame });
	}

	/** Shape and enqueue (or write) one AgentSessionEvent. `info` tags frames
	 *  from a subscribed background session; omitted for the active session. */
	push(event: Frame, info?: RpcStreamSessionInfo): void {
		for (const transformed of this.transform(event, info)) {
			if (IMMEDIATE_EVENTS.has(String(transformed.type))) {
				this.flush();
				this.write(transformed);
				continue;
			}
			if (!this.capabilities.has("batch")) {
				this.write(transformed);
				continue;
			}
			this.pending.push(transformed);
			if (this.pending.length >= (this.options.maxBatch ?? 200)) {
				this.flush();
				continue;
			}
			if (!this.timer) {
				this.timer = setTimeout(() => this.flush(), this.options.batchMs ?? 33);
			}
		}
	}

	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		if (this.pending.length === 0) return;
		const events = this.pending;
		this.pending = [];
		if (!this.capabilities.has("batch")) {
			for (const event of events) this.write(event);
			return;
		}
		this.write({
			type: "event_batch",
			seq: events[events.length - 1]?.seq ?? this.seq,
			events,
		});
	}

	dispose(): void {
		this.flush();
	}

	private envelope(event: Frame, override?: RpcStreamSessionInfo): Frame {
		const info = override ?? this.sessionInfo();
		const out: Frame = {
			seq: ++this.seq,
			...event,
			sessionId: info.sessionId,
			sessionFile: info.sessionFile,
			activationId: info.activationId,
		};
		if (out.sessionFile === undefined) delete out.sessionFile;
		return out;
	}

	private transform(event: Frame, override?: RpcStreamSessionInfo): Frame[] {
		const delta = this.capabilities.has("delta");
		const toolProgress = this.capabilities.has("tool-progress");
		const type = String(event.type ?? "");
		const sessionKey = (override ?? this.sessionInfo()).sessionId;

		if (type === "session_start") {
			this.assistantMessageIds.delete(sessionKey);
			this.clearToolStreams(sessionKey);
			return [this.envelope(event, override)];
		}

		if (type === "message_start") {
			const message = event.message as { role?: string } | undefined;
			if (message?.role === "assistant") {
				const messageId = `message-${++this.messageCounter}`;
				this.assistantMessageIds.set(sessionKey, messageId);
				return [this.envelope({ ...event, messageId }, override)];
			}
			return [this.envelope(event, override)];
		}

		if (type === "message_update") {
			if (!delta) return [this.envelope(event, override)];
			const messageId = this.assistantMessageIds.get(sessionKey) ?? "";
			const assistant = event.assistantMessageEvent as
				| { type?: string; contentIndex?: number; delta?: string }
				| undefined;
			if (!assistant)
				return [this.envelope({ type: "message_snapshot", messageId, message: event.message }, override)];
			if (assistant.type === "text_delta" || assistant.type === "thinking_delta") {
				return [
					this.envelope(
						{
							type: "message_delta",
							messageId,
							contentIndex: assistant.contentIndex ?? 0,
							kind: assistant.type === "text_delta" ? "text" : "thinking",
							delta: assistant.delta ?? "",
						},
						override,
					),
				];
			}
			if (assistant.type === "toolcall_end") {
				return [
					this.envelope(
						{
							type: "message_snapshot",
							messageId,
							message: event.message,
						},
						override,
					),
				];
			}
			// start/text_start/text_end/thinking_start/thinking_end/toolcall_start/
			// toolcall_delta carry no information the deltas + final message lack.
			return [];
		}

		if (type === "message_end") {
			const message = event.message as { role?: string } | undefined;
			if (message?.role === "assistant") {
				const messageId = this.assistantMessageIds.get(sessionKey) ?? `message-${++this.messageCounter}`;
				this.assistantMessageIds.set(sessionKey, messageId);
				return [this.envelope({ ...event, messageId }, override)];
			}
			return [this.envelope(event, override)];
		}

		if (type === "session_tree_changed") {
			return [
				this.envelope(
					{
						type: "tree_delta",
						version: event.version,
						leafId: event.leafId,
						added: [event.entry],
					},
					override,
				),
			];
		}

		if (type === "entry_appended") {
			const entry = event.entry as
				| {
						id?: string;
						parentId?: string | null;
						type?: string;
						message?: { role?: string };
						timestamp?: string;
				  }
				| undefined;
			if (entry?.id) {
				return [
					this.envelope({
						type: "tree_delta",
						leafId: entry.id,
						added: [
							{
								id: entry.id,
								parentId: entry.parentId ?? null,
								type: entry.type ?? "custom",
								messageRole: entry.message?.role,
								timestamp: entry.timestamp,
							},
						],
					}),
				];
			}
			return [];
		}

		if (type === "tool_execution_start") {
			if (!toolProgress) return [];
			const toolCallId = String(event.toolCallId ?? "");
			if (!toolCallId) return [];
			this.toolStreams.delete(`${sessionKey}:${toolCallId}`);
			return [
				this.envelope({ type: "tool_start", toolCallId, toolName: event.toolName, args: event.args }, override),
			];
		}

		if (type === "tool_execution_update") {
			return toolProgress ? this.toolDeltas(sessionKey, event, override) : [];
		}

		if (type === "tool_execution_end") {
			if (!toolProgress) return [];
			const toolCallId = String(event.toolCallId ?? "");
			this.toolStreams.delete(`${sessionKey}:${toolCallId}`);
			return [
				this.envelope(
					{
						type: "tool_end",
						toolCallId,
						toolName: event.toolName,
						isError: event.isError === true,
					},
					override,
				),
			];
		}

		if (type === "agent_end" && delta) {
			this.clearToolStreams(sessionKey);
			return [
				this.envelope(
					{ type: "agent_end", willRetry: event.willRetry === true, summary: summarizeAgentEnd(event) },
					override,
				),
			];
		}

		if (delta && (type === "turn_end" || type === "entry_appended")) {
			// Duplicates of message_end / tree state; opt-in consumers can use
			// get_entries instead.
			return [];
		}

		return [this.envelope(event, override)];
	}

	private toolDeltas(sessionKey: string, event: Frame, override?: RpcStreamSessionInfo): Frame[] {
		const toolCallId = String(event.toolCallId ?? "");
		if (!toolCallId) return [];
		const key = `${sessionKey}:${toolCallId}`;
		const previous = this.toolStreams.get(key) ?? { stdout: "", stderr: "" };
		const partial = event.partialResult as
			| {
					content?: Array<{ type?: string; text?: unknown }>;
					details?: {
						stderr?: unknown;
						progress?: unknown;
						total?: unknown;
						percent?: unknown;
						message?: unknown;
					};
			  }
			| undefined;
		// A progress-only update carries no content; keep the live stream intact.
		const stdout = Array.isArray(partial?.content)
			? partial.content
					.filter((block) => block?.type === "text")
					.map((block) => (typeof block.text === "string" ? block.text : ""))
					.join("")
			: previous.stdout;
		const stderr = typeof partial?.details?.stderr === "string" ? partial.details.stderr : previous.stderr;
		const frames: Frame[] = [];
		const next = { stdout, stderr };

		const details = partial?.details;
		if (typeof details?.progress === "number" && Number.isFinite(details.progress)) {
			const total = typeof details.total === "number" && Number.isFinite(details.total) ? details.total : undefined;
			const percent =
				typeof details.percent === "number" && Number.isFinite(details.percent)
					? details.percent
					: typeof total === "number" && total > 0
						? Math.round(Math.min(1, Math.max(0, details.progress / total)) * 100)
						: undefined;
			frames.push(
				this.envelope(
					{
						type: "tool_progress",
						toolCallId,
						toolName: event.toolName,
						progress: details.progress,
						...(total !== undefined ? { total } : {}),
						...(percent !== undefined ? { percent } : {}),
						...(typeof details.message === "string" && details.message ? { message: details.message } : {}),
					},
					override,
				),
			);
		}
		for (const stream of ["stdout", "stderr"] as const) {
			const before = previous[stream];
			const after = next[stream];
			if (after === before) continue;
			const reset = !after.startsWith(before);
			const delta = reset ? after : after.slice(before.length);
			if (!delta) continue;
			frames.push(
				this.envelope(
					{
						type: "tool_delta",
						toolCallId,
						toolName: event.toolName,
						stream,
						delta,
						...(reset ? { reset: true } : {}),
					},
					override,
				),
			);
		}
		this.toolStreams.set(key, next);
		return frames;
	}

	private clearToolStreams(sessionKey: string): void {
		for (const key of this.toolStreams.keys()) {
			if (key.startsWith(`${sessionKey}:`)) this.toolStreams.delete(key);
		}
	}
}

function assistantText(message: { content?: unknown } | undefined): string {
	if (!Array.isArray(message?.content)) return "";
	return message.content
		.filter((block): block is { type?: string; text?: string } => typeof block === "object" && block !== null)
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
}

function summarizeAgentEnd(event: Frame): {
	messageCount: number;
	lastAssistantText: string;
	stopReason?: string;
	usage?: unknown;
} {
	const messages = Array.isArray(event.messages) ? event.messages : [];
	const assistant = [...messages]
		.reverse()
		.find((message) => (message as { role?: string } | undefined)?.role === "assistant") as
		| { content?: unknown; stopReason?: string; usage?: unknown }
		| undefined;
	return {
		messageCount: messages.length,
		lastAssistantText: assistantText(assistant),
		stopReason: assistant?.stopReason,
		usage: assistant?.usage,
	};
}

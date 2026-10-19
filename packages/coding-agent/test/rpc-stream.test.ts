import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcSessionEventStream, type RpcStreamSessionInfo } from "../src/modes/rpc/rpc-stream.ts";

function makeStream(info: RpcStreamSessionInfo = { sessionId: "s1", sessionFile: "/s1.jsonl", activationId: 1 }) {
	const frames: Record<string, unknown>[] = [];
	let current = info;
	const stream = new RpcSessionEventStream(
		(frame) => frames.push(frame),
		() => current,
	);
	return {
		stream,
		frames,
		setInfo(next: RpcStreamSessionInfo) {
			current = next;
		},
	};
}

const assistantStart = (messageId = "message-1") => ({
	type: "message_start",
	message: { role: "assistant", content: [] },
	messageId,
});

afterEach(() => {
	vi.useRealTimers();
});

describe("RpcSessionEventStream", () => {
	it("passes contract-1 events through with identity and sequence", () => {
		const h = makeStream();
		h.stream.push({ type: "agent_start" });
		expect(h.frames).toHaveLength(1);
		expect(h.frames[0]).toMatchObject({
			type: "agent_start",
			seq: 1,
			sessionId: "s1",
			sessionFile: "/s1.jsonl",
			activationId: 1,
		});
	});

	it("emits compact text/thinking deltas and drops redundant updates", () => {
		const h = makeStream();
		h.stream.setCapabilities(["delta"]);
		h.stream.push(assistantStart());
		h.stream.push({
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" },
		});
		h.stream.push({
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hm" },
		});
		h.stream.push({
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: '{"a"' },
		});
		h.stream.push({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: {} });

		expect(h.frames.map((f) => f.type)).toEqual(["message_start", "message_delta", "message_delta"]);
		expect(h.frames[1]).toMatchObject({ kind: "text", contentIndex: 0, delta: "Hel", messageId: "message-1" });
		expect(h.frames[2]).toMatchObject({ kind: "thinking", contentIndex: 0, delta: "hm" });
	});

	it("sends a snapshot at tool-call end", () => {
		const h = makeStream();
		h.stream.setCapabilities(["delta"]);
		h.stream.push(assistantStart());
		h.stream.push({
			type: "message_update",
			message: { role: "assistant", content: [{ type: "toolCall", id: "t1" }] },
			assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { id: "t1" } },
		});
		expect(h.frames[1]).toMatchObject({
			type: "message_snapshot",
			messageId: "message-1",
			message: { content: [{ type: "toolCall", id: "t1" }] },
		});
	});

	it("batches deltas at 30Hz while keeping order", () => {
		vi.useFakeTimers();
		const h = makeStream();
		h.stream.setCapabilities(["delta", "batch"]);
		h.stream.push(assistantStart());
		h.stream.push({ type: "message_delta", messageId: "message-1", contentIndex: 0, kind: "text", delta: "a" });
		h.stream.push({ type: "message_delta", messageId: "message-1", contentIndex: 0, kind: "text", delta: "b" });
		expect(h.frames).toHaveLength(1); // start flushed immediately
		vi.advanceTimersByTime(34);
		expect(h.frames).toHaveLength(2);
		const batch = h.frames[1] as { type: string; events: Array<{ delta?: string; seq: number }> };
		expect(batch.type).toBe("event_batch");
		expect(batch.events.map((e) => e.delta)).toEqual(["a", "b"]);
		expect(batch.events[0]?.seq).toBeLessThan(batch.events[1]?.seq ?? 0);
	});

	it("flushes pending events before an immediate event and a response", () => {
		vi.useFakeTimers();
		const h = makeStream();
		h.stream.setCapabilities(["delta", "batch"]);
		h.stream.push(assistantStart());
		h.stream.push({ type: "message_delta", messageId: "message-1", contentIndex: 0, kind: "text", delta: "x" });
		h.stream.push({ type: "message_end", message: { role: "assistant", content: [] }, messageId: "message-1" });
		expect(h.frames.map((f) => f.type)).toEqual(["message_start", "event_batch", "message_end"]);

		h.stream.pushResponse({ type: "response", command: "get_state", success: true });
		expect(h.frames.at(-1)).toMatchObject({ type: "response", command: "get_state" });
	});

	it("captures session identity at enqueue time, not flush time", () => {
		vi.useFakeTimers();
		const h = makeStream({ sessionId: "old", sessionFile: "/old.jsonl", activationId: 1 });
		h.stream.setCapabilities(["batch"]);
		h.stream.push({ type: "message_snapshot", messageId: "m1", message: { role: "assistant", content: [] } });
		h.setInfo({ sessionId: "new", sessionFile: "/new.jsonl", activationId: 2 });
		h.stream.flush();
		const batch = h.frames[0] as { events: Array<{ sessionId: string; activationId: number }> };
		expect(batch.events[0]).toMatchObject({ sessionId: "old", activationId: 1 });
	});

	it("turns session_tree_changed into a slim tree delta", () => {
		const h = makeStream();
		h.stream.setCapabilities(["delta"]);
		h.stream.push({
			type: "session_tree_changed",
			entry: { id: "e2", parentId: "e1", type: "message", messageRole: "assistant", timestamp: "t2" },
			leafId: "e2",
			version: 2,
		});
		expect(h.frames[0]).toMatchObject({
			type: "tree_delta",
			version: 2,
			leafId: "e2",
			added: [{ id: "e2", parentId: "e1", type: "message", messageRole: "assistant" }],
		});
	});

	it("tags background frames with their own identity and message id", () => {
		const h = makeStream({ sessionId: "active", sessionFile: "/active.jsonl", activationId: 1 });
		h.stream.setCapabilities(["delta"]);
		const bg = { sessionId: "bg", sessionFile: "/bg.jsonl", activationId: 900001 };
		h.stream.push(assistantStart(), bg);
		h.stream.push(
			{
				type: "message_delta",
				messageId: "message-1",
				contentIndex: 0,
				kind: "text",
				delta: "bg",
			},
			bg,
		);
		h.stream.push(assistantStart(), undefined);
		expect(h.frames[0]).toMatchObject({ sessionId: "bg", sessionFile: "/bg.jsonl", activationId: 900001 });
		expect(h.frames[1]).toMatchObject({ sessionId: "bg", delta: "bg" });
		expect(h.frames[2]?.messageId).not.toBe(h.frames[0]?.messageId);
	});

	it("assigns a new message id per assistant message", () => {
		const h = makeStream();
		h.stream.setCapabilities(["delta"]);
		h.stream.push(assistantStart("message-1"));
		h.stream.push({ type: "message_end", message: { role: "assistant", content: [] }, messageId: "message-1" });
		h.stream.push(assistantStart("message-2"));
		h.stream.push({ type: "message_delta", messageId: "message-2", contentIndex: 0, kind: "text", delta: "z" });
		expect(h.frames.at(-1)?.messageId).toBe("message-2");
	});
});

describe("tool progress and agent_end summary", () => {
	it("streams only tool output deltas and resets when the window shifts", () => {
		const h = makeStream();
		h.stream.setCapabilities(["tool-progress"]);
		h.stream.push({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } });
		h.stream.push({
			type: "tool_execution_update",
			toolCallId: "t1",
			toolName: "bash",
			partialResult: { content: [{ type: "text", text: "abc" }] },
		});
		h.stream.push({
			type: "tool_execution_update",
			toolCallId: "t1",
			toolName: "bash",
			partialResult: { content: [{ type: "text", text: "abcdef" }], details: { stderr: "warn" } },
		});
		h.stream.push({
			type: "tool_execution_update",
			toolCallId: "t1",
			toolName: "bash",
			partialResult: {
				content: [{ type: "text", text: "cdef" }],
				details: { stderr: "warn\nmore" },
			},
		});
		h.stream.push({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: false });

		expect(h.frames.map((frame) => frame.type)).toEqual([
			"tool_start",
			"tool_delta",
			"tool_delta",
			"tool_delta",
			"tool_delta",
			"tool_delta",
			"tool_end",
		]);
		expect(h.frames[1]).toMatchObject({ stream: "stdout", delta: "abc" });
		expect(h.frames[2]).toMatchObject({ stream: "stdout", delta: "def" });
		expect(h.frames[3]).toMatchObject({ stream: "stderr", delta: "warn" });
		expect(h.frames[4]).toMatchObject({ stream: "stdout", delta: "cdef", reset: true });
		expect(h.frames[5]).toMatchObject({ stream: "stderr" });
		expect((h.frames[5] as { delta: string }).delta).toContain("more");
		expect(h.frames[6]).toMatchObject({ type: "tool_end", isError: false });
	});

	it("keeps contract-1 clients free of tool execution events", () => {
		const h = makeStream();
		h.stream.push({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: {} });
		h.stream.push({
			type: "tool_execution_update",
			toolCallId: "t1",
			toolName: "bash",
			partialResult: { content: [{ type: "text", text: "abc" }] },
		});
		h.stream.push({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: false });
		expect(h.frames).toHaveLength(0);
	});

	it("replaces agent_end messages with a summary for delta clients", () => {
		const h = makeStream();
		h.stream.setCapabilities(["delta"]);
		h.stream.push({
			type: "agent_end",
			messages: [
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{
					role: "assistant",
					content: [{ type: "text", text: "done" }],
					stopReason: "stop",
					usage: { input: 1, output: 2 },
				},
			],
			willRetry: false,
		});
		const frame = h.frames[0] as Record<string, unknown>;
		expect(frame).toMatchObject({
			type: "agent_end",
			willRetry: false,
			summary: { messageCount: 2, lastAssistantText: "done", stopReason: "stop" },
		});
		expect("messages" in frame).toBe(false);
	});
});

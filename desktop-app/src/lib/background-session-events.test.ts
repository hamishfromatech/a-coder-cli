import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { beforeEach, describe, expect, it } from "vitest";
import { applyBackgroundSessionEvent } from "./background-session-events";
import { clearSessionCache, getCachedSessionMessages } from "./session-cache";
import { useSessionTranscriptsStore } from "../stores/session-transcripts-store";
import type * as rpc from "./rpc";

const FILE = "/sessions/bg.jsonl";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] }) as AgentMessage;
const assistant = (text: string) =>
	({ role: "assistant", content: [{ type: "text", text }] }) as unknown as AgentMessage;

const start = (messageId = "m1") =>
	({ type: "message_start", message: assistant(""), messageId, sessionFile: FILE }) as unknown as rpc.RpcEvent;
const delta = (text: string) =>
	({
		type: "message_delta",
		messageId: "m1",
		contentIndex: 0,
		kind: "text",
		delta: text,
		sessionFile: FILE,
	}) as unknown as rpc.RpcEvent;
const end = (text: string) =>
	({ type: "message_end", message: assistant(text), messageId: "m1", sessionFile: FILE }) as unknown as rpc.RpcEvent;

beforeEach(() => {
	clearSessionCache();
	useSessionTranscriptsStore.setState({ transcripts: {}, subscribed: {} });
	useSessionTranscriptsStore.getState().update(FILE, (previous) => ({
		...previous,
		messages: [user("hello")],
		total: 1,
	}));
});

describe("background session events", () => {
	it("commits the final assistant message and caches the transcript", () => {
		applyBackgroundSessionEvent(FILE, start());
		applyBackgroundSessionEvent(FILE, delta("par"));
		applyBackgroundSessionEvent(FILE, end("partial reply"));
		const messages = useSessionTranscriptsStore.getState().transcripts[FILE]?.messages ?? [];
		expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect((messages[1] as { content: Array<{ text?: string }> }).content[0]?.text).toBe("partial reply");
		expect(getCachedSessionMessages(FILE)).toBe(messages);
	});

	it("marks a finished background turn unread and tracks running state", () => {
		applyBackgroundSessionEvent(FILE, { type: "agent_start", sessionFile: FILE } as unknown as rpc.RpcEvent);
		expect(useSessionTranscriptsStore.getState().transcripts[FILE]?.running).toBe(true);
		applyBackgroundSessionEvent(FILE, { type: "agent_end", sessionFile: FILE } as unknown as rpc.RpcEvent);
		const transcript = useSessionTranscriptsStore.getState().transcripts[FILE];
		expect(transcript?.running).toBe(false);
		expect(transcript?.unread).toBe(1);
	});

	it("replaces a tool result by toolCallId", () => {
		const result = (text: string) =>
			({ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text }] }) as unknown as AgentMessage;
		applyBackgroundSessionEvent(
			FILE,
			{ type: "message_end", message: result("partial"), sessionFile: FILE } as unknown as rpc.RpcEvent,
		);
		applyBackgroundSessionEvent(
			FILE,
			{ type: "message_end", message: result("final"), sessionFile: FILE } as unknown as rpc.RpcEvent,
		);
		const messages = useSessionTranscriptsStore.getState().transcripts[FILE]?.messages ?? [];
		expect(messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
		expect((messages.at(-1) as { content: Array<{ text?: string }> }).content[0]?.text).toBe("final");
	});
});

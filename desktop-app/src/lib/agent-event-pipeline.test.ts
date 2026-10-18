// @vitest-environment jsdom
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	sendCommand: vi.fn(),
	setSessionName: vi.fn(),
}));

vi.mock("./rpc", () => ({
	ENGINE_RPC_CONTRACT: 1,
	sendCommand: h.sendCommand,
	setSessionName: h.setSessionName,
	reloadAuth: vi.fn(async () => {}),
	sendUiResponse: vi.fn(async () => {}),
}));

vi.mock("./external-link", () => ({ openExternalLink: vi.fn() }));
vi.mock("./completion-sound", () => ({ playCompletionSound: vi.fn() }));
vi.mock("./voice", () => ({
	playAudioBlob: vi.fn(),
	synthesize: vi.fn(async () => new Blob()),
}));
vi.mock("./haptics", () => ({ triggerHaptic: vi.fn() }));
vi.mock("./voice-call", () => ({
	voiceCall: {
		notifyAgentStart: vi.fn(),
		notifyAgentAborted: vi.fn(),
		notifyAgentEnd: vi.fn(),
		notifyAssistantMessage: vi.fn(),
	},
	useVoiceCallStore: { getState: () => ({ active: false }) },
}));

import { processAgentEvent, mergeUserEchoes, type AgentEventDeps } from "./agent-event-pipeline";
import { useSessionStore } from "../stores/session-store";
import { clearSessionCache, getCachedSessionMessages, setCachedSessionMessages } from "./session-cache";
import type * as rpc from "./rpc";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function user(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }] } as unknown as AgentMessage;
}

function assistant(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
	} as unknown as AgentMessage;
}

function messageStart(message: AgentMessage): rpc.RpcEvent {
	return { type: "message_start", message } as unknown as rpc.RpcEvent;
}

function messageUpdate(message: AgentMessage): rpc.RpcEvent {
	return { type: "message_update", message } as unknown as rpc.RpcEvent;
}

function sessionStart(): rpc.RpcEvent {
	return { type: "session_start" } as unknown as rpc.RpcEvent;
}

function makeDeps(sessionFile: string | null = "/sessions/s1.jsonl"): AgentEventDeps {
	return {
		loadingHistoryRef: { current: false },
		sessionStartGenerationRef: { current: 0 },
		parkedQuestionsRef: new Map(),
		deferredUserEchoesRef: { current: [] },
		syncEngineState: vi.fn(async () => {
			useSessionStore.getState().setSessionFile(sessionFile);
		}),
	} as AgentEventDeps;
}

/** Resolve a promise on demand so a history fetch can be held in flight. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function mockHistory(messages: AgentMessage[]): void {
	h.sendCommand.mockImplementation(async (cmd: { type: string }) => {
		if (cmd.type === "get_tree") return { tree: [], leafId: null };
		if (cmd.type === "get_messages") return { messages };
		if (cmd.type === "get_session_stats") return null;
		return null;
	});
}

beforeEach(() => {
	h.sendCommand.mockReset();
	h.setSessionName.mockReset();
	clearSessionCache();
	useSessionStore.getState().resetSession();
});

// ---------------------------------------------------------------------------
// mergeUserEchoes
// ---------------------------------------------------------------------------

describe("mergeUserEchoes", () => {
	it("returns the snapshot untouched when nothing was deferred", () => {
		const fetched = [user("a"), assistant("b")];
		expect(mergeUserEchoes(fetched, [])).toBe(fetched);
	});

	it("restores a trailing echo the snapshot is missing", () => {
		const merged = mergeUserEchoes([user("a"), assistant("b")], [user("typed during load")]);
		expect(merged.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
	});

	it("does not duplicate an echo the snapshot already contains", () => {
		const merged = mergeUserEchoes([user("same text")], [user("same text")]);
		expect(merged).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Session switch: the latch must be released, or every later send is swallowed
// ---------------------------------------------------------------------------

describe("session_start history load", () => {
	it("releases the history latch after painting the snapshot", async () => {
		mockHistory([user("old"), assistant("reply")]);
		const deps = makeDeps();

		processAgentEvent(sessionStart(), deps);
		expect(deps.loadingHistoryRef.current).toBe(true);

		await vi.waitFor(() => expect(deps.loadingHistoryRef.current).toBe(false));
		expect(useSessionStore.getState().messages).toHaveLength(2);
		expect(useSessionStore.getState().sessionLoading).toBe(false);
	});

	it("renders live sends normally after the switch settles", async () => {
		mockHistory([]);
		const deps = makeDeps();

		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(deps.loadingHistoryRef.current).toBe(false));

		processAgentEvent(messageStart(user("hello")), deps);
		expect(useSessionStore.getState().messages.map((m) => m.role)).toEqual(["user"]);

		processAgentEvent(messageUpdate(assistant("hi there")), deps);
		expect(useSessionStore.getState().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	});

	it("defers an echo sent while history is in flight and merges it once", async () => {
		const gate = deferred<{ messages: AgentMessage[] }>();
		h.sendCommand.mockImplementation(async (cmd: { type: string }) => {
			if (cmd.type === "get_tree") return { tree: [], leafId: null };
			if (cmd.type === "get_messages") return gate.promise;
			return null;
		});
		const deps = makeDeps();

		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(deps.syncEngineState).toHaveBeenCalled());
		processAgentEvent(messageStart(user("send during load")), deps);
		expect(useSessionStore.getState().messages).toHaveLength(0);
		expect(deps.deferredUserEchoesRef.current).toHaveLength(1);

		gate.resolve({ messages: [assistant("existing")] });
		await vi.waitFor(() => expect(deps.loadingHistoryRef.current).toBe(false));

		expect(useSessionStore.getState().messages.map((m) => m.role)).toEqual(["assistant", "user"]);
		expect(deps.deferredUserEchoesRef.current).toHaveLength(0);
	});

	it("discards a superseded switch instead of painting its transcript", async () => {
		const first = deferred<{ messages: AgentMessage[] }>();
		const second = deferred<{ messages: AgentMessage[] }>();
		let call = 0;
		h.sendCommand.mockImplementation(async (cmd: { type: string }) => {
			if (cmd.type === "get_tree") return { tree: [], leafId: null };
			if (cmd.type === "get_messages") {
				call += 1;
				return call === 1 ? first.promise : second.promise;
			}
			return null;
		});
		const deps = makeDeps();

		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(call).toBe(1));
		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(call).toBe(2));

		second.resolve({ messages: [assistant("second session")] });
		await vi.waitFor(() => expect(deps.loadingHistoryRef.current).toBe(false));
		expect(useSessionStore.getState().messages).toHaveLength(1);

		// The abandoned first fetch settles late: it must not clobber the new
		// session, and its deferred echoes must not leak into it either.
		first.resolve({ messages: [assistant("first session")] });
		await new Promise((r) => setTimeout(r, 20));
		expect(
			(useSessionStore.getState().messages[0] as { content: Array<{ text?: string }> }).content[0]?.text,
		).toBe("second session");
	});

	it("never paints an abandoned switch's deferred echo into the new session", async () => {
		const first = deferred<{ messages: AgentMessage[] }>();
		const second = deferred<{ messages: AgentMessage[] }>();
		let call = 0;
		h.sendCommand.mockImplementation(async (cmd: { type: string }) => {
			if (cmd.type === "get_tree") return { tree: [], leafId: null };
			if (cmd.type === "get_messages") {
				call += 1;
				return call === 1 ? first.promise : second.promise;
			}
			return null;
		});
		const deps = makeDeps();

		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(call).toBe(1));
		processAgentEvent(messageStart(user("belongs to first")), deps);

		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(call).toBe(2));

		second.resolve({ messages: [assistant("second session")] });
		await vi.waitFor(() => expect(deps.loadingHistoryRef.current).toBe(false));
		first.resolve({ messages: [assistant("first session")] });
		await new Promise((r) => setTimeout(r, 20));

		const texts = useSessionStore
			.getState()
			.messages.map((m) => (m as { content: Array<{ text?: string }> }).content[0]?.text);
		expect(texts).toEqual(["second session"]);
	});

	it("keeps the warm cache current with live messages", async () => {
		mockHistory([]);
		const deps = makeDeps();
		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(deps.loadingHistoryRef.current).toBe(false));

		processAgentEvent(messageStart(user("live send")), deps);
		const cached = getCachedSessionMessages("/sessions/s1.jsonl");
		expect(cached?.map((m) => m.role)).toEqual(["user"]);

		processAgentEvent(messageUpdate(assistant("live reply")), deps);
		expect(getCachedSessionMessages("/sessions/s1.jsonl")?.map((m) => m.role)).toEqual([
			"user",
			"assistant",
		]);
	});

	it("suppresses a duplicate user echo after the latch clears", async () => {
		mockHistory([user("hello")]);
		const deps = makeDeps();
		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(deps.loadingHistoryRef.current).toBe(false));

		processAgentEvent(messageStart(user("hello")), deps);
		expect(useSessionStore.getState().messages).toHaveLength(1);
	});

	it("paints the warm cache before the snapshot arrives", async () => {
		setCachedSessionMessages("/sessions/s1.jsonl", [user("cached"), assistant("cached reply")]);
		const gate = deferred<{ messages: AgentMessage[] }>();
		h.sendCommand.mockImplementation(async (cmd: { type: string }) => {
			if (cmd.type === "get_tree") return { tree: [], leafId: null };
			if (cmd.type === "get_messages") return gate.promise;
			return null;
		});
		const deps = makeDeps();

		processAgentEvent(sessionStart(), deps);
		await vi.waitFor(() => expect(useSessionStore.getState().messages).toHaveLength(2));

		gate.resolve({ messages: [user("fresh")] });
		await vi.waitFor(() => expect(deps.loadingHistoryRef.current).toBe(false));
		expect(useSessionStore.getState().messages).toHaveLength(1);
	});
});

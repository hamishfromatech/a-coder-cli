// @vitest-environment jsdom
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	sendCommand: vi.fn(),
	setSessionName: vi.fn(),
}));

vi.mock("./rpc", () => ({
	ENGINE_RPC_CONTRACT: 1,
	sendCommand: h.sendCommand,
	getMessages: (options?: { limit?: number; before?: number }) =>
		h.sendCommand({ type: "get_messages", ...options }),
	getTree: (flat?: boolean) => h.sendCommand({ type: "get_tree", flat }),
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

import {
	processAgentEvent,
	mergeUserEchoes,
	resetStreamingAccumulator,
	type AgentEventDeps,
} from "./agent-event-pipeline";
import { useSessionStore } from "../stores/session-store";
import { useToastStore } from "../stores/toast-store";
import { clearSessionCache, getCachedSessionMessages, setCachedSessionMessages } from "./session-cache";
import { useSessionTranscriptsStore } from "../stores/session-transcripts-store";
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
	useToastStore.getState().clear();
	useSessionTranscriptsStore.setState({ transcripts: {}, subscribed: {} });
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
// Auto-continue toast
// ---------------------------------------------------------------------------

describe("auto-continue toast", () => {
	it("uses human copy and never renders the raw diagnostic summary or a float latency", () => {
		processAgentEvent(
			{
				type: "auto_continue_decision",
				checkpoint: "agent_end",
				action: "stop",
				probabilities: { continue: 0.01, ask_user: 0.02, done: 0.96, blocked: 0.01 },
				progress: 0.56,
				completion: 0.96,
				model: "clef:27b",
				latencyMs: 533.381500000177,
				reason: "model recommended stopping",
				diagnostic: "next=done p=0.01 progress=0.56 completion=0.96",
			} as unknown as rpc.RpcEvent,
			makeDeps(),
		);

		const [t] = useToastStore.getState().toasts;
		expect(t.title).toBe("Auto-continue stopped");
		expect(t.message).toBe("model recommended stopping · progress 56% · done 96% · 533ms · clef:27b");
		expect(t.message).not.toContain("next=");
		expect(t.message).not.toContain("533.3815");
	});

	it("shows only the guard reason when no model call ran", () => {
		processAgentEvent(
			{
				type: "auto_continue_decision",
				checkpoint: "agent_end",
				action: "stop",
				probabilities: {},
				progress: 0,
				latencyMs: 0,
				reason: "tool error streak reached (3)",
			} as unknown as rpc.RpcEvent,
			makeDeps(),
		);

		const [t] = useToastStore.getState().toasts;
		expect(t.message).toBe("tool error streak reached (3)");
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
		expect(useSessionStore.getState().messages.map((m) => m.role)).toEqual(["user"]);
		expect(
			(useSessionStore.getState().streamingMessage as { content: Array<{ text?: string }> }).content[0]
				?.text,
		).toBe("hi there");
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


// ---------------------------------------------------------------------------
// Contract-2 streaming deltas
// ---------------------------------------------------------------------------

describe("contract-2 streaming deltas", () => {
	const SESSION = "/sessions/s1.jsonl";
	const activation = 7;

	beforeEach(() => {
		vi.useFakeTimers();
		const store = useSessionStore.getState();
		store.setSessionFile(SESSION);
		store.setActivationId(activation);
	});

	afterEach(() => {
		resetStreamingAccumulator();
		vi.useRealTimers();
	});

	const start = (messageId = "m1") =>
		({
			type: "message_start",
			message: { role: "assistant", content: [] },
			messageId,
			sessionFile: SESSION,
			activationId: activation,
		}) as unknown as rpc.RpcEvent;

	const delta = (text: string, overrides: Record<string, unknown> = {}) =>
		({
			type: "message_delta",
			messageId: "m1",
			contentIndex: 0,
			kind: "text",
			delta: text,
			sessionFile: SESSION,
			activationId: activation,
			...overrides,
		}) as unknown as rpc.RpcEvent;

	it("coalesces text deltas into one store commit", () => {
		const deps = makeDeps();
		processAgentEvent(start(), deps);
		processAgentEvent(delta("Hel"), deps);
		processAgentEvent(delta("lo"), deps);

		// The committed transcript stays untouched; the draft lands in its own
		// slice once the frame timer fires.
		expect(useSessionStore.getState().messages).toHaveLength(0);
		vi.advanceTimersByTime(16);
		expect(useSessionStore.getState().messages).toHaveLength(0);
		const streaming = useSessionStore.getState().streamingMessage;
		expect((streaming as { content: Array<{ text?: string }> }).content[0]?.text).toBe("Hello");
	});

	it("keeps the committed transcript array identity stable while streaming", () => {
		const deps = makeDeps();
		useSessionStore.getState().appendMessage(user("hello"));
		const committed = useSessionStore.getState().messages;
		processAgentEvent(start(), deps);
		processAgentEvent(delta("Hel"), deps);
		processAgentEvent(delta("lo"), deps);
		vi.advanceTimersByTime(16);
		expect(useSessionStore.getState().messages).toBe(committed);
		expect(useSessionStore.getState().streamingMessage).not.toBeNull();
	});

	it("writes the authoritative message_end over the draft", () => {
		const deps = makeDeps();
		processAgentEvent(start(), deps);
		processAgentEvent(delta("partial"), deps);
		processAgentEvent(
			{
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text: "final" }] },
				messageId: "m1",
				sessionFile: SESSION,
				activationId: activation,
			} as unknown as rpc.RpcEvent,
			deps,
		);
		const messages = useSessionStore.getState().messages;
		expect(messages).toHaveLength(1);
		expect((messages[0] as { content: Array<{ text?: string }> }).content[0]?.text).toBe("final");
	});

	it("ignores frames from another session or activation", () => {
		const deps = makeDeps();
		processAgentEvent(start(), deps);
		processAgentEvent(delta("wrong session", { sessionFile: "/sessions/other.jsonl" }), deps);
		processAgentEvent(delta("wrong activation", { activationId: activation - 1 }), deps);
		vi.advanceTimersByTime(20);
		expect(useSessionStore.getState().messages).toHaveLength(0);
		expect(useSessionStore.getState().streamingMessage).toBeNull();
	});

	it("applies deltas inside an event_batch", () => {
		const deps = makeDeps();
		processAgentEvent(start(), deps);
		processAgentEvent(
			{
				type: "event_batch",
				seq: 10,
				events: [delta("a"), delta("b")],
			} as unknown as rpc.RpcEvent,
			deps,
		);
		vi.advanceTimersByTime(16);
		const streaming = useSessionStore.getState().streamingMessage;
		expect((streaming as { content: Array<{ text?: string }> }).content[0]?.text).toBe("ab");
	});

	it("replaces the draft from a message_snapshot", () => {
		const deps = makeDeps();
		processAgentEvent(start(), deps);
		processAgentEvent(delta("old"), deps);
		processAgentEvent(
			{
				type: "message_snapshot",
				messageId: "m1",
				message: { role: "assistant", content: [{ type: "text", text: "snapshot" }] },
				sessionFile: SESSION,
				activationId: activation,
			} as unknown as rpc.RpcEvent,
			deps,
		);
		vi.advanceTimersByTime(16);
		const streaming = useSessionStore.getState().streamingMessage;
		expect((streaming as { content: Array<{ text?: string }> }).content[0]?.text).toBe("snapshot");
	});
});


describe("background session routing", () => {
	it("routes subscribed background frames away from the active transcript", () => {
		useSessionStore.getState().setSessionFile("/sessions/active.jsonl");
		useSessionTranscriptsStore.setState({
			transcripts: {},
			subscribed: { "/sessions/bg.jsonl": true },
		});
		processAgentEvent(
			{
				type: "message_start",
				message: user("background hello"),
				sessionFile: "/sessions/bg.jsonl",
				activationId: 99,
			} as unknown as rpc.RpcEvent,
			makeDeps(),
		);
		expect(useSessionStore.getState().messages).toHaveLength(0);
		expect(
			useSessionTranscriptsStore.getState().transcripts["/sessions/bg.jsonl"]?.messages,
		).toHaveLength(1);
	});
});

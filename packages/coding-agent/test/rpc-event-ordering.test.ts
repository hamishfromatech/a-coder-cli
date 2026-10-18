import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	getModel,
	type Model,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { RPC_CONTRACT } from "../src/modes/rpc/rpc-types.ts";
import { createTestResourceLoader } from "./utilities.ts";

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		rpcIo.lineHandler = onLine;
		return () => {};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

type Record_ = Record<string, unknown>;

function parseOutputLines(): Record_[] {
	return rpcIo.outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record_);
}

function createRuntimeHost(options: { responseDelayMs: number; model?: Model<any> }): {
	runtimeHost: AgentSessionRuntime;
	tempDir: string;
	cleanup: () => Promise<void>;
} {
	const tempDir = join(tmpdir(), `pi-rpc-order-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });

	const model = options.model ?? getModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Test model not found");

	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: { model, systemPrompt: "Test", tools: [] },
		streamFn: () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: createAssistantMessage("") });
				setTimeout(() => {
					stream.push({
						type: "text_delta",
						contentIndex: 0,
						delta: "done",
						partial: createAssistantMessage("done"),
					});
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
				}, options.responseDelayMs);
			});
			return stream;
		},
	});

	const sessionManager = SessionManager.inMemory();
	const settingsManager = SettingsManager.create(tempDir, tempDir);
	const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = ModelRegistry.create(authStorage, tempDir);

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: tempDir,
		modelRegistry,
		resourceLoader: createTestResourceLoader(),
	});

	const runtimeHost = {
		session,
		newSession: vi.fn(async () => ({ cancelled: true })),
		switchSession: vi.fn(async () => ({ cancelled: true })),
		fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
		dispose: vi.fn(async () => {}),
		setRebindSession: vi.fn(),
		getSessionForPath: vi.fn(() => session),
		getSessionsStatus: vi.fn(() => []),
	} as unknown as AgentSessionRuntime;

	return {
		runtimeHost,
		tempDir,
		cleanup: async () => {
			try {
				if (session.isStreaming) await session.abort();
			} catch {
				// ignore cleanup failures
			}
			session.dispose();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		},
	};
}

async function startRpcMode(options: {
	responseDelayMs: number;
	model?: Model<any>;
	logPath?: string;
}): Promise<{ lineHandler: (line: string) => void; cleanup: () => Promise<void> }> {
	rpcIo.outputLines = [];
	rpcIo.lineHandler = undefined;

	const { runtimeHost, cleanup } = createRuntimeHost(options);
	void runRpcMode(runtimeHost, { logPath: options.logPath });
	await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

	return { lineHandler: rpcIo.lineHandler!, cleanup };
}

function eventTypes(): string[] {
	return parseOutputLines()
		.map((record) => record.type)
		.filter((type): type is string => typeof type === "string");
}

describe("RPC event ordering contract", () => {
	afterEach(() => {
		rpcIo.outputLines = [];
		rpcIo.lineHandler = undefined;
	});

	it("opens with the engine_info handshake naming the protocol contract", async () => {
		const { cleanup } = await startRpcMode({ responseDelayMs: 0 });
		try {
			const first = parseOutputLines()[0]!;
			expect(first).toMatchObject({ type: "engine_info", contract: RPC_CONTRACT });
			expect(typeof first.version).toBe("string");
		} finally {
			await cleanup();
		}
	});

	it("pairs exactly one agent_start with one agent_end around a turn", async () => {
		const { lineHandler, cleanup } = await startRpcMode({ responseDelayMs: 0 });
		try {
			lineHandler(JSON.stringify({ id: "t1", type: "prompt", message: "Hello" }));
			await vi.waitFor(() => expect(eventTypes().filter((t) => t === "agent_end")).toHaveLength(1));

			const types = eventTypes();
			const starts = types.filter((t) => t === "agent_start");
			const ends = types.filter((t) => t === "agent_end");
			expect(starts).toHaveLength(1);
			expect(ends).toHaveLength(1);
			expect(types.indexOf("agent_start")).toBeLessThan(types.indexOf("agent_end"));
		} finally {
			await cleanup();
		}
	});

	it("brackets each message with message_start before message_end, user before assistant", async () => {
		const { lineHandler, cleanup } = await startRpcMode({ responseDelayMs: 0 });
		try {
			lineHandler(JSON.stringify({ id: "t2", type: "prompt", message: "Hello" }));
			await vi.waitFor(() => expect(eventTypes().filter((t) => t === "message_end")).toHaveLength(2));

			const messages = parseOutputLines().filter(
				(record) => record.type === "message_start" || record.type === "message_end",
			);
			const roles = messages.map((record) => (record.message as { role?: string } | undefined)?.role);
			expect(roles).toContain("user");
			expect(roles).toContain("assistant");

			const firstUserStart = messages.findIndex(
				(record) => record.type === "message_start" && (record.message as { role?: string }).role === "user",
			);
			const firstUserEnd = messages.findIndex(
				(record) => record.type === "message_end" && (record.message as { role?: string }).role === "user",
			);
			const lastAssistantStart = messages.findIndex(
				(record) => record.type === "message_start" && (record.message as { role?: string }).role === "assistant",
			);
			const lastAssistantEnd = messages.findIndex(
				(record) => record.type === "message_end" && (record.message as { role?: string }).role === "assistant",
			);

			expect(firstUserStart).toBeGreaterThanOrEqual(0);
			expect(firstUserEnd).toBeGreaterThan(firstUserStart);
			expect(lastAssistantStart).toBeGreaterThan(firstUserEnd);
			expect(lastAssistantEnd).toBeGreaterThan(lastAssistantStart);
		} finally {
			await cleanup();
		}
	});

	it("answers get_state without disturbing the event stream", async () => {
		const { lineHandler, cleanup } = await startRpcMode({ responseDelayMs: 0 });
		try {
			lineHandler(JSON.stringify({ id: "s1", type: "get_state" }));
			await vi.waitFor(() => {
				const response = parseOutputLines().find((record) => record.id === "s1");
				expect(response).toMatchObject({ type: "response", command: "get_state", success: true });
			});
			// No turn ran, so no agent lifecycle events may appear.
			const types = eventTypes();
			expect(types).not.toContain("agent_start");
			expect(types).not.toContain("agent_end");
		} finally {
			await cleanup();
		}
	});

	it("writes a direction-tagged JSONL trace when --rpc-log is set", async () => {
		const tracePath = join(tmpdir(), `pi-rpc-trace-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
		const { lineHandler, cleanup } = await startRpcMode({ responseDelayMs: 0, logPath: tracePath });
		try {
			lineHandler(JSON.stringify({ id: "log1", type: "get_state" }));
			await vi.waitFor(() => {
				const raw = existsSync(tracePath) ? readFileSync(tracePath, "utf8") : "";
				expect(raw).toContain('"id":"log1"');
				expect(raw).toContain('"dir":"out"');
				// The response frame is written after the command is handled;
				// wait for it explicitly instead of racing the stream flush.
				expect(raw).toContain('"command":"get_state"');
			});

			const records = readFileSync(tracePath, "utf8")
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line) as { ts: string; dir: string; payload: Record_ });

			expect(
				records.every((record) => typeof record.ts === "string" && (record.dir === "in" || record.dir === "out")),
			).toBe(true);
			expect(records.some((record) => record.dir === "in" && record.payload.id === "log1")).toBe(true);
			expect(records.some((record) => record.dir === "out" && record.payload.type === "engine_info")).toBe(true);
			expect(records.some((record) => record.dir === "out" && record.payload.command === "get_state")).toBe(true);
		} finally {
			await cleanup();
			if (existsSync(tracePath)) rmSync(tracePath, { force: true });
		}
	});
});

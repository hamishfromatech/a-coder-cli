import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	clearAgentSessionServicesCache,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import type { ExtensionAPI } from "../../../src/index.ts";
import { runRpcMode } from "../../../src/modes/rpc/rpc-mode.ts";

// Regression for https://github.com/earendil-works/pi/issues/10470, the RPC half
// of the session_start ordering bug (upstream pi#12230): RPC mode bound
// extensions before subscribing, so entries an extension appended from a
// session_start handler never reached the client, and each replacement ran the
// handler twice (runtime callback + a second handler-side rebind).

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../../../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));

vi.mock("../../../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../../../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		rpcIo.lineHandler = onLine;
		return () => {
			rpcIo.lineHandler = undefined;
		};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

type NodeListener = Parameters<typeof process.on>[1];
type OutputLine = Record<string, unknown>;

type ListenerSnapshot = {
	stdinEnd: NodeListener[];
	signals: Map<NodeJS.Signals, NodeListener[]>;
};

function takeListenerSnapshot(): ListenerSnapshot {
	const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
	return {
		stdinEnd: process.stdin.listeners("end") as NodeListener[],
		signals: new Map(signals.map((signal) => [signal, process.listeners(signal) as NodeListener[]])),
	};
}

// runRpcMode registers stdin "end" and signal listeners that runtime.dispose() does not remove.
function restoreListeners(snapshot: ListenerSnapshot): void {
	for (const listener of process.stdin.listeners("end") as NodeListener[]) {
		if (!snapshot.stdinEnd.includes(listener)) {
			process.stdin.off("end", listener);
		}
	}
	for (const [signal, previousListeners] of snapshot.signals) {
		for (const listener of process.listeners(signal) as NodeListener[]) {
			if (!previousListeners.includes(listener)) {
				process.off(signal, listener);
			}
		}
	}
}

function parseOutputLines(): OutputLine[] {
	return rpcIo.outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as OutputLine);
}

function sessionStartReasons(): unknown[] {
	return parseOutputLines()
		.filter((line) => line.type === "session_start")
		.map((line) => line.reason);
}

/** Streamed tree entries for the custom entry the extension writes from session_start. */
function customEntryDeltas(): number {
	return parseOutputLines().filter((line) => {
		if (line.type !== "tree_delta") return false;
		const added = line.added as Array<{ type?: string }> | undefined;
		return added?.some((entry) => entry.type === "custom") === true;
	}).length;
}

describe("RPC session replacement emits session_start once (#10470)", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	beforeEach(() => {
		clearAgentSessionServicesCache();
	});

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
		rpcIo.outputLines = [];
		rpcIo.lineHandler = undefined;
	});

	async function createRuntimeHost() {
		const tempDir = join(tmpdir(), `pi-rpc-10470-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider();
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const extensionFactory = (pi: ExtensionAPI) => {
			pi.on("session_start", (event) => {
				pi.appendEntry("start-marker", event.reason);
			});
		};

		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [extensionFactory],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				...runtimeOptions,
				cwd,
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtimeHost = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		cleanups.push(async () => {
			await runtimeHost.dispose();
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return { runtimeHost, tempDir };
	}

	test("delivers session_start entries at startup and runs the handler once per replacement", async () => {
		const listenerSnapshot = takeListenerSnapshot();
		const { runtimeHost, tempDir } = await createRuntimeHost();

		try {
			void runRpcMode(runtimeHost);
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			// Startup: the entry the extension appends from its session_start handler
			// must reach the client even though it is emitted during bindExtensions().
			await vi.waitFor(() => expect(customEntryDeltas()).toBe(1));

			const originalSessionFile = runtimeHost.session.sessionFile;
			expect(originalSessionFile).toBeTruthy();

			rpcIo.lineHandler?.(JSON.stringify({ id: "new", type: "new_session" }));
			await vi.waitFor(() =>
				expect(parseOutputLines()).toContainEqual(expect.objectContaining({ id: "new", type: "response" })),
			);

			// One replacement, one session_start: the runtime callback is the only rebind.
			expect(sessionStartReasons()).toEqual(["new"]);
			expect(customEntryDeltas()).toBe(2);

			rpcIo.lineHandler?.(
				JSON.stringify({
					id: "switch",
					type: "switch_session",
					sessionPath: originalSessionFile,
					cwd: tempDir,
				}),
			);
			await vi.waitFor(() =>
				expect(parseOutputLines()).toContainEqual(expect.objectContaining({ id: "switch", type: "response" })),
			);

			expect(sessionStartReasons()).toEqual(["new", "resume"]);
			expect(customEntryDeltas()).toBe(3);
		} finally {
			restoreListeners(listenerSnapshot);
		}
	});
});

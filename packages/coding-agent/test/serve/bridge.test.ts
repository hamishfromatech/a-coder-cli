import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { bridgeFrame, isBridgeFrame } from "../../src/serve/control-frames.ts";
import { EngineProcess } from "../../src/serve/engine-process.ts";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const TOKEN = "conformance-token";
const SAVED_ENV = process.env.A_CODER_CLI_CODING_AGENT_DIR;
let tempDir = "";

beforeAll0();

function beforeAll0(): void {
	tempDir = fs.mkdtempSync(join(os.tmpdir(), "acoder-serve-bridge-"));
	process.env.A_CODER_CLI_CODING_AGENT_DIR = tempDir;
}

afterAll(() => {
	if (SAVED_ENV !== undefined) {
		process.env.A_CODER_CLI_CODING_AGENT_DIR = SAVED_ENV;
	} else {
		delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

afterEach(async () => {
	await engine?.stop();
	await server?.stop();
	engine = undefined;
	server = undefined;
});

/**
 * Fake engine: an RPC engine stand-in that echoes every command as a
 * correlated response, emits a canned turn on `prompt`, and exits on `crash`.
 */
const FAKE_ENGINE_SOURCE = `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	if (!line.trim()) return;
	let msg;
	try { msg = JSON.parse(line); } catch { return; }
	if (msg.command === "crash") { process.exit(3); }
	if (msg.command === "prompt") {
		process.stdout.write(JSON.stringify({ type: "agent_start", id: "agent-1" }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_start", id: "m1" }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_end", id: "m1" }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "agent_end", success: true }) + "\\n");
	}
	process.stdout.write(JSON.stringify({ id: msg.id, type: "response", command: msg.command, success: true }) + "\\n");
});
setInterval(() => {}, 1000);
`;

const FAKE_ENGINE_PATH = join(tempDir, "fake-engine.mjs");

let engine: EngineProcess | undefined;
let server: BridgeWsServer | undefined;

function makeServerOptions(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
	return {
		port: 0,
		host: "127.0.0.1",
		token: TOKEN,
		maxClients: 4,
		requireAuth: true,
		version: "0.80.104",
		machineId: "cafe0001",
		friendlyName: "conformance bridge",
		onClientMessage: () => {},
		onClientConnected: () => {},
		onClientDisconnected: () => {},
		...overrides,
	};
}

/** Wire server + engine exactly like serve-command.ts does. */
async function startBridge(engineSource: string = FAKE_ENGINE_SOURCE): Promise<{ port: number }> {
	fs.writeFileSync(FAKE_ENGINE_PATH, engineSource);
	const engineLines: string[] = [];
	engine = new EngineProcess({
		cwd: tempDir,
		continueSession: false,
		commandOverride: { command: process.execPath, baseArgs: [FAKE_ENGINE_PATH] },
		restartDelayMs: 50,
		onLine: (line) => {
			engineLines.push(line);
			server!.broadcast(`${line}\n`);
		},
		onExit: () => {},
		log: () => {},
	});
	server = new BridgeWsServer({
		...makeServerOptions(),
		onClientMessage: (data: string, ws: WebSocket) => {
			for (const line of data.split("\n")) {
				const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
				if (trimmed.length === 0) continue;
				if (!engine!.writeLine(trimmed)) {
					server!.sendTo(ws, bridgeFrame({ type: "bridge", event: "engine_unavailable" }));
				}
			}
		},
		onClientConnected: () => {
			void engine!.start();
		},
	});
	await server.start();
	return { port: server.address!.port };
}

function connect(port: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

/** Collect messages until `predicate` matches; returns all lines seen. */
function collectUntil(ws: WebSocket, predicate: (frames: unknown[]) => boolean, timeoutMs = 3000): Promise<unknown[]> {
	const frames: unknown[] = [];
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timeout; got ${JSON.stringify(frames)}`)), timeoutMs);
		ws.on("message", (data) => {
			for (const line of data.toString().split("\n")) {
				if (!line.trim()) continue;
				try {
					frames.push(JSON.parse(line));
				} catch {
					frames.push(line);
				}
			}
			if (predicate(frames)) {
				clearTimeout(timer);
				resolve(frames);
			}
		});
	});
}

describe("EngineProcess lifecycle", () => {
	it("spawns, pumps stdout lines, and stops cleanly", async () => {
		const scriptPath = join(tempDir, "pump-engine.mjs");
		fs.writeFileSync(
			scriptPath,
			`process.stdout.write(JSON.stringify({type:"ready"}) + "\\n");\nsetInterval(() => {}, 1000);\n`,
		);
		const lines: string[] = [];
		const engine = new EngineProcess({
			cwd: tempDir,
			continueSession: false,
			commandOverride: { command: process.execPath, baseArgs: [scriptPath] },
			onLine: (line) => lines.push(line),
			onExit: () => {},
			log: () => {},
		});
		await engine.start();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(lines).toEqual([JSON.stringify({ type: "ready" })]);
		await engine.stop();
		expect(engine.running).toBe(false);
	});

	it("restarts a crashed engine up to 2 times then gives up", async () => {
		const scriptPath = join(tempDir, "crash-engine.mjs");
		fs.writeFileSync(scriptPath, `process.exit(3);\n`);
		const exits: Array<{ code: number | null; willRestart: boolean }> = [];
		const engine = new EngineProcess({
			cwd: tempDir,
			continueSession: false,
			commandOverride: { command: process.execPath, baseArgs: [scriptPath] },
			restartDelayMs: 50,
			onLine: () => {},
			onExit: (info) => exits.push({ code: info.code, willRestart: info.willRestart }),
			log: () => {},
		});
		await engine.start();
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(exits).toEqual([
			{ code: 3, willRestart: true },
			{ code: 3, willRestart: true },
			{ code: 3, willRestart: false },
		]);
		await engine.stop();
	});
});

describe("bridge conformance (server + engine over the wire)", () => {
	it("correlates responses to command ids with two commands in flight", async () => {
		const { port } = await startBridge();
		const ws = await connect(port);
		ws.send(`{"id":"c1","type":"command","command":"ping"}\n`);
		ws.send(`{"id":"c2","type":"command","command":"pong"}\n`);
		const frames = await collectUntil(ws, (frames) => {
			const responses = frames.filter((f) => (f as { type?: string }).type === "response");
			return responses.length >= 2;
		});
		const responses = frames.filter((f) => (f as { type?: string }).type === "response") as Array<{
			id: string;
			command: string;
		}>;
		const byId = new Map(responses.map((r) => [r.id, r]));
		expect(byId.get("c1")?.command).toBe("ping");
		expect(byId.get("c2")?.command).toBe("pong");
		ws.close();
	});

	it("replays a full turn: command frames and turn events over the same socket", async () => {
		const { port } = await startBridge();
		const ws = await connect(port);
		ws.send(`{"id":"t1","type":"command","command":"prompt"}\n`);
		const frames = await collectUntil(ws, (frames) =>
			frames.some((f) => (f as { type?: string }).type === "agent_end"),
		);
		const types = frames.map((f) => (f as { type?: string }).type);
		// Turn events arrive as a contiguous block, then the correlated response.
		const startIdx = types.indexOf("agent_start");
		expect(types.slice(startIdx, startIdx + 5)).toEqual([
			"agent_start",
			"message_start",
			"message_update",
			"message_end",
			"agent_end",
		]);
		const response = frames.find((f) => (f as { id?: string }).id === "t1") as { command: string } | undefined;
		expect(response?.command).toBe("prompt");
		ws.close();
	});

	it("splits multi-line WS frames into separate engine stdin lines", async () => {
		const { port } = await startBridge();
		const ws = await connect(port);
		// One WS message carrying two NDJSON records.
		ws.send(`{"id":"m1","type":"command","command":"ping"}\n{"id":"m2","type":"command","command":"pong"}\n`);
		const frames = await collectUntil(ws, (frames) => {
			const responses = frames.filter((f) => (f as { type?: string }).type === "response");
			return responses.length >= 2;
		});
		const ids = frames
			.filter((f) => (f as { type?: string }).type === "response")
			.map((f) => (f as { id: string }).id);
		expect(ids).toContain("m1");
		expect(ids).toContain("m2");
		ws.close();
	});

	it("refuses client lines with an engine_unavailable frame while the engine is down", async () => {
		fs.writeFileSync(FAKE_ENGINE_PATH, FAKE_ENGINE_SOURCE);
		engine = new EngineProcess({
			cwd: tempDir,
			continueSession: false,
			commandOverride: { command: process.execPath, baseArgs: [FAKE_ENGINE_PATH] },
			onLine: () => {},
			onExit: () => {},
			log: () => {},
		});
		server = new BridgeWsServer({
			...makeServerOptions(),
			// Production wiring (serve-command.ts): a line the engine cannot
			// accept is refused back to the sender as a bridge control frame.
			onClientMessage: (data: string, ws: WebSocket) => {
				for (const line of data.split("\n")) {
					const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
					if (trimmed.length === 0) continue;
					if (!engine!.writeLine(trimmed)) {
						server!.sendTo(ws, bridgeFrame({ type: "bridge", event: "engine_unavailable" }));
					}
				}
			},
			onClientConnected: () => {}, // engine deliberately never started
		});
		await server.start();
		const { port } = { port: server.address!.port };
		const ws = await connect(port);
		ws.send(`{"id":"x","type":"command","command":"ping"}\n`);
		const frames = await collectUntil(ws, (all) =>
			all.some((f) => (f as { event?: string }).event === "engine_unavailable"),
		);
		const refused = frames.find((f) => (f as { event?: string }).event === "engine_unavailable");
		expect(refused).toBeDefined();
		expect(isBridgeFrame(refused)).toBe(true);
		ws.close();
	});

	it("delivers bridge control frames to connected clients", async () => {
		const { port } = await startBridge();
		const ws = await connect(port);
		server!.broadcast(`${JSON.stringify({ type: "bridge", event: "connected", clients: 1 })}\n`);
		const got = await collectUntil(ws, (frames) => frames.length >= 1);
		const connected = got.find((f) => (f as { type?: string }).type === "bridge") as { event?: string } | undefined;
		expect(connected?.event).toBe("connected");
		expect(isBridgeFrame(connected)).toBe(true);

		// Simulate the serve wiring's engine-exit broadcast.
		server!.broadcast(`${JSON.stringify({ type: "bridge", event: "engine_exited", code: 3 })}\n`);
		const afterExit = await collectUntil(ws, (frames) =>
			frames.some((f) => (f as { event?: string }).event === "engine_exited"),
		);
		const exited = afterExit.find((f) => (f as { event?: string }).event === "engine_exited") as
			| { code?: number }
			| undefined;
		expect(exited?.code).toBe(3);

		ws.close();
	});
});

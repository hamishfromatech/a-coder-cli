import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const TOKEN = "backpressure-token";

function makeOptions(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
	return {
		port: 0,
		host: "127.0.0.1",
		token: TOKEN,
		maxClients: 2,
		requireAuth: true,
		version: "0.80.104",
		machineId: "cafe0001",
		friendlyName: "backpressure bridge",
		onClientMessage: () => {},
		onClientConnected: () => {},
		onClientDisconnected: () => {},
		...overrides,
	};
}

type PausableSocket = { pause(): void; resume(): void };

/** Pause the client's TCP socket so the server's send buffer fills. */
function pauseClient(ws: WebSocket): void {
	const socket = (ws as unknown as { _socket?: PausableSocket })._socket;
	socket?.pause();
}

function resumeClient(ws: WebSocket): void {
	const socket = (ws as unknown as { _socket?: PausableSocket })._socket;
	socket?.resume();
}

function connect(port: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

function waitForEvent(target: WebSocket, names: string[], timeoutMs = 10_000): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timeout waiting for ${names.join("/")}`)), timeoutMs);
		for (const name of names) {
			target.once(name, () => {
				clearTimeout(timer);
				resolve(name);
			});
		}
	});
}

let server: BridgeWsServer;
let port: number;
let slowClients: Array<{ ip: string }>;

beforeEach(async () => {
	slowClients = [];
	server = new BridgeWsServer(
		makeOptions({
			onSlowClient: (info) => slowClients.push(info),
		}),
	);
	await server.start();
	port = server.address!.port;
});

afterEach(async () => {
	await server.stop();
});

describe("slow client eviction", () => {
	it("emits slow_client and closes a client that cannot keep up", async () => {
		const frames: Array<Record<string, unknown>> = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		ws.on("message", (data) => {
			for (const line of data.toString().split("\n")) {
				if (!line.trim()) continue;
				frames.push(JSON.parse(line) as Record<string, unknown>);
			}
		});
		await waitForEvent(ws, ["open"]);
		// Let the upgrade callback register the client before pausing it.
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Simulate a phone that stops reading: the server accumulates backpressure.
		pauseClient(ws);
		const payload = `{"type":"message_update","text":"${"x".repeat(1024 * 1024)}"}\n`;
		for (let i = 0; i < 12; i++) server.broadcast(payload);

		// Give the eviction timers a moment, then let the client read again.
		await new Promise((resolve) => setTimeout(resolve, 150));
		resumeClient(ws);

		const closed = waitForEvent(ws, ["close", "error"]);
		await closed;

		expect(slowClients).toHaveLength(1);
		expect(slowClients[0]?.ip).toBeTruthy();
		expect(frames.some((frame) => frame.event === "slow_client")).toBe(true);
		// Close code 1008 is the policy violation used for slow clients.
		expect(ws.readyState).toBe(WebSocket.CLOSED);
	}, 20_000);

	it("stays bounded across repeated floods and drops the client once", async () => {
		const ws = await connect(port);
		await new Promise((resolve) => setTimeout(resolve, 50));
		pauseClient(ws);
		const payload = `{"type":"message_update","text":"${"y".repeat(1024 * 1024)}"}\n`;
		for (let round = 0; round < 3; round++) {
			for (let i = 0; i < 12; i++) server.broadcast(payload);
			await new Promise((resolve) => setTimeout(resolve, 60));
		}
		resumeClient(ws);
		await waitForEvent(ws, ["close", "error"]);

		// One eviction, not one per flood, and the server stays usable.
		expect(slowClients).toHaveLength(1);
		expect(server.clientCount).toBe(0);
		expect(() => server.broadcast(`{"id":"after"}\n`)).not.toThrow();
	}, 20_000);

	it("delivers a multi-megabyte line without frame loss (doc 08 §6)", async () => {
		const received: string[] = [];
		await server.stop();
		server = new BridgeWsServer(
			makeOptions({
				onClientMessage: (data) => received.push(data),
			}),
		);
		await server.start();
		port = server.address!.port;

		const ws = await connect(port);
		const text = "z".repeat(2 * 1024 * 1024);
		ws.send(`${JSON.stringify({ id: "big", type: "command", command: "prompt", message: text })}\n`);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const joined = received.join("");
		const line = joined.split("\n").find((entry) => entry.includes('"big"'));
		expect(line).toBeDefined();
		const parsed = JSON.parse(line!) as { message: string };
		expect(parsed.message).toHaveLength(text.length);

		// Broadcast side: a multi-MB engine line reaches the client intact.
		const outbound: string[] = [];
		const collector = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		collector.on("message", (data) => outbound.push(data.toString()));
		await waitForEvent(collector, ["open"]);
		await new Promise((resolve) => setTimeout(resolve, 50));
		server.broadcast(`${JSON.stringify({ type: "message_update", text })}\n`);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const outboundLine = outbound
			.join("")
			.split("\n")
			.find((entry) => entry.includes('"message_update"'));
		expect(outboundLine).toBeDefined();
		expect((JSON.parse(outboundLine!) as { text: string }).text).toHaveLength(text.length);

		collector.close();
		ws.close();
	}, 20_000);
});

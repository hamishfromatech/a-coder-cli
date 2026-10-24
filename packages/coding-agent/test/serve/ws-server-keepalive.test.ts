import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const TOKEN = "keepalive-token";

function makeOptions(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
	return {
		port: 0,
		host: "127.0.0.1",
		token: TOKEN,
		maxClients: 2,
		requireAuth: true,
		version: "0.80.104",
		machineId: "cafe0001",
		friendlyName: "keepalive bridge",
		onClientMessage: () => {},
		onClientConnected: () => {},
		onClientDisconnected: () => {},
		// Compressed timing so the sweep is observable in a test.
		timing: { pingIntervalMs: 40, pongTimeoutMs: 40 },
		...overrides,
	};
}

type PausableSocket = { pause(): void; resume(): void };

function pauseClient(ws: WebSocket): void {
	(ws as unknown as { _socket?: PausableSocket })._socket?.pause();
}

function resumeClient(ws: WebSocket): void {
	(ws as unknown as { _socket?: PausableSocket })._socket?.resume();
}

function connect(port: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

let server: BridgeWsServer;
let port: number;

beforeEach(async () => {
	server = new BridgeWsServer(makeOptions());
	await server.start();
	port = server.address!.port;
});

afterEach(async () => {
	await server.stop();
});

describe("keepalive sweep", () => {
	it("terminates a client that stops answering pings", async () => {
		const ws = await connect(port);
		// The `ws` client answers pings automatically. Pausing the socket models
		// a phone that was suspended or lost Wi-Fi without a close handshake.
		pauseClient(ws);

		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(server.clientCount).toBe(0);

		resumeClient(ws);
		const closed = new Promise<void>((resolve) => {
			ws.once("close", () => resolve());
			ws.once("error", () => resolve());
		});
		await closed;
		expect(ws.readyState).toBe(WebSocket.CLOSED);
	}, 10_000);

	it("keeps a responsive client across several ping intervals", async () => {
		const ws = await connect(port);
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(server.clientCount).toBe(1);
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	}, 10_000);
});

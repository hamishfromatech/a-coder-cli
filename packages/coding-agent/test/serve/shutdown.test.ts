import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const TOKEN = "shutdown-token";

function makeOptions(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
	return {
		port: 0,
		host: "127.0.0.1",
		token: TOKEN,
		maxClients: 2,
		requireAuth: true,
		version: "0.80.104",
		machineId: "cafe0001",
		friendlyName: "shutdown bridge",
		onClientMessage: () => {},
		onClientConnected: () => {},
		onClientDisconnected: () => {},
		...overrides,
	};
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

describe("shutdown drain", () => {
	it("closes a connected client and the HTTP server within ~2s", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		// Let the upgrade callback register the socket, as in production.
		await new Promise((resolve) => setTimeout(resolve, 50));

		const closed = new Promise<void>((resolve) => {
			ws.once("close", () => resolve());
			ws.once("error", () => resolve());
		});

		const start = Date.now();
		await server.stop();
		await closed;
		const elapsed = Date.now() - start;

		// The bridge must finish the close handshake (or terminate) promptly; the
		// client observes it on its own event loop, so measure until that lands.
		expect(elapsed).toBeLessThan(2000);
		expect(ws.readyState).toBe(WebSocket.CLOSED);
	}, 10_000);

	it("also closes a socket that connects while stop() is starting", async () => {
		// Close the race from the registration path: the client's open event can
		// resolve before the server's handleUpgrade callback runs, so `clients`
		// may still be empty when stop() begins. Raw connection tracking must
		// still tear the socket down.
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		const settled = new Promise<void>((resolve) => {
			ws.once("open", () => resolve());
			ws.once("close", () => resolve());
			ws.once("error", () => resolve());
		});

		const start = Date.now();
		await server.stop();
		await settled;

		expect(Date.now() - start).toBeLessThan(2000);
		expect(ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING).toBe(true);
	}, 10_000);

	it("resolves promptly when no clients are connected", async () => {
		const start = Date.now();
		await server.stop();
		expect(Date.now() - start).toBeLessThan(2000);
	}, 10_000);
});

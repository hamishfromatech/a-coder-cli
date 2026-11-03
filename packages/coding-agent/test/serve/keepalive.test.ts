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
		requireAuth: false,
		version: "0.80.104",
		machineId: "cafe0001",
		friendlyName: "keepalive bridge",
		onClientMessage: () => {},
		onClientConnected: () => {},
		onClientDisconnected: () => {},
		...overrides,
	};
}

let server: BridgeWsServer;

beforeEach(async () => {
	server = new BridgeWsServer(makeOptions());
	await server.start();
});

afterEach(async () => {
	try {
		await server.stop();
	} catch {
		// ignore
	}
});

describe("half-open keepalive", () => {
	it("terminates a client that stops responding to pings", async () => {
		const port = server.address!.port;
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc`, undefined, { autoPong: false } as never);
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		ws.on("ping", () => {
			// Intentionally do not send a pong to simulate a half-open socket.
		});

		const closed = new Promise<void>((resolve) => {
			ws.on("close", () => resolve());
		});
		await closed;
		expect(ws.readyState).toBe(WebSocket.CLOSED);
	}, 15000);
});

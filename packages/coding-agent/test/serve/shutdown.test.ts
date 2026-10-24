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
		requireAuth: false,
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

describe("shutdown drain", () => {
	it("closes connected clients and http server within ~2s", async () => {
		const port = server.address!.port;
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});

		const start = Date.now();
		await server.stop();
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(2000);
		await new Promise<void>((resolve) => {
			if (ws.readyState === WebSocket.CLOSED) return resolve();
			ws.on("close", () => resolve());
			setTimeout(resolve, 500);
		});
		expect(ws.readyState).toBe(WebSocket.CLOSED);
	});
});

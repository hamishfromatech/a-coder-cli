import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const TOKEN = "large-payload-token";

function makeOptions(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
	return {
		port: 0,
		host: "127.0.0.1",
		token: TOKEN,
		maxClients: 2,
		requireAuth: false,
		version: "0.80.104",
		machineId: "cafe0001",
		friendlyName: "large bridge",
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

describe("large payload handling", () => {
	it("delivers a multi-MB line without loss", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		const payload = "x".repeat(2 * 1024 * 1024);
		const line = payload + "\n";
		const received = new Promise<string>((resolve, reject) => {
			ws.on("message", (data) => resolve(data.toString()));
			setTimeout(() => reject(new Error("timeout")), 10000);
		});
		server.broadcast(line);
		const out = await received;
		expect(out.length).toBe(line.length);
		ws.close();
	});
});

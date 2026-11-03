import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const TOKEN = "slow-client-token";

function makeOptions(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
	return {
		port: 0,
		host: "127.0.0.1",
		token: TOKEN,
		maxClients: 4,
		requireAuth: false,
		version: "0.80.104",
		machineId: "cafe0001",
		friendlyName: "slow bridge",
		onClientMessage: () => {},
		onClientConnected: () => {},
		onClientDisconnected: () => {},
		...overrides,
	};
}

let server: BridgeWsServer;
let port: number;
let serverWs: WebSocket | undefined;

beforeEach(async () => {
	serverWs = undefined;
	server = new BridgeWsServer(
		makeOptions({
			onClientConnected: (ws) => {
				serverWs = ws;
			},
		}),
	);
	await server.start();
	port = server.address!.port;
});

afterEach(async () => {
	await server.stop();
});

describe("slow client eviction", () => {
	it("emits slow_client and closes the client without dropping the bridge", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		if (serverWs) Object.defineProperty(serverWs, "bufferedAmount", { value: 9 * 1024 * 1024 });

		const frames: unknown[] = [];
		ws.on("message", (data) => {
			for (const line of data.toString().split("\n")) {
				if (!line.trim()) continue;
				try {
					frames.push(JSON.parse(line));
				} catch {
					frames.push(line);
				}
			}
		});

		const closed = new Promise<void>((resolve) => {
			ws.on("close", () => resolve());
			setTimeout(resolve, 5000);
		});

		for (let i = 0; i < 3; i++) server.broadcast(`${JSON.stringify({ n: i })}\n`);

		await closed;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(frames.some((f) => (f as { event?: string }).event === "slow_client")).toBe(true);
		expect(server.clientCount).toBe(0);
	}, 15000);

	it("bounds the per-client outbound queue", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		if (serverWs) Object.defineProperty(serverWs, "bufferedAmount", { value: 9 * 1024 * 1024 });

		const closed = new Promise<void>((resolve) => {
			ws.on("close", () => resolve());
			setTimeout(resolve, 5000);
		});

		for (let i = 0; i < 3; i++) server.broadcast(`${JSON.stringify({ n: i })}\n`);

		await closed;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(server.clientCount).toBe(0);
	}, 15000);
});

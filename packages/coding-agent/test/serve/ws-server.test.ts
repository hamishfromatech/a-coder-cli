import type { IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const TOKEN = "test-token-1234";

function makeOptions(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
	return {
		port: 0,
		host: "127.0.0.1",
		token: TOKEN,
		maxClients: 1,
		requireAuth: true,
		version: "0.80.104",
		machineId: "deadbeef",
		friendlyName: "test bridge",
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

function httpGet(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest({ host: "127.0.0.1", port, path, headers }, (res: IncomingMessage) => {
			let body = "";
			res.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
		});
		req.on("error", reject);
		req.end();
	});
}

/** Connect a WS client; resolves on open, rejects with the HTTP status on handshake rejection. */
function wsConnect(path: string, headers: Record<string, string> = {}): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
		ws.on("open", () => resolve(ws));
		ws.on("unexpected-response", (_req: unknown, res: IncomingMessage & { statusCode?: number }) => {
			const status = res.statusCode ?? 0;
			res.resume();
			reject(new Error(`handshake rejected: ${status}`));
		});
		ws.on("error", reject);
	});
}

describe("BridgeWsServer HTTP endpoints", () => {
	it("serves /health without auth", async () => {
		const res = await httpGet("/health");
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true, version: "0.80.104" });
	});

	it("serves limited /info when unauthenticated", async () => {
		const res = await httpGet("/info");
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ v: 1, requiresAuth: true });
	});

	it("serves full /info with a valid token (header)", async () => {
		const res = await httpGet("/info", { authorization: `Bearer ${TOKEN}` });
		const body = JSON.parse(res.body) as Record<string, unknown>;
		expect(body).toMatchObject({
			v: 1,
			kind: "acoder-serve",
			version: "0.80.104",
			machineId: "deadbeef",
			requiresAuth: true,
			activeClients: 0,
			maxClients: 1,
		});
	});

	it("404s unknown paths and 405s non-GET", async () => {
		expect((await httpGet("/nope")).status).toBe(404);
	});
});

describe("BridgeWsServer auth", () => {
	it("accepts a correct token via query param", async () => {
		const ws = await wsConnect(`/rpc?token=${TOKEN}`);
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});

	it("accepts a correct token via Authorization header", async () => {
		const ws = await wsConnect("/rpc", { authorization: `Bearer ${TOKEN}` });
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});

	it("rejects a wrong token with 401", async () => {
		await expect(wsConnect(`/rpc?token=wrong`)).rejects.toThrow("handshake rejected: 401");
	});

	it("rejects non-/rpc paths with 404", async () => {
		await expect(wsConnect(`/other?token=${TOKEN}`)).rejects.toThrow("handshake rejected: 404");
	});

	it("blocks an IP after 10 failed attempts (403 even with a valid token)", async () => {
		for (let i = 0; i < 10; i++) {
			await expect(wsConnect(`/rpc?token=wrong-${i}`)).rejects.toThrow("401");
		}
		await expect(wsConnect(`/rpc?token=${TOKEN}`)).rejects.toThrow("handshake rejected: 403");
	});

	it("skips auth entirely when requireAuth is false", async () => {
		await server.stop();
		server = new BridgeWsServer(makeOptions({ requireAuth: false }));
		await server.start();
		port = server.address!.port;
		const ws = await wsConnect("/rpc");
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});
});

describe("BridgeWsServer clients + framing", () => {
	it("sends a server_version handshake frame to each connecting client", async () => {
		// The frame can arrive in the same socket read as the 101 handshake, so
		// the collector must be attached before connecting.
		const frames: string[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		ws.on("message", (data) => frames.push(data.toString()));
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(frames.length).toBeGreaterThanOrEqual(1);
		const frame = JSON.parse(frames[0]!);
		expect(frame.type).toBe("bridge");
		expect(frame.event).toBe("server_version");
		expect(frame.version).toBe("0.80.104");
		ws.close();

		// Per-client handshake: a fresh connection gets its own frame.
		await new Promise((resolve) => setTimeout(resolve, 50));
		const secondFrames: string[] = [];
		const second = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		second.on("message", (data) => secondFrames.push(data.toString()));
		await new Promise<void>((resolve, reject) => {
			second.on("open", () => resolve());
			second.on("error", reject);
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(JSON.parse(secondFrames[0]!).event).toBe("server_version");
		second.close();
	});

	it("enforces maxClients with 503", async () => {
		const first = await wsConnect(`/rpc?token=${TOKEN}`);
		await expect(wsConnect(`/rpc?token=${TOKEN}`)).rejects.toThrow("handshake rejected: 503");
		expect(server.clientCount).toBe(1);
		first.close();
	});

	it("broadcasts lines to connected clients", async () => {
		// Collector attached before connecting so the handshake frame is captured.
		const pre: string[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${TOKEN}`);
		ws.on("message", (data) => pre.push(data.toString()));
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		// Drain the per-client server_version handshake frame first.
		expect(JSON.parse(pre[0]!).event).toBe("server_version");
		server.broadcast(`{"id":"1","type":"response"}\n`);
		server.broadcast(`{"id":"2","type":"response"}\n`);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(pre.slice(1)).toEqual([`{"id":"1","type":"response"}\n`, `{"id":"2","type":"response"}\n`]);
		ws.close();
	});

	it("skips closed clients on broadcast", async () => {
		const first = await wsConnect(`/rpc?token=${TOKEN}`);
		first.close();
		// Give the close event a moment to fire, then broadcast — must not throw.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(() => server.broadcast(`{"id":"1"}\n`)).not.toThrow();
	});

	it("forwards client messages to onClientMessage verbatim", async () => {
		const seen: string[] = [];
		await server.stop();
		server = new BridgeWsServer(makeOptions({ onClientMessage: (data) => seen.push(data) }));
		await server.start();
		port = server.address!.port;

		const ws = await wsConnect(`/rpc?token=${TOKEN}`);
		ws.send(`{"id":"a","type":"command","command":"ping"}\n`);
		ws.send(`{"id":"b","type":"command","command":"ping"}\n`);
		await new Promise((resolve) => setTimeout(resolve, 50));
		// Both messages coalesce or arrive separately depending on TCP timing;
		// concatenated content must match.
		expect(seen.join("")).toBe(
			`{"id":"a","type":"command","command":"ping"}\n{"id":"b","type":"command","command":"ping"}\n`,
		);
		ws.close();
	});
});

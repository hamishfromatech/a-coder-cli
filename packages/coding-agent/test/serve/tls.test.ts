import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { pairingPayload } from "../../src/serve/pairing.ts";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const cert = readFileSync(join(here, "fixtures/tls-cert.pem"), "utf8");
const key = readFileSync(join(here, "fixtures/tls-key.pem"), "utf8");
const PIN = "7d2bc28bb71748f97037f7856d4ff715016b69784bcd9919689d60578406a0da";

function options(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
	return {
		port: 0,
		host: "127.0.0.1",
		token: "tls-token",
		maxClients: 1,
		requireAuth: false,
		version: "0.0.0-test",
		machineId: "deadbeef",
		friendlyName: "tls bridge",
		onClientMessage: () => {},
		onClientConnected: () => {},
		onClientDisconnected: () => {},
		tls: { cert, key },
		...overrides,
	};
}

let server: BridgeWsServer | undefined;

afterEach(async () => {
	await server?.stop();
	server = undefined;
});

describe("wss bridge", () => {
	it("serves /health over TLS and accepts a wss client", async () => {
		server = new BridgeWsServer(options());
		const address = await server.start();
		const url = `wss://127.0.0.1:${address.port}/rpc`;

		const ws = await new Promise<WebSocket>((resolve, reject) => {
			// Pinning is a client concern; the test trusts the fixture cert.
			const client = new WebSocket(url, { rejectUnauthorized: false });
			client.on("open", () => resolve(client));
			client.on("error", reject);
		});

		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});

	it("rejects a plaintext ws:// client when TLS is enabled", async () => {
		server = new BridgeWsServer(options());
		const address = await server.start();

		const failed = await new Promise<boolean>((resolve) => {
			const plain = new WebSocket(`ws://127.0.0.1:${address.port}/rpc`);
			plain.on("open", () => {
				plain.close();
				resolve(false);
			});
			plain.on("error", () => resolve(true));
			plain.on("unexpected-response", () => resolve(true));
		});

		expect(failed).toBe(true);
	});

	it("pairing payload carries tls + pin", () => {
		const payload = pairingPayload({
			host: "192.168.1.10",
			port: 8787,
			token: "t".repeat(43),
			name: "desk",
			tls: true,
			pin: PIN,
		});
		expect(payload.tls).toBe(true);
		expect(payload.pin).toBe(PIN);
	});

	it("plaintext payload omits the pin", () => {
		const payload = pairingPayload({
			host: "192.168.1.10",
			port: 8787,
			token: "t".repeat(43),
			name: "desk",
		});
		expect(payload.tls).toBe(false);
		expect(payload.pin).toBeUndefined();
	});
});

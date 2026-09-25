/**
 * WebSocket server for the serve bridge: HTTP endpoints (health/info), token
 * auth on upgrade, handshake rate limiting, and an authenticated client set.
 *
 * Security model (mobile-app/plan/02 §6): every connection requires the
 * pairing token; failures are rate limited per IP; the token is compared in
 * constant time.
 */

import type { IncomingMessage, Server } from "node:http";
import http from "node:http";
import type { Socket } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";
import { bearerFromHeader, tokenFromUrl, tokenMatches } from "./pairing.ts";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 10;

/** Slow-client cap: close a client whose socket buffers more than this many bytes (doc 04 §4). */
const MAX_CLIENT_BUFFER_BYTES = 8 * 1024 * 1024;

interface RateState {
	failures: number;
	windowStart: number;
	blockedUntil?: number;
}

export interface WsServerOptions {
	port: number;
	host: string;
	token: string;
	maxClients: number;
	/** Only false for loopback-bound dev servers (--no-auth). */
	requireAuth: boolean;
	version: string;
	machineId: string;
	friendlyName: string;
	onClientMessage: (data: string) => void;
	onClientConnected: () => void;
	onClientDisconnected: () => void;
}

export interface ServeAddress {
	port: number;
	family: string;
	address: string;
}

export class BridgeWsServer {
	private readonly options: WsServerOptions;
	private readonly httpServer: Server;
	private readonly wss: WebSocketServer;
	private readonly clients = new Map<WebSocket, boolean>();
	private readonly rateByIp = new Map<string, RateState>();
	private started = false;

	constructor(options: WsServerOptions) {
		this.options = options;
		this.httpServer = http.createServer((req, res) => {
			this.handleHttp(req, res);
		});
		this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
		this.httpServer.on("upgrade", (req, socket, head) => {
			this.handleUpgrade(req, socket as Socket, head);
		});
	}

	get clientCount(): number {
		return this.clients.size;
	}

	/** Actual listen address once started (null before start()). */
	get address(): ServeAddress | null {
		const addr = this.httpServer.address();
		if (!addr || typeof addr === "string") return null;
		return { port: addr.port, family: addr.family, address: addr.address };
	}

	start(): Promise<ServeAddress> {
		return new Promise((resolve, reject) => {
			if (this.started) {
				resolve(this.address!);
				return;
			}
			this.httpServer.once("error", reject);
			this.httpServer.listen(this.options.port, this.options.host, () => {
				this.started = true;
				resolve(this.address!);
			});
		});
	}

	/** Update the port before start() (used by the auto-probe). No-op after start. */
	setPort(port: number): void {
		if (this.started) return;
		this.options.port = port;
	}

	async stop(): Promise<void> {
		for (const ws of this.clients.keys()) {
			ws.close(1001, "shutting down");
		}
		this.clients.clear();
		await new Promise<void>((resolve) => {
			this.httpServer.close(() => resolve());
		});
	}

	/** Broadcast one NDJSON line to every connected (authenticated) client. */
	broadcast(line: string): void {
		for (const [ws] of this.clients) {
			if (ws.readyState !== ws.OPEN) continue;
			// Slow-client guard: drop rather than buffer unboundedly (doc 04 §4).
			if (ws.bufferedAmount > MAX_CLIENT_BUFFER_BYTES) {
				ws.close(1008, "slow client");
				continue;
			}
			ws.send(line);
		}
	}

	// ---- HTTP endpoints ----------------------------------------------------

	private handleHttp(req: IncomingMessage, res: http.ServerResponse): void {
		if (req.method !== "GET") {
			this.reply(res, 405, "method not allowed");
			return;
		}
		const path = (req.url ?? "/").split("?")[0] ?? "/";
		if (path === "/health") {
			this.replyJson(res, 200, { ok: true, version: this.options.version });
			return;
		}
		if (path === "/info") {
			const authorized = this.requestAuthorized(req);
			if (!authorized) {
				this.replyJson(res, 200, { v: 1, requiresAuth: true });
				return;
			}
			this.replyJson(res, 200, {
				v: 1,
				kind: "acoder-serve",
				name: this.options.friendlyName,
				version: this.options.version,
				engine: "a-coder-cli",
				machineId: this.options.machineId,
				requiresAuth: this.options.requireAuth,
				activeClients: this.clientCount,
				maxClients: this.options.maxClients,
			});
			return;
		}
		this.reply(res, 404, "not found");
	}

	private requestAuthorized(req: IncomingMessage): boolean {
		if (!this.options.requireAuth) return true;
		const presented = bearerFromHeader(req.headers.authorization) ?? tokenFromUrl(req.url);
		return presented !== null && tokenMatches(presented, this.options.token);
	}

	private reply(res: http.ServerResponse, status: number, message: string): void {
		res.writeHead(status, { "content-type": "text/plain" });
		res.end(`${message}\n`);
	}

	private replyJson(res: http.ServerResponse, status: number, body: unknown): void {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(`${JSON.stringify(body)}\n`);
	}

	// ---- upgrades ----------------------------------------------------------

	private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
		const url = req.url ?? "/";
		if (!url.startsWith("/rpc")) {
			this.reject(socket, 404, "not found");
			return;
		}
		const ip = req.socket.remoteAddress ?? "unknown";
		if (this.isBlocked(ip)) {
			this.reject(socket, 403, "too many failed attempts; try again later");
			return;
		}
		if (this.options.requireAuth) {
			const presented = bearerFromHeader(req.headers.authorization) ?? tokenFromUrl(url);
			if (!presented || !tokenMatches(presented, this.options.token)) {
				this.recordFailure(ip);
				this.reject(socket, 401, "unauthorized");
				return;
			}
		}
		if (this.clients.size >= this.options.maxClients) {
			this.reject(socket, 503, "too many clients");
			return;
		}

		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.clients.set(ws, true);
			ws.on("close", () => {
				this.clients.delete(ws);
				this.options.onClientDisconnected();
			});
			ws.on("error", () => {
				// Transport errors end in a close event; nothing further to do.
			});
			ws.on("message", (data) => {
				this.options.onClientMessage(data.toString());
			});
			this.options.onClientConnected();
		});
	}

	/** Reject an upgrade with a plain HTTP response before the WS handshake. */
	private reject(socket: Socket, status: number, message: string): void {
		socket.write(
			`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? "Error"}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}\n`,
		);
		socket.destroy();
	}

	// ---- handshake rate limiting --------------------------------------------

	private isBlocked(ip: string): boolean {
		const state = this.rateByIp.get(ip);
		if (!state) return false;
		if (state.blockedUntil !== undefined) {
			if (Date.now() < state.blockedUntil) return true;
			this.rateByIp.delete(ip);
		}
		return false;
	}

	private recordFailure(ip: string): void {
		const now = Date.now();
		const state = this.rateByIp.get(ip) ?? { failures: 0, windowStart: now };
		if (now - state.windowStart > RATE_WINDOW_MS) {
			state.failures = 0;
			state.windowStart = now;
		}
		state.failures += 1;
		if (state.failures >= RATE_MAX_FAILURES) {
			state.blockedUntil = state.windowStart + RATE_WINDOW_MS;
		}
		this.rateByIp.set(ip, state);
	}
}

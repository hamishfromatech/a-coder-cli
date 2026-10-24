/**
 * WebSocket server for the serve bridge: HTTP endpoints (health/info), token
 * auth on upgrade, handshake rate limiting, and an authenticated client set.
 *
 * Security model (mobile-app/plan/02 §6): every connection requires the
 * pairing token; failures are rate limited per IP; the token is compared in
 * constant time.
 *
 * Delivery model (mobile-app/plan/04 §4): each client has a bounded outbound
 * queue. A client that cannot keep up is sent one `slow_client` control frame
 * and then closed (1008) instead of silently growing the bridge's memory.
 * Ping/pong sweeps evict sockets that vanished without a close handshake
 * (`waitForDrain` in stop() then only waits on sockets that still answer).
 */

import type { IncomingMessage, Server } from "node:http";
import http from "node:http";
import type { Socket } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";
import { BRIDGE_CONTRACT, bridgeFrame } from "./control-frames.ts";
import { bearerFromHeader, tokenFromUrl, tokenMatches } from "./pairing.ts";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 10;
const RATE_SWEEP_MS = 60_000;
const MAX_RATE_ENTRIES = 10_000;

/** Slow-client cap: never buffer more than this for one client (doc 04 §4). */
const MAX_CLIENT_BUFFER_BYTES = 8 * 1024 * 1024;
/** Outbound lines waiting for the socket, independent of socket buffering. */
const MAX_CLIENT_QUEUE_BYTES = 8 * 1024 * 1024;
const MAX_CLIENT_QUEUE_MESSAGES = 512;
/** Start deferring to socket drain above this, keeping per-event latency low. */
const HIGH_WATER_BYTES = 1 * 1024 * 1024;

const DEFAULT_PING_INTERVAL_MS = 5_000;
const DEFAULT_PONG_TIMEOUT_MS = 2_000;
const DEFAULT_CLOSE_DRAIN_MS = 1_000;
/** Grace after announcing `slow_client` before closing, then terminating. */
const SLOW_CLIENT_CLOSE_GRACE_MS = 100;
const SLOW_CLIENT_TERMINATE_MS = 2_000;

interface RateState {
	failures: number;
	windowStart: number;
	blockedUntil?: number;
}

interface ClientState {
	ip: string;
	queue: string[];
	queueBytes: number;
	slow: boolean;
	lastPong: number;
}

/** Test hooks: shorten the timing constants without changing production behavior. */
export interface WsServerTiming {
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	closeDrainMs?: number;
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
	onClientMessage: (data: string, ws: WebSocket) => void;
	onClientConnected: (ws: WebSocket) => void;
	onClientDisconnected: () => void;
	/** Optional log hook for evictions (the bridge prefixes it on stderr). */
	onSlowClient?: (info: { ip: string }) => void;
	timing?: WsServerTiming;
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
	private readonly clients = new Map<WebSocket, ClientState>();
	private readonly rateByIp = new Map<string, RateState>();
	/**
	 * Every TCP connection, including upgrades that have not reached the
	 * handleUpgrade callback yet. `stop()` destroys these so a client that
	 * connected mid-shutdown is closed too, and `httpServer.close()` is not
	 * held open by keep-alive connections.
	 */
	private readonly sockets = new Set<Socket>();
	private started = false;
	/** Upgrades in flight, counted against maxClients before registration. */
	private pendingUpgrades = 0;
	private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
	private rateSweepTimer: ReturnType<typeof setInterval> | undefined;

	constructor(options: WsServerOptions) {
		this.options = options;
		this.httpServer = http.createServer((req, res) => {
			this.handleHttp(req, res);
		});
		this.httpServer.on("connection", (socket) => {
			this.sockets.add(socket);
			socket.on("close", () => this.sockets.delete(socket));
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
			const onError = (error: unknown) => {
				reject(error instanceof Error ? error : new Error(String(error)));
			};
			this.httpServer.once("error", onError);
			this.httpServer.listen(this.options.port, this.options.host, () => {
				this.httpServer.off("error", onError);
				this.started = true;
				this.keepaliveTimer = setInterval(() => this.keepaliveSweep(), this.pingIntervalMs);
				this.keepaliveTimer.unref?.();
				this.rateSweepTimer = setInterval(() => this.sweepRateLimits(), RATE_SWEEP_MS);
				this.rateSweepTimer.unref?.();
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
		if (this.keepaliveTimer) {
			clearInterval(this.keepaliveTimer);
			this.keepaliveTimer = undefined;
		}
		if (this.rateSweepTimer) {
			clearInterval(this.rateSweepTimer);
			this.rateSweepTimer = undefined;
		}

		// Flush queued frames (for example `shutting_down`) before the close
		// handshake starts; close() alone would drop whatever is still queued.
		for (const [ws, client] of this.clients) {
			if (client.slow || ws.readyState !== ws.OPEN) continue;
			this.pump(ws, client);
		}

		for (const ws of this.clients.keys()) {
			try {
				ws.close(1001, "shutting down");
			} catch {
				// best effort
			}
		}

		// Wait briefly for graceful closes, then terminate stragglers.
		await this.waitForDrain(this.closeDrainMs);
		for (const ws of [...this.clients.keys()]) {
			try {
				ws.terminate();
			} catch {
				// best effort
			}
		}
		this.clients.clear();

		// Upgraded sockets are owned by the WebSocket layer; closing the HTTP
		// server does not destroy them. Unregistered mid-handshake sockets are
		// not in `clients` either. Destroying the raw connections covers both
		// and lets close() resolve immediately on keep-alive sockets.
		for (const socket of this.sockets) {
			try {
				socket.destroy();
			} catch {
				// best effort
			}
		}
		this.sockets.clear();

		await new Promise<void>((resolve) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (!settled) {
					settled = true;
					resolve();
				}
			}, this.closeDrainMs);
			timer.unref?.();
			this.httpServer.close(() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve();
			});
		});
		this.started = false;
	}

	/** Broadcast one NDJSON line to every connected (authenticated) client. */
	broadcast(line: string): void {
		const payload = line.endsWith("\n") ? line : `${line}\n`;
		for (const ws of [...this.clients.keys()]) {
			this.enqueue(ws, payload);
		}
	}

	/** Send one NDJSON line to a single authenticated client (handshake frames). */
	sendTo(ws: WebSocket, line: string): void {
		this.enqueue(ws, line.endsWith("\n") ? line : `${line}\n`);
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
				contract: BRIDGE_CONTRACT,
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
		// Reserve before the asynchronous handshake callback so two simultaneous
		// upgrades cannot both pass the maxClients check.
		if (this.clients.size + this.pendingUpgrades >= this.options.maxClients) {
			this.reject(socket, 503, "too many clients");
			return;
		}

		this.pendingUpgrades += 1;
		try {
			this.wss.handleUpgrade(req, socket, head, (ws) => {
				this.pendingUpgrades = Math.max(0, this.pendingUpgrades - 1);
				this.registerClient(ws, ip);
				this.options.onClientConnected(ws);
				// Per-client handshake frame: the client treats this as auth-complete
				// and starts its initial sync. `contract` lets the client verify it
				// speaks a compatible bridge protocol before driving the engine.
				this.sendTo(
					ws,
					bridgeFrame({
						type: "bridge",
						event: "server_version",
						version: this.options.version,
						contract: BRIDGE_CONTRACT,
					}),
				);
			});
		} catch (error) {
			this.pendingUpgrades = Math.max(0, this.pendingUpgrades - 1);
			this.reject(socket, 400, error instanceof Error ? error.message : "bad upgrade");
		}
	}

	private registerClient(ws: WebSocket, ip: string): void {
		const state: ClientState = {
			ip,
			queue: [],
			queueBytes: 0,
			slow: false,
			lastPong: Date.now(),
		};
		this.clients.set(ws, state);

		ws.on("message", (data) => {
			this.options.onClientMessage(data.toString(), ws);
		});
		ws.on("pong", () => {
			const client = this.clients.get(ws);
			if (client) client.lastPong = Date.now();
		});
		ws.on("close", () => {
			this.clients.delete(ws);
			this.options.onClientDisconnected();
		});
		ws.on("error", () => {
			// Transport errors end in a close event; nothing further to do.
		});
	}

	/** Reject an upgrade with a plain HTTP response before the WS handshake. */
	private reject(socket: Socket, status: number, message: string): void {
		socket.write(
			`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? "Error"}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}\n`,
		);
		socket.destroy();
	}

	// ---- per-client queue --------------------------------------------------

	/** Queue one line for a client, enforcing the per-client backpressure caps. */
	private enqueue(ws: WebSocket, line: string): void {
		const client = this.clients.get(ws);
		if (!client || ws.readyState !== ws.OPEN || client.slow) return;
		if (ws.bufferedAmount >= MAX_CLIENT_BUFFER_BYTES) {
			this.markSlow(ws, client);
			return;
		}
		const bytes = Buffer.byteLength(line, "utf8");
		if (
			bytes > MAX_CLIENT_QUEUE_BYTES ||
			client.queueBytes + bytes > MAX_CLIENT_QUEUE_BYTES ||
			client.queue.length >= MAX_CLIENT_QUEUE_MESSAGES
		) {
			this.markSlow(ws, client);
			return;
		}
		client.queue.push(line);
		client.queueBytes += bytes;
		this.pump(ws, client);
	}

	/**
	 * Send queued lines until the socket reaches the high-water mark. Each send
	 * resumes pumping from its callback, so a client that drains later still
	 * receives the rest without needing another broadcast.
	 */
	private pump(ws: WebSocket, client: ClientState): void {
		if (client.slow || ws.readyState !== ws.OPEN) return;
		while (client.queue.length > 0) {
			const next = client.queue[0];
			if (next === undefined) break;
			const bytes = Buffer.byteLength(next, "utf8");
			if (ws.bufferedAmount > HIGH_WATER_BYTES || ws.bufferedAmount + bytes > MAX_CLIENT_BUFFER_BYTES) break;
			client.queue.shift();
			client.queueBytes -= bytes;
			ws.send(next, (error) => {
				if (error) {
					try {
						ws.terminate();
					} catch {
						// best effort
					}
					return;
				}
				this.pump(ws, client);
			});
			if (ws.bufferedAmount > HIGH_WATER_BYTES) break;
		}

		if (
			!client.slow &&
			(ws.bufferedAmount >= MAX_CLIENT_BUFFER_BYTES ||
				(client.queue.length > 0 && ws.bufferedAmount >= HIGH_WATER_BYTES))
		) {
			this.markSlow(ws, client);
		}
	}

	/** Tell a client it fell behind, then evict it (doc 04 §4). */
	private markSlow(ws: WebSocket, client: ClientState): void {
		if (client.slow) return;
		client.slow = true;
		client.queue = [];
		client.queueBytes = 0;
		const ip = client.ip;
		this.options.onSlowClient?.({ ip });
		try {
			ws.send(bridgeFrame({ type: "bridge", event: "slow_client", ip }));
		} catch {
			// best effort: the close below still evicts it
		}
		const closeTimer = setTimeout(() => {
			try {
				ws.close(1008, "slow client");
			} catch {
				// best effort
			}
		}, SLOW_CLIENT_CLOSE_GRACE_MS);
		closeTimer.unref?.();
		const killTimer = setTimeout(() => {
			try {
				ws.terminate();
			} catch {
				// best effort
			}
		}, SLOW_CLIENT_TERMINATE_MS);
		killTimer.unref?.();
	}

	// ---- keepalive ---------------------------------------------------------

	/**
	 * A client that stops answering pings (phone suspended, Wi-Fi dropped
	 * without a FIN) is terminated so its slot and queue are released.
	 */
	private keepaliveSweep(): void {
		const now = Date.now();
		for (const [ws, client] of this.clients) {
			if (client.slow || ws.readyState !== ws.OPEN) continue;
			if (now - client.lastPong > this.pingIntervalMs + this.pongTimeoutMs) {
				try {
					ws.terminate();
				} catch {
					// best effort
				}
				continue;
			}
			try {
				ws.ping();
			} catch {
				// best effort: the close handler removes it
			}
		}
	}

	private get pingIntervalMs(): number {
		return this.options.timing?.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
	}

	private get pongTimeoutMs(): number {
		return this.options.timing?.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
	}

	private get closeDrainMs(): number {
		return this.options.timing?.closeDrainMs ?? DEFAULT_CLOSE_DRAIN_MS;
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
		this.enforceRateMapLimit();
	}

	private sweepRateLimits(): void {
		const now = Date.now();
		for (const [ip, state] of this.rateByIp) {
			if (state.blockedUntil !== undefined) {
				if (now >= state.blockedUntil) this.rateByIp.delete(ip);
			} else if (now - state.windowStart > RATE_WINDOW_MS) {
				this.rateByIp.delete(ip);
			}
		}
	}

	private enforceRateMapLimit(): void {
		if (this.rateByIp.size <= MAX_RATE_ENTRIES) return;
		const excess = this.rateByIp.size - MAX_RATE_ENTRIES;
		let removed = 0;
		for (const key of this.rateByIp.keys()) {
			this.rateByIp.delete(key);
			removed += 1;
			if (removed >= excess) break;
		}
	}

	private waitForDrain(timeoutMs: number): Promise<void> {
		return new Promise((resolve) => {
			const start = Date.now();
			const check = () => {
				// After close() the readyState is CLOSING; a graceful client moves it
				// to CLOSED when the close handshake completes. Anything still not
				// CLOSED at the deadline is terminated by the caller.
				const anyActive = [...this.clients.keys()].some((ws) => ws.readyState !== ws.CLOSED);
				if (!anyActive || Date.now() - start >= timeoutMs) {
					resolve();
					return;
				}
				setTimeout(check, 25);
			};
			check();
		});
	}
}

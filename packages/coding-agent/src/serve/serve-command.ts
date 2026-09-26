/**
 * `a-coder-cli serve` — the mobile bridge (mobile-app/plan/04).
 *
 * Spawns an engine (`--mode rpc`) on first authenticated client, exposes the
 * same NDJSON protocol over an authenticated WebSocket, announces itself via
 * mDNS, and prints the pairing QR to the terminal.
 */

import { createRequire } from "node:module";
import { hostname, networkInterfaces } from "node:os";
import process from "node:process";
import QRCode from "qrcode";
import { getPackageJsonPath, VERSION } from "../config.ts";
import { BridgeAnnounce } from "./announce.ts";
import { bridgeFrame } from "./control-frames.ts";
import { EngineProcess } from "./engine-process.ts";
import { machineId, manualChunks, pairingPayload, resolveToken } from "./pairing.ts";
import { BridgeWsServer } from "./ws-server.ts";

const DEFAULT_PORT = 8787;
const DEFAULT_IDLE_EXIT_MINUTES = 30;
const PORT_PROBE_ATTEMPTS = 10;

export interface ServeFlags {
	help: boolean;
	cwd?: string;
	port?: number;
	bind: string;
	provider?: string;
	model?: string;
	continueSession: boolean;
	token?: string;
	maxClients: number;
	idleExitMinutes: number;
	noAuth: boolean;
	announce: boolean;
	rotate: boolean;
}

function parseServeFlags(args: string[]): ServeFlags {
	const flags: ServeFlags = {
		help: false,
		bind: "0.0.0.0",
		continueSession: false,
		maxClients: 1,
		idleExitMinutes: DEFAULT_IDLE_EXIT_MINUTES,
		noAuth: false,
		announce: true,
		rotate: false,
	};
	const valueFlags = new Set([
		"--cwd",
		"--port",
		"--bind",
		"--provider",
		"--model",
		"--token",
		"--token-file",
		"--max-clients",
		"--idle-exit",
	]);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			flags.help = true;
		} else if (arg === "--continue") {
			flags.continueSession = true;
		} else if (arg === "--no-auth") {
			flags.noAuth = true;
		} else if (arg === "--no-announce") {
			flags.announce = false;
		} else if (arg === "--announce") {
			flags.announce = true;
		} else if (arg === "--rotate") {
			flags.rotate = true;
		} else if (valueFlags.has(arg)) {
			const value = args[i + 1] ?? "";
			i += 1;
			if (arg === "--cwd") flags.cwd = value;
			else if (arg === "--port") flags.port = Number.parseInt(value, 10) || DEFAULT_PORT;
			else if (arg === "--bind") flags.bind = value;
			else if (arg === "--provider") flags.provider = value;
			else if (arg === "--model") flags.model = value;
			else if (arg === "--token") flags.token = value;
			// --token-file is accepted for CLI compatibility; the default token
			// location already persists under the agent dir.
			else if (arg === "--max-clients") flags.maxClients = Math.max(1, Number.parseInt(value, 10) || 1);
			else if (arg === "--idle-exit") flags.idleExitMinutes = Math.max(0, Number.parseInt(value, 10) || 0);
		}
	}
	return flags;
}

const HELP_TEXT = `A-Coder serve — expose the coding agent to mobile clients over WebSocket.

Usage: a-coder-cli serve [options]

Options:
  --cwd <dir>            Project directory for the engine (default: current directory)
  --port <n>             WebSocket port (default 8787; auto-picks a free port if busy)
  --bind <addr>          Bind address (default 0.0.0.0; use 127.0.0.1 for local-only)
  --provider <id>        Provider forwarded to the engine
  --model <id>           Model forwarded to the engine
  --continue             Resume the most recent session in --cwd
  --token <secret>       Use an existing pairing token (default: load or generate)
  --max-clients <n>      Concurrent clients (default 1)
  --idle-exit <minutes>  Exit after N minutes with no connected client (default 30, 0 = never)
  --no-auth              Disable token auth (only allowed with --bind 127.0.0.1)
  --no-announce          Disable mDNS discovery announce
  --rotate               Regenerate the persisted pairing token
  -h, --help             Show this help
`;

function readCliVersion(): string {
	if (VERSION && VERSION !== "0.0.0") return VERSION;
	try {
		const require = createRequire(import.meta.url);
		return require(getPackageJsonPath()).version as string;
	} catch {
		return "unknown";
	}
}

function friendlyHostName(): string {
	return hostname().replace(/\.local$/, "");
}

/** First non-internal IPv4 address (for the pairing banner). */
function primaryLanAddress(): string | null {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const entry of addresses ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			return entry.address;
		}
	}
	return null;
}

function logLine(message: string): void {
	process.stderr.write(`[serve] ${message}\n`);
}

// ---------------------------------------------------------------------------
// Command entry
// ---------------------------------------------------------------------------

export async function handleServeCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "serve") return false;

	const flags = parseServeFlags(args.slice(1));
	if (flags.help) {
		process.stderr.write(`${HELP_TEXT}\n`);
		return true;
	}
	if (flags.noAuth && flags.bind !== "127.0.0.1" && flags.bind !== "localhost") {
		process.stderr.write("Error: --no-auth is only allowed with --bind 127.0.0.1\n");
		process.exitCode = 1;
		return true;
	}

	const version = readCliVersion();
	const friendlyName = `A-Coder on ${friendlyHostName()}`;
	const token = flags.noAuth ? "" : resolveToken({ token: flags.token, rotate: flags.rotate });
	const id = token ? machineId(token) : "noauth";
	const cwd = flags.cwd ?? process.cwd();

	// Bridge state, mutated through the closures below (declared before the
	// server so its callbacks can close over them).
	let engine: EngineProcess | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let shuttingDown = false;

	const cancelIdleExit = (): void => {
		if (idleTimer !== undefined) {
			clearTimeout(idleTimer);
			idleTimer = undefined;
		}
	};

	const armIdleExit = (): void => {
		if (flags.idleExitMinutes === 0 || shuttingDown) return;
		cancelIdleExit();
		idleTimer = setTimeout(
			() => {
				logLine(`no clients for ${flags.idleExitMinutes} minutes; shutting down`);
				void shutdown(0);
			},
			flags.idleExitMinutes * 60 * 1000,
		);
	};

	const server = new BridgeWsServer({
		port: flags.port ?? DEFAULT_PORT,
		host: flags.bind,
		token,
		maxClients: flags.maxClients,
		requireAuth: !flags.noAuth,
		version,
		machineId: id,
		friendlyName,
		onClientMessage: (data, ws) => {
			// Inbound: strict JSONL — split on LF only, forward each line. A line
			// the engine cannot accept (not started, exited, restarting) is refused
			// back to the sender: the client must learn its message was dropped
			// instead of waiting forever for a response that never comes.
			for (const rawLine of data.split("\n")) {
				const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
				if (line.length === 0) continue;
				if (!engine?.writeLine(line)) {
					server.sendTo(ws, bridgeFrame({ type: "bridge", event: "engine_unavailable" }));
				}
			}
		},
		onClientConnected: () => {
			cancelIdleExit();
			void ensureEngine();
			server.broadcast(bridgeFrame({ type: "bridge", event: "connected", clients: server.clientCount }));
		},
		onClientDisconnected: () => {
			if (server.clientCount === 0) armIdleExit();
		},
	});

	const announce = new BridgeAnnounce();

	function ensureEngine(): Promise<void> {
		if (engine) return Promise.resolve(); // running, or restarts owned by EngineProcess
		engine = new EngineProcess({
			cwd,
			provider: flags.provider,
			model: flags.model,
			continueSession: flags.continueSession,
			onLine: (line) => server.broadcast(`${line}\n`),
			onExit: ({ code, willRestart }) => {
				server.broadcast(bridgeFrame({ type: "bridge", event: "engine_exited", code: code ?? null }));
				if (!willRestart) {
					server.broadcast(bridgeFrame({ type: "bridge", event: "engine_failed", attempts: 2 }));
				}
			},
			log: logLine,
		});
		return engine
			.start()
			.then(() => {
				logLine("engine started");
			})
			.catch((error: unknown) => {
				logLine(`failed to spawn engine: ${error instanceof Error ? error.message : String(error)}`);
			});
	}

	async function shutdown(code: number): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		cancelIdleExit();
		server.broadcast(bridgeFrame({ type: "bridge", event: "shutting_down" }));
		announce.stop();
		await engine?.stop();
		await server.stop();
		process.exit(code);
	}

	// Bind, probing the next ports when the default is busy (unless explicit).
	let bound = false;
	let lastBindError: unknown;
	if (flags.port !== undefined) {
		try {
			await server.start();
			bound = true;
		} catch (error) {
			logLine(`failed to bind port ${flags.port}: ${error instanceof Error ? error.message : String(error)}`);
			process.exitCode = 1;
			return true;
		}
	} else {
		for (let candidate = DEFAULT_PORT; candidate < DEFAULT_PORT + PORT_PROBE_ATTEMPTS && !bound; candidate++) {
			try {
				server.setPort(candidate);
				await server.start();
				bound = true;
			} catch (error) {
				lastBindError = error;
			}
		}
		if (!bound) {
			logLine(
				`failed to bind a port: ${lastBindError instanceof Error ? lastBindError.message : String(lastBindError)}`,
			);
			process.exitCode = 1;
			return true;
		}
	}
	const address = server.address!;

	// Pairing banner (stderr — stdout stays clean).
	const lanIp = primaryLanAddress() ?? address.address;
	process.stderr.write(`a-coder-cli serve listening on ws://${lanIp}:${address.port}\n`);
	if (!flags.noAuth) {
		const payload = pairingPayload({ host: lanIp, port: address.port, token, name: friendlyName });
		process.stderr.write(`Pairing token: ${token}\n`);
		process.stderr.write(`  manual: ${manualChunks(token)}\n`);
		try {
			const qr = await QRCode.toString(JSON.stringify(payload), { type: "terminal", small: true });
			process.stderr.write(`${qr}\n`);
		} catch {
			process.stderr.write("(QR unavailable — use the manual token above)\n");
		}
	}
	if (flags.announce) {
		announce.start({ name: friendlyName, port: address.port, machineId: id });
		logLine(`mDNS: _a-coder._tcp announced as "${friendlyName}"`);
	}
	logLine(`cwd: ${cwd}`);
	logLine(`version: ${version}`);

	armIdleExit();

	process.on("SIGINT", () => {
		logLine("shutting down (SIGINT)");
		void shutdown(0);
	});
	process.on("SIGTERM", () => {
		logLine("shutting down (SIGTERM)");
		void shutdown(0);
	});

	return true;
}

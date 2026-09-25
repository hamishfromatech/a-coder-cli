/**
 * Engine process manager for the serve bridge.
 *
 * Spawns `a-coder-cli --mode rpc` exactly like the desktop app does
 * (`desktop-app/src-tauri/src/rpc/client.rs::spawn` semantics), pumps its
 * NDJSON stdout to the WebSocket bridge and client stdin lines into the
 * engine, and owns the crash-restart policy (max 2 restarts, 30s apart).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachJsonlLineReader } from "../modes/rpc/jsonl.ts";

const RESTART_LIMIT = 2;
const DEFAULT_RESTART_DELAY_MS = 30_000;
const SIGKILL_GRACE_MS = 10_000;

/** Resolve the a-coder-cli child command (same walk as bench; see bench/core.ts). */
function resolveBenchChildEntry(): string {
	if (process.argv[1]?.endsWith(".ts")) {
		// Dev: re-run the TS CLI entry with the loader flags we inherited.
		let dir = dirname(fileURLToPath(import.meta.url));
		while (dir !== dirname(dir) && !fs.existsSync(join(dir, "package.json"))) {
			dir = dirname(dir);
		}
		return join(dir, "src", "cli.ts");
	}
	let dir = dirname(fileURLToPath(import.meta.url));
	while (dir !== dirname(dir) && !fs.existsSync(join(dir, "package.json"))) {
		dir = dirname(dir);
	}
	return join(dir, "dist", "cli.js");
}

export interface EngineOptions {
	cwd: string;
	provider?: string;
	model?: string;
	continueSession: boolean;
	/** Test hook: override the engine command (defaults to the a-coder-cli child). */
	commandOverride?: { command: string; baseArgs: string[] };
	/** Test hook: restart delay (default 30s, doc 04 §3). */
	restartDelayMs?: number;
	/** Called for every engine stdout line (NDJSON, no trailing newline). */
	onLine: (line: string) => void;
	/** Called on exit. `willRestart` is true when a crash-restart is scheduled. */
	onExit: (info: { code: number | null; signal: NodeJS.Signals | null; willRestart: boolean }) => void;
	/** Debug/log sink (bridge stderr). */
	log: (message: string) => void;
}

export class EngineProcess {
	private readonly options: EngineOptions;
	private child: ChildProcess | undefined;
	private restarts = 0;
	private stopped = false;

	constructor(options: EngineOptions) {
		this.options = options;
	}

	get running(): boolean {
		return this.child !== undefined && this.child.exitCode === null && !this.stopped;
	}

	get restartCount(): number {
		return this.restarts;
	}

	/** Spawn the engine and start pumping. Resolves once the child is running. */
	start(): Promise<void> {
		this.stopped = false;
		const resolved = this.options.commandOverride ?? {
			command: process.execPath,
			baseArgs: [resolveBenchChildEntry()],
		};
		const { command, baseArgs } = resolved;
		const args = [...baseArgs, "--mode", "rpc"];
		if (this.options.continueSession) args.push("--continue");
		if (this.options.provider) {
			args.push("--provider", this.options.provider);
		}
		if (this.options.model) {
			args.push("--model", this.options.model);
		}

		const child = spawn(command, args, {
			cwd: this.options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});
		this.child = child;

		const out = child.stdout;
		if (out) {
			const unsubscribe = attachJsonlLineReader(out, (line) => {
				if (line.length > 0) this.options.onLine(line);
			});
			child.once("exit", () => unsubscribe());
		}
		const err = child.stderr;
		if (err) {
			attachJsonlLineReader(err, (line) => {
				if (line.length > 0) this.options.log(`[engine] ${line}`);
			});
		}
		child.once("exit", (code, signal) => {
			this.handleExit(code, signal);
		});

		return new Promise<void>((resolve, reject) => {
			if (child.exitCode !== null) {
				reject(new Error(`engine exited immediately with code ${child.exitCode}`));
				return;
			}
			child.once("spawn", () => resolve());
			child.once("error", reject);
		});
	}

	/** Write one NDJSON command line to the engine's stdin. */
	writeLine(line: string): void {
		if (!this.child?.stdin || this.child.exitCode !== null) return;
		this.child.stdin.write(`${line}\n`);
	}

	/** Graceful stop: SIGTERM, then SIGKILL after the grace period. */
	async stop(): Promise<void> {
		this.stopped = true;
		const child = this.child;
		if (!child || child.exitCode !== null) return;
		child.kill("SIGTERM");
		await Promise.race([
			once(child, "exit"),
			new Promise<void>((resolve) => {
				setTimeout(() => {
					if (child.exitCode === null) child.kill("SIGKILL");
					resolve();
				}, SIGKILL_GRACE_MS);
			}),
		]);
	}

	private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
		const willRestart = !this.stopped && this.restarts < RESTART_LIMIT;
		this.options.onExit({ code, signal, willRestart });
		if (!willRestart) return;
		this.restarts += 1;
		const delay = this.options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
		const signalText = code === null ? `signal ${signal}` : `${code}`;
		this.options.log(
			`engine exited (${signalText}); restarting in ${delay}ms (attempt ${this.restarts}/${RESTART_LIMIT})`,
		);
		setTimeout(() => {
			if (this.stopped) return;
			this.start().catch((error) => {
				this.options.log(`[engine] restart failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		}, delay);
	}
}

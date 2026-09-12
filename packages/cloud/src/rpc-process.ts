import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isBunBinary } from "./config.ts";

/**
 * Minimal JSONL RPC client for an a-coder child process (`--mode rpc`).
 *
 * Deliberately self-contained: cloud must not import types or classes from
 * @earendil-works/pi-orchestrator or @earendil-works/pi-coding-agent, because
 * both resolve their type surface back to the coding-agent package, which
 * depends on this package — a type-level dependency cycle. Structural local
 * types keep this package's declaration surface free of workspace references.
 */

/** Commands the cloud runner sends to the agent child. */
export type CloudRpcCommand =
	| { id?: string; type: "prompt"; message: string }
	| { id?: string; type: "abort" }
	| { id?: string; type: "get_state" }
	| { id?: string; type: "refresh_models" }
	| { id?: string; type: "set_model"; provider: string; modelId: string };

/** Subset of the RPC response shape the runner consumes. */
export interface CloudRpcResponse {
	type: "response";
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
	id?: string;
}

/** Agent session events are pass-through JSON; only `type` is guaranteed. */
export type CloudRpcEvent = { type: string } & Record<string, unknown>;

/** Extension UI request (interactive prompt from the agent). */
export interface CloudUiRequest {
	id: string;
	type?: string;
	[key: string]: unknown;
}

export interface CloudRpcProcessOptions {
	cwd: string;
}

interface PendingRequest {
	resolve(response: CloudRpcResponse): void;
	reject(error: Error): void;
}

export class RpcProcessInstance {
	readonly process: ChildProcess;

	private exited = false;
	private nextRequestId = 0;
	private stdoutBuffer = "";
	private stderrBuffer = "";
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly eventListeners = new Set<(event: CloudRpcEvent) => void>();
	private readonly exitListeners = new Set<(error?: Error) => void>();
	private uiRequestHandler: ((request: CloudUiRequest) => void) | undefined;

	constructor(options: { cwd: string }) {
		const rpcCommand = this.getSpawnCommand();
		this.process = spawn(rpcCommand.command, rpcCommand.args, {
			cwd: options.cwd,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (!this.process.stdin || !this.process.stdout) {
			throw new Error("Failed to create RPC process stdio");
		}
		this.attachListeners();
	}

	private getSpawnCommand(): { command: string; args: string[] } {
		if (isBunBinary) {
			return {
				command: join(dirname(process.execPath), process.platform === "win32" ? "a-coder-cli.exe" : "a-coder-cli"),
				args: ["--mode", "rpc"],
			};
		}
		return {
			command: process.execPath,
			// import.meta.resolve uses ESM conditions; require.resolve cannot see
			// "import"-only export subpaths.
			args: [fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"))],
		};
	}

	private attachListeners(): void {
		this.process.stdout?.setEncoding("utf8");
		this.process.stdout?.on("data", (chunk: string) => {
			this.stdoutBuffer += chunk;
			let newlineIndex = this.stdoutBuffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
				this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
				if (line.length > 0) {
					this.handleLine(line);
				}
				newlineIndex = this.stdoutBuffer.indexOf("\n");
			}
		});
		this.process.stderr?.setEncoding("utf8");
		this.process.stderr?.on("data", (chunk: string) => {
			this.stderrBuffer += chunk;
		});
		this.process.on("error", (error) => {
			const failure = new Error(`Failed to start RPC process: ${String(error)}. Stderr: ${this.stderrBuffer}`);
			this.rejectAllPending(failure);
			this.notifyExit(failure);
		});
		this.process.on("close", (code, signal) => {
			this.exited = true;
			const error = new Error(`RPC process exited (code=${code} signal=${signal}). Stderr: ${this.stderrBuffer}`);
			this.rejectAllPending(error);
			this.notifyExit(error);
		});
	}

	private handleLine(line: string): void {
		let parsed: { type?: string; id?: string };
		try {
			parsed = JSON.parse(line) as { type?: string; id?: string };
		} catch {
			return;
		}
		switch (parsed.type) {
			case "response": {
				if (!parsed.id) {
					return;
				}
				const pending = this.pendingRequests.get(parsed.id);
				if (!pending) {
					return;
				}
				this.pendingRequests.delete(parsed.id);
				pending.resolve(parsed as unknown as CloudRpcResponse);
				return;
			}
			case "extension_ui_request": {
				this.uiRequestHandler?.(parsed as unknown as CloudUiRequest);
				return;
			}
			default: {
				for (const listener of this.eventListeners) {
					listener(parsed as CloudRpcEvent);
				}
			}
		}
	}

	private rejectAllPending(error: Error): void {
		for (const [id, pending] of this.pendingRequests) {
			this.pendingRequests.delete(id);
			pending.reject(error);
		}
	}

	private notifyExit(error?: Error): void {
		for (const listener of this.exitListeners) {
			listener(error);
		}
	}

	send(command: CloudRpcCommand): Promise<CloudRpcResponse> {
		if (this.exited) {
			throw new Error(`RPC process is not running. Stderr: ${this.stderrBuffer}`);
		}
		const id = command.id ?? `cloud_${++this.nextRequestId}_${randomUUID()}`;
		const fullCommand = { ...command, id } as unknown as Record<string, unknown>;
		return new Promise<CloudRpcResponse>((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
			this.process.stdin?.write(`${JSON.stringify(fullCommand)}\n`);
		});
	}

	setUiRequestHandler(handler: ((request: CloudUiRequest) => void) | undefined): void {
		this.uiRequestHandler = handler;
	}

	onEvent(listener: (event: CloudRpcEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	onExit(listener: (error?: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => {
			this.exitListeners.delete(listener);
		};
	}

	async dispose(): Promise<void> {
		if (this.exited) {
			return;
		}
		this.exited = true;
		this.rejectAllPending(new Error("RPC process disposed"));
		this.process.kill();
	}
}

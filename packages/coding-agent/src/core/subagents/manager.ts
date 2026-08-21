import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "../../config.ts";
import type { SubagentConfig, SubagentRecord } from "./types.ts";

const SUBAGENTS_FILE_NAME = "subagents.json";
const MAX_STORED_EVENTS = 200;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

interface RunningProcess {
	record: SubagentRecord;
	process: ReturnType<typeof spawn>;
	stderr: string;
	resolve: () => void;
	reject?: () => void;
}

export class SubagentManager {
	private agents = new Map<string, SubagentRecord>();
	private running = new Map<string, RunningProcess>();
	private statePath: string;
	private cliPath: string;
	private defaultProvider?: string;
	private defaultModel?: string;

	constructor(options?: { cliPath?: string; defaultProvider?: string; defaultModel?: string }) {
		this.statePath = path.join(getAgentDir(), SUBAGENTS_FILE_NAME);
		this.cliPath = options?.cliPath ?? this.resolveCliPath();
		this.defaultProvider = options?.defaultProvider;
		this.defaultModel = options?.defaultModel;
		this.load();
	}

	private resolveCliPath(): string {
		// In development, use the built dist/cli.js relative to this file.
		const builtin = path.resolve(import.meta.dirname, "../../../dist/cli.js");
		if (fs.existsSync(builtin)) {
			return builtin;
		}
		// Otherwise assume `a-coder-cli` is on PATH.
		return "a-coder-cli";
	}

	private load(): void {
		try {
			if (!fs.existsSync(this.statePath)) return;
			const raw = fs.readFileSync(this.statePath, "utf-8");
			const state = JSON.parse(raw) as { agents?: SubagentRecord[] };
			for (const record of state.agents ?? []) {
				this.agents.set(record.id, record);
			}
		} catch {
			// ignore corrupt state
		}
	}

	private save(): void {
		try {
			const dir = path.dirname(this.statePath);
			fs.mkdirSync(dir, { recursive: true });
			const state = { agents: Array.from(this.agents.values()) };
			fs.writeFileSync(this.statePath, JSON.stringify(state, null, "	"), "utf-8");
		} catch {
			// ignore save failures
		}
	}

	private now(): string {
		return new Date().toISOString();
	}

	private makeRecord(config: SubagentConfig): SubagentRecord {
		return {
			id: config.id,
			config,
			status: "pending",
			createdAt: this.now(),
			updatedAt: this.now(),
			events: [],
		};
	}

	spawn(config: SubagentConfig): SubagentRecord {
		if (this.agents.has(config.id) || this.running.has(config.id)) {
			throw new Error(`Subagent with id "${config.id}" already exists`);
		}

		const record = this.makeRecord(config);
		const sessionFile = path.join(getAgentDir(), "sessions", `subagent-${config.id}.jsonl`);
		record.sessionPath = sessionFile;
		this.agents.set(config.id, record);
		this.save();

		const args = ["--mode", "rpc", "--session", sessionFile, "--no-session", "false"];
		if (config.provider ?? this.defaultProvider) {
			args.push("--provider", config.provider ?? this.defaultProvider!);
		}
		if (config.model ?? this.defaultModel) {
			args.push("--model", config.model ?? this.defaultModel!);
		}

		const isBinary = this.cliPath === "a-coder-cli" || !this.cliPath.endsWith(".js");
		const command = isBinary ? this.cliPath : "node";
		const commandArgs = isBinary ? args : [this.cliPath, ...args];

		const child = spawn(command, commandArgs, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, A_CODER_CLI_OFFLINE: process.env.A_CODER_CLI_OFFLINE ?? "1" },
			windowsHide: true,
		});

		let buffer = "";
		const stderr: string[] = [];
		const running: RunningProcess = {
			record,
			process: child,
			stderr: "",
			resolve: () => {},
		};

		const update = (updates: Partial<SubagentRecord>) => {
			Object.assign(record, updates, { updatedAt: this.now() });
			this.save();
		};

		child.stdout?.on("data", (data: Buffer) => {
			buffer += data.toString("utf-8");
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line) as AgentEvent;
					record.events.push(event);
					if (record.events.length > MAX_STORED_EVENTS) {
						record.events.shift();
					}
					const lastMessage =
						(event as { messages?: unknown[]; message?: unknown }).messages?.at(-1) ??
						(event as { message?: unknown }).message;
					const candidate = lastMessage as
						| { role?: string; content?: ({ type?: string; text?: string } | string)[] | string }
						| undefined;
					if (candidate?.role === "assistant" && candidate.content) {
						const parts = Array.isArray(candidate.content) ? candidate.content : [candidate.content];
						const text = parts
							.map((c) => (typeof c === "string" ? c : ((c as { text?: string }).text ?? "")))
							.join("");
						if (text) {
							update({ lastOutput: text });
						}
					}
					if (event.type === "agent_end") {
						update({ status: "completed" });
						running.resolve();
					}
				} catch {
					// ignore non-JSON lines
				}
			}
		});

		child.stderr?.on("data", (data: Buffer) => {
			const text = data.toString("utf-8");
			stderr.push(text);
			running.stderr = stderr.join("");
		});

		child.on("error", (err) => {
			update({ status: "failed", error: err.message });
			running.resolve();
		});

		child.on("exit", (code) => {
			if (record.status === "running" || record.status === "pending") {
				update({ status: code === 0 ? "completed" : "failed", exitCode: code });
			}
			running.resolve();
			this.running.delete(config.id);
		});

		// Send initial prompt as a proper RPC command.
		const promptCommand = {
			type: "prompt",
			message: config.systemPrompt ? `${config.systemPrompt}\n\n${config.task}` : config.task,
		};
		child.stdin?.write(`${JSON.stringify(promptCommand)}\n`);

		update({ status: "running" });
		this.running.set(config.id, running);
		this.save();

		// Apply timeout
		const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		setTimeout(() => {
			if (this.running.has(config.id)) {
				this.kill(config.id, "timeout");
			}
		}, timeoutMs);

		return record;
	}

	async wait(id: string, timeoutMs?: number): Promise<SubagentRecord> {
		const running = this.running.get(id);
		if (!running) {
			const record = this.agents.get(id);
			if (!record) throw new Error(`Unknown subagent id: ${id}`);
			return record;
		}
		const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
		await new Promise<void>((resolve, reject) => {
			running.resolve = resolve;
			const timeout = setTimeout(() => {
				reject(new Error(`Subagent "${id}" did not complete within ${effectiveTimeout}ms`));
			}, effectiveTimeout);
			running.reject = () => {
				clearTimeout(timeout);
				reject(new Error(`Subagent "${id}" was killed or failed`));
			};
			if (running.record.status !== "running" && running.record.status !== "pending") {
				clearTimeout(timeout);
				resolve();
			}
		});
		return this.agents.get(id)!;
	}

	kill(id: string, reason = "user"): SubagentRecord | undefined {
		const running = this.running.get(id);
		const record = this.agents.get(id);
		if (!record) return undefined;
		if (running) {
			running.process.kill("SIGTERM");
			setTimeout(() => {
				if (!running.process.killed) {
					running.process.kill("SIGKILL");
				}
			}, 2000);
		}
		Object.assign(record, { status: "killed", error: `Killed: ${reason}`, updatedAt: this.now() });
		this.running.delete(id);
		this.save();
		return record;
	}

	get(id: string): SubagentRecord | undefined {
		return this.agents.get(id);
	}

	list(): SubagentRecord[] {
		return Array.from(this.agents.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	remove(id: string): boolean {
		const killed = this.kill(id, "removed");
		const deleted = this.agents.delete(id);
		if (killed || deleted) this.save();
		return deleted;
	}
}

export function createSubagentManager(options?: {
	cliPath?: string;
	defaultProvider?: string;
	defaultModel?: string;
}): SubagentManager {
	return new SubagentManager(options);
}

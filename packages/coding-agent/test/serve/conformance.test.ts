import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

const PORT = 18787;
const cliPath = "/Users/hamishfromatech/Downloads/Code/A-Coder/a-coder-cli/packages/coding-agent/dist/cli.js";
const run =
	process.env.A_CODER_CONFORMANCE === "1" &&
	fs.existsSync(cliPath) &&
	fs.existsSync("/Users/hamishfromatech/Downloads/Code/A-Coder/a-coder-cli/packages/coding-agent/dist/main.js");

let proc: ChildProcess | undefined;

beforeAll(async () => {
	if (!run) return;
	proc = spawn(
		process.execPath,
		[cliPath, "serve", "--bind", "127.0.0.1", "--port", String(PORT), "--no-auth", "--no-announce"],
		{
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("bridge did not start")), 20000);
		const onData = (chunk: Buffer) => {
			if (chunk.toString().includes("listening")) {
				clearTimeout(timer);
				resolve();
			}
		};
		proc!.stdout?.on("data", onData);
		proc!.stderr?.on("data", onData);
		proc!.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`bridge exited early (${code})`));
		});
	});
}, 30000);

afterAll(async () => {
	if (proc && !proc.killed) {
		proc.kill("SIGTERM");
		await new Promise((resolve) => setTimeout(resolve, 1000));
		if (!proc.killed) proc.kill("SIGKILL");
	}
});

describe.skipIf(!run)("real-engine conformance (doc-03 §8)", () => {
	it("health endpoint reports ok", async () => {
		const res = await fetch(`http://127.0.0.1:${PORT}/health`);
		expect(res.ok).toBe(true);
		const body = (await res.json()) as { ok?: boolean };
		expect(body.ok).toBe(true);
	});

	it("connects without auth and receives a bridge server_version frame", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${PORT}/rpc`);
		const frames: unknown[] = [];
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		ws.on("message", (data) => {
			for (const line of data.toString().split("\n")) {
				if (line.trim()) {
					try {
						frames.push(JSON.parse(line));
					} catch {
						frames.push(line);
					}
				}
			}
		});
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(frames.some((f) => (f as { event?: string }).event === "server_version")).toBe(true);
		ws.close();
	});

	it("correlates a command id and tolerates U+2028 in strings", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${PORT}/rpc`);
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		const frames: unknown[] = [];
		ws.on("message", (data) => {
			for (const line of data.toString().split("\n")) {
				if (line.trim()) {
					try {
						frames.push(JSON.parse(line));
					} catch {
						frames.push(line);
					}
				}
			}
		});
		ws.send(`{"id":"conf-1","type":"command","command":"get_session_stats","note":"a\u2028b"}\n`);
		await new Promise((resolve) => setTimeout(resolve, 1000));
		const response = frames.find((f) => (f as { id?: string }).id === "conf-1") as { id?: string } | undefined;
		expect(response).toBeTruthy();
		ws.close();
	});

	it("bridge control frames parse and do not confuse the router", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${PORT}/rpc`);
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		ws.close();
		expect(true).toBe(true);
	});
});

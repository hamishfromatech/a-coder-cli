import { spawn as nodeSpawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSocketPath, isBunBinary, VERSION } from "./config.ts";
import { connectSocket, isDaemonAlive, sendIpcRequest } from "./ipc/client.ts";
import type { CloudResponse, CloudTask, SpawnTaskOptions } from "./types.ts";

const DAEMON_START_TIMEOUT_MS = 8000;
const DAEMON_POLL_INTERVAL_MS = 250;

/**
 * Spawn the cloud daemon detached from this process so it survives the CLI
 * exiting. Mirrors the orchestrator's binary/node handling.
 */
export function startServeDetached(): void {
	const socketDir = dirname(getSocketPath());
	mkdirSync(socketDir, { recursive: true });

	let command: string;
	let args: string[];
	if (isBunBinary) {
		// Compiled binary: re-exec ourselves with the `cloud serve` subcommand.
		command = join(dirname(process.execPath), process.platform === "win32" ? "a-coder-cli.exe" : "a-coder-cli");
		args = ["cloud", "serve"];
	} else {
		command = process.execPath;
		// import.meta.resolve uses ESM conditions; require.resolve cannot see "import"-only exports.
		args = [fileURLToPath(import.meta.resolve("@earendil-works/pi-cloud/serve-entry"))];
	}
	const child = nodeSpawn(command, args, {
		detached: true,
		stdio: "ignore",
		env: process.env,
	});
	child.unref();
}

/** Connect to the daemon, auto-starting it when it is not running. */
async function request(request: Parameters<typeof sendIpcRequest>[0]): Promise<CloudResponse> {
	if (await isDaemonAlive()) {
		return sendIpcRequest(request);
	}
	startServeDetached();
	const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			await connectSocket();
			return await sendIpcRequest(request);
		} catch {
			await new Promise((resolve) => setTimeout(resolve, DAEMON_POLL_INTERVAL_MS));
		}
	}
	throw new Error("Could not connect to the cloud daemon. Start it with: a-coder cloud serve");
}

export async function cloudSpawn(options: SpawnTaskOptions): Promise<CloudTask | undefined> {
	const response = await request({ type: "spawn_task", ...options });
	if (!response.ok || response.type !== "spawn_task_result" || !response.taskId) {
		const message = "error" in response && response.error ? response.error : "spawn failed";
		throw new Error(message);
	}
	const task = await cloudGet(response.taskId);
	return task;
}

export async function cloudList(): Promise<CloudTask[]> {
	const response = await request({ type: "list_tasks" });
	if (!response.ok || response.type !== "list_tasks_result" || !response.tasks) {
		const message = "error" in response && response.error ? response.error : "list failed";
		throw new Error(message);
	}
	return response.tasks;
}

export async function cloudGet(taskId: string): Promise<CloudTask | undefined> {
	const response = await request({ type: "get_task", taskId });
	if (!response.ok || response.type !== "get_task_result" || !response.task) {
		const message = "error" in response && response.error ? response.error : "get failed";
		throw new Error(message);
	}
	return response.task;
}

export async function cloudStop(taskId: string): Promise<void> {
	const response = await request({ type: "stop_task", taskId });
	if (!response.ok) {
		const message = "error" in response && response.error ? response.error : "stop failed";
		throw new Error(message);
	}
}

export function daemonVersion(): string {
	return VERSION;
}

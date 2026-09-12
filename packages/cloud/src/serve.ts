import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { getSocketPath, VERSION } from "./config.ts";
import { cloudRequestHandler, startCloudIpcServer } from "./ipc/server.ts";
import { resumeOrphanedTasks } from "./tasks.ts";

let shuttingDown = false;

/**
 * Run the cloud daemon: owns the task store, executes tasks, and serves the
 * unix-socket IPC. Intended to run detached (`a-coder cloud serve`); the CLI
 * auto-starts it on first spawn if it is not already running.
 */
export async function serve(): Promise<void> {
	const socketPath = getSocketPath();
	mkdirSync(dirname(socketPath), { recursive: true });

	const server = await startCloudIpcServer(cloudRequestHandler);

	resumeOrphanedTasks();
	console.log(`a-coder cloud daemon listening on ${socketPath} (v${VERSION})`);

	const shutdown = async (exitCode: number) => {
		if (shuttingDown) return;
		shuttingDown = true;
		server.close();
		if (existsSync(socketPath)) {
			rmSync(socketPath, { force: true });
		}
		process.exit(exitCode);
	};

	process.on("SIGINT", () => void shutdown(0));
	process.on("SIGTERM", () => void shutdown(0));
	process.on("SIGHUP", () => void shutdown(0));
}

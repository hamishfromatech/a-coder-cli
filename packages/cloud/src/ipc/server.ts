import { existsSync, unlinkSync } from "node:fs";
import type { Server, Socket } from "node:net";
import { createServer } from "node:net";
import { getSocketPath, VERSION } from "../config.ts";
import * as tasks from "../tasks.ts";
import type { CloudRequest, CloudResponse } from "../types.ts";
import { encodeMessage } from "../types.ts";

export type CloudRequestHandler = (request: CloudRequest) => Promise<CloudResponse>;

function respond(socket: Socket, response: CloudResponse): void {
	socket.write(encodeMessage(response));
}

async function dispatch(handler: CloudRequestHandler, request: CloudRequest): Promise<CloudResponse> {
	try {
		return await handler(request);
	} catch (error) {
		return {
			type: "error",
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Start the cloud daemon's unix-socket server. */
export async function startCloudIpcServer(handler: CloudRequestHandler): Promise<Server> {
	const socketPath = getSocketPath();
	if (existsSync(socketPath)) {
		// Refuse to bind over a live daemon; a stale socket is safe to remove.
		unlinkSync(socketPath);
	}

	return new Promise<Server>((resolve, reject) => {
		const server = createServer((socket) => {
			let buffer = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				let newlineIndex = buffer.indexOf("\n");
				while (newlineIndex !== -1) {
					const line = buffer.slice(0, newlineIndex).trim();
					buffer = buffer.slice(newlineIndex + 1);
					if (line.length > 0) {
						try {
							const request = JSON.parse(line) as CloudRequest;
							void dispatch(handler, request).then((response) => {
								respond(socket, response);
							});
						} catch (error) {
							respond(socket, {
								type: "error",
								ok: false,
								error: `Bad request: ${error instanceof Error ? error.message : String(error)}`,
							});
						}
					}
					newlineIndex = buffer.indexOf("\n");
				}
			});
			socket.on("error", () => {
				// client vanished mid-request; nothing to do
			});
		});

		server.on("error", reject);
		server.listen(socketPath, () => {
			resolve(server);
		});
	});
}

/** Default request handler wiring every supported IPC request. */
export const cloudRequestHandler: CloudRequestHandler = async (request) => {
	switch (request.type) {
		case "ping":
			return { type: "pong", ok: true, version: VERSION };
		case "spawn_task": {
			const task = await tasks.spawnTask({
				repo: request.repo,
				prompt: request.prompt,
				baseBranch: request.baseBranch,
				provider: request.provider,
				model: request.model,
				timeoutMinutes: request.timeoutMinutes,
				push: request.push,
			});
			return { type: "spawn_task_result", ok: true, taskId: task.id };
		}
		case "list_tasks":
			return { type: "list_tasks_result", ok: true, tasks: tasks.listTasks() };
		case "get_task": {
			const task = tasks.getTaskById(request.taskId);
			if (!task) {
				return { type: "get_task_result", ok: false, error: `Task not found: ${request.taskId}` };
			}
			return { type: "get_task_result", ok: true, task };
		}
		case "stop_task": {
			await tasks.stopTask(request.taskId);
			return { type: "stop_task_result", ok: true, taskId: request.taskId };
		}
		default: {
			const exhaustive: never = request;
			return { type: "error", ok: false, error: `Unsupported request: ${JSON.stringify(exhaustive)}` };
		}
	}
};

import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { getSocketPath } from "../config.ts";
import type { CloudRequest, CloudResponse } from "../types.ts";
import { encodeMessage } from "../types.ts";

/** Single request/response round trip over the cloud unix socket. */
export async function sendIpcRequest(request: CloudRequest): Promise<CloudResponse> {
	const socket = await connectSocket();
	try {
		return await requestOverSocket(socket, request);
	} finally {
		socket.destroy();
	}
}

export function connectSocket(): Promise<Socket> {
	return new Promise<Socket>((resolve, reject) => {
		const socketPath = getSocketPath();
		if (!existsSync(socketPath)) {
			reject(new Error(`Cloud daemon socket not found at ${socketPath}`));
			return;
		}
		const socket = createConnection(socketPath);
		socket.once("error", (error) => reject(error));
		socket.once("connect", () => {
			socket.removeListener("error", reject);
			resolve(socket);
		});
	});
}

export function requestOverSocket(socket: Socket, request: CloudRequest): Promise<CloudResponse> {
	return new Promise<CloudResponse>((resolve, reject) => {
		let buffer = "";
		const onData = (chunk: Buffer | string) => {
			buffer += chunk.toString("utf8");
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line.length > 0) {
					try {
						const response = JSON.parse(line) as CloudResponse;
						cleanup();
						resolve(response);
						return;
					} catch (error) {
						cleanup();
						reject(error instanceof Error ? error : new Error(String(error)));
						return;
					}
				}
				newlineIndex = buffer.indexOf("\n");
			}
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			socket.removeListener("data", onData);
			socket.removeListener("error", onError);
		};
		socket.on("data", onData);
		socket.on("error", onError);
		socket.write(encodeMessage(request));
	});
}

/** True when the cloud daemon socket exists and answers a ping. */
export async function isDaemonAlive(): Promise<boolean> {
	try {
		const response = await sendIpcRequest({ type: "ping" });
		return response.ok;
	} catch {
		return false;
	}
}

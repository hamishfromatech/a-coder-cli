import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";

const cliPath = resolve(__dirname, "../src/cli.ts");

/**
 * Regression guard for the Windows piped-stdout buffering bug.
 *
 * The compiled Bun binary buffered a piped stdout in userspace and released it
 * only when the buffer filled (megabytes) or the process exited, so a harness
 * reading the pipe saw nothing: the `engine_info` handshake never arrived while
 * stdin stayed open, and a bidirectional protocol deadlocked. Every other RPC
 * test either mocks `output-guard` or closes stdin, which is why this shipped.
 *
 * The assertion is the shape of the bug: send one command, keep stdin open, and
 * require a response frame within the timeout.
 */
const FRAME_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = FRAME_TIMEOUT_MS + 10_000;

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-stdout-pipe-"));
	tempDirs.push(dir);
	return dir;
}

interface RpcFrame {
	type?: string;
	id?: string;
	command?: string;
	[key: string]: unknown;
}

/**
 * Resolve with the first parsed frame matching `match`, reading incrementally
 * from the live pipe. Rejects (rather than hanging) when no frame arrives.
 */
function waitForFrame(
	stream: NodeJS.ReadableStream,
	match: (frame: RpcFrame) => boolean,
	received: () => number,
): Promise<RpcFrame> {
	return new Promise((resolveFrame, rejectFrame) => {
		let buffer = "";
		const timer = setTimeout(() => {
			cleanup();
			rejectFrame(
				new Error(
					`no matching RPC frame within ${FRAME_TIMEOUT_MS}ms (${received()} byte(s) received on the pipe). ` +
						"Piped stdout is buffering instead of reaching the OS.",
				),
			);
		}, FRAME_TIMEOUT_MS);

		const cleanup = () => {
			clearTimeout(timer);
			stream.off("data", onData);
		};

		const onData = (chunk: Buffer | string) => {
			buffer += chunk.toString();
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (!line) continue;
				let frame: RpcFrame;
				try {
					frame = JSON.parse(line) as RpcFrame;
				} catch {
					continue; // A non-JSON line is noise, not the frame under test.
				}
				if (match(frame)) {
					cleanup();
					resolveFrame(frame);
					return;
				}
			}
		};

		stream.on("data", onData);
	});
}

describe("piped stdout stays live in RPC mode", () => {
	it(
		"delivers a response frame while stdin is still open",
		async () => {
			const tempRoot = createTempDir();
			const agentDir = join(tempRoot, "agent");
			const projectDir = join(tempRoot, "project");
			mkdirSync(agentDir, { recursive: true });
			mkdirSync(projectDir, { recursive: true });

			const child = spawn(process.execPath, [cliPath, "--mode", "rpc", "--no-session", "--no-extensions"], {
				cwd: projectDir,
				env: {
					...process.env,
					[ENV_AGENT_DIR]: agentDir,
					TSX_TSCONFIG_PATH: resolve(__dirname, "../../../tsconfig.json"),
				},
				stdio: ["pipe", "pipe", "pipe"],
			});

			let bytesOnStdout = 0;
			child.stdout.on("data", (chunk: Buffer) => {
				bytesOnStdout += chunk.length;
			});
			// The child must never block on a full stderr pipe.
			child.stderr.on("data", () => {});

			try {
				child.stdin.write('{"id":"liveness","type":"get_state"}\n');

				const frame = await waitForFrame(
					child.stdout,
					(candidate) => candidate.type === "response" && candidate.id === "liveness",
					() => bytesOnStdout,
				);

				expect(frame.type).toBe("response");
				expect(frame.command).toBe("get_state");
				// stdin is intentionally still open at this point: a close-triggered
				// flush would not have satisfied the assertion above.
				expect(child.stdin.writableEnded).toBe(false);
				expect(bytesOnStdout).toBeGreaterThan(0);
			} finally {
				child.stdin.end();
				child.kill();
				await new Promise<void>((resolveExit) => {
					if (child.exitCode !== null) {
						resolveExit();
						return;
					}
					const timer = setTimeout(() => {
						child.kill("SIGKILL");
						resolveExit();
					}, 2_000);
					child.once("exit", () => {
						clearTimeout(timer);
						resolveExit();
					});
				});
			}
		},
		TEST_TIMEOUT_MS,
	);
});

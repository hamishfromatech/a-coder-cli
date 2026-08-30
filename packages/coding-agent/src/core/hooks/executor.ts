/**
 * Shell-hook executor for Claude-Code-compatible settings hooks.
 *
 * Protocol (matching Claude Code / the A-Coder IDE):
 * - The hook receives a JSON payload on stdin describing the event
 *   ({session_id, cwd, hook_event_name, ...event-specific fields}).
 * - Exit code 0 (empty stdout) = allow, nothing to feed back.
 * - Exit code 0 + JSON stdout = decisions (decoded by the caller).
 * - Exit code 2 = blocking failure: stderr is the reason fed back to the model.
 * - Any other exit code = non-blocking hook error.
 */

import { spawn } from "node:child_process";
import type { HookConfig } from "./hook-events.ts";

/** Default per-hook timeout in seconds when the hook config omits `timeout`. */
const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;

/** Cap on captured stdout/stderr so a chatty hook cannot balloon memory. */
const MAX_CAPTURE_BYTES = 512 * 1024;

export interface HookExecutionResult {
	/** The hook definition that ran. */
	hook: HookConfig;
	/** Process exit code (null if the process could not be spawned). */
	exitCode: number | null;
	/** Captured stdout (capped). */
	stdout: string;
	/** Captured stderr (capped). */
	stderr: string;
	/** True when the hook was killed after exceeding its timeout. */
	timedOut: boolean;
	/** Spawn failure (environ/exec problems), not a hook verdict. */
	spawnError?: string;
}

export interface ExecuteHookOptions {
	/** Working directory for the hook process. Defaults to process.cwd(). */
	cwd?: string;
	/** Parent cancellation: aborting kills the child and resolves early. */
	signal?: AbortSignal;
}

/**
 * Run one `command`-type hook to completion. Shell-form commands run via
 * `bash -c`; hooks that specify an `args` array run via direct argv with no
 * shell tokenization. Returns the low-level outcome — verdict decoding lives
 * in `run-hooks.ts`, independently unit-testable from process spawning.
 */
export function executeHookCommand(
	hook: HookConfig,
	input: Record<string, unknown>,
	options: ExecuteHookOptions = {},
): Promise<HookExecutionResult> {
	return new Promise((resolve) => {
		const timeoutSeconds =
			typeof hook.timeout === "number" && Number.isFinite(hook.timeout) && hook.timeout > 0
				? hook.timeout
				: DEFAULT_HOOK_TIMEOUT_SECONDS;

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const child = spawnHookProcess();

		const timer = setTimeout(() => {
			timedOut = true;
			try {
				child?.kill("SIGTERM");
			} catch {}
			setTimeout(() => {
				try {
					child?.kill("SIGKILL");
				} catch {}
			}, 1000).unref?.();
		}, timeoutSeconds * 1000);
		timer.unref?.();

		const onAbort = (): void => {
			try {
				child?.kill("SIGTERM");
			} catch {}
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		const finish = (exitCode: number | null, spawnError?: string): void => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			resolve({ hook, exitCode, stdout, stderr, timedOut, spawnError });
		};

		if (!child) {
			// spawnHookProcess already reported a spawn error.
			finish(null, "failed to spawn hook process");
			return;
		}

		child.stdout?.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk.toString();
		});
		child.on("error", (err) => {
			finish(null, err.message);
		});
		child.on("close", (code) => {
			finish(code);
		});

		const stdin = child.stdin;
		if (stdin) {
			// EPIPE if the hook closes stdin early — not a hook failure.
			stdin.on("error", () => {});
			try {
				stdin.end(JSON.stringify(input ?? {}));
			} catch {}
		}

		function spawnHookProcess(): ReturnType<typeof spawn> | undefined {
			if (hook.type !== "command" || typeof hook.command !== "string" || hook.command.trim() === "") {
				return undefined;
			}
			try {
				const hasArgs = Array.isArray(hook.args) && hook.args.length > 0;
				if (hasArgs) {
					// Direct argv: no shell tokenization.
					return spawn(hook.command, hook.args, {
						cwd: options.cwd ?? process.cwd(),
						env: { ...(process.env as Record<string, string>), ...(hook.env ?? {}) },
						stdio: ["pipe", "pipe", "pipe"],
					});
				}
				return spawn("bash", ["-c", hook.command], {
					cwd: options.cwd ?? process.cwd(),
					env: { ...(process.env as Record<string, string>), ...(hook.env ?? {}) },
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch {
				return undefined;
			}
		}
	});
}

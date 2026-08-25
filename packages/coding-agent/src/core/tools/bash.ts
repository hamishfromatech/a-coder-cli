import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { type Static, Type } from "typebox";
import { BashProgressComponent } from "../../modes/interactive/components/bash-progress.ts";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { truncateToVisualLines } from "../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { formatDuration } from "../../utils/duration.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import {
	appendBackgroundProcessOutput,
	appendBashProgress,
	clearBackgroundRequest,
	completeBackgroundProcess,
	completeBashProgress,
	isBackgroundRequested,
	startBackgroundProcess,
	startBashProgress,
} from "../stores/index.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { getTextOutput, invalidArgText, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./truncate.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
	if (timeout === undefined) return undefined;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds");
	}

	const timeoutMs = timeout * 1000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
	}
	return timeoutMs;
}

const bashSchema = Type.Object(
	{
		command: Type.String({ description: "Bash command to execute" }),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
		background: Type.Optional(
			Type.Boolean({
				description:
					"If true, run the command in the background (detached). The tool returns immediately with a process id and the command continues running. Use for long-running tasks like dev servers, file watchers, or builds you want to monitor while continuing other work. Output is captured to a temp file and shown in the background processes bar.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	/** stderr output captured separately for layered rendering (stdout vs stderr). */
	stderr?: string;
}

export interface BashExecOptions {
	onData: (data: Buffer) => void;
	/** Optional: receives stderr chunks separately (for layered rendering). When provided, stderr still flows to onData so the model sees merged output. */
	onStderrData?: (data: Buffer) => void;
	signal?: AbortSignal;
	timeout?: number;
	env?: NodeJS.ProcessEnv;
	/**
	 * Polled periodically while the command runs. When it returns true,
	 * exec detaches the child process (stops awaiting, removes listeners,
	 * does NOT kill) and resolves with `{ backgrounded: true, child }`.
	 * The caller then takes ownership of the child for background tracking.
	 */
	backgroundCheck?: () => boolean;
}

export interface BashExecResult {
	exitCode: number | null;
	/** True when the command was backgrounded mid-flight via `backgroundCheck`. */
	backgrounded?: boolean;
	/** The detached child process, only set when `backgrounded` is true. */
	child?: ChildProcess;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to exit code (null if killed), or
	 *          `{ backgrounded: true, child }` if backgrounded mid-flight.
	 */
	exec: (command: string, cwd: string, options: BashExecOptions) => Promise<BashExecResult>;
}

/**
 * Create bash operations using pi's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want pi's
 * standard local shell behavior while wrapping or rewriting commands.
 */
export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
	return {
		exec: async (command, cwd, { onData, onStderrData, signal, timeout, env, backgroundCheck }) => {
			const timeoutMs = resolveTimeoutMs(timeout);
			if (signal?.aborted) {
				throw new Error("aborted");
			}
			const shellConfig = getShellConfig(options?.shellPath);
			try {
				await fsAccess(cwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}

			const commandFromStdin = shellConfig.commandTransport === "stdin";
			const child = spawn(shellConfig.shell, commandFromStdin ? shellConfig.args : [...shellConfig.args, command], {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? getShellEnv(),
				stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			if (commandFromStdin) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(command);
			}
			if (child.pid) trackDetachedChildPid(child.pid);
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			try {
				// Set timeout if provided.
				if (timeoutMs !== undefined) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeoutMs);
				}
				// Stream stdout and stderr.
				child.stdout?.on("data", onData);
				child.stderr?.on("data", (data: Buffer) => {
					// Report stderr separately for layered rendering, and also
					// merge into onData so the model sees interleaved output.
					onStderrData?.(data);
					onData(data);
				});
				// Handle abort signal by killing the entire process tree.
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}

				// Exit promise: resolves when the child closes. We use a plain
				// `close` listener instead of waitForChildProcess because the
				// latter destroys stdout/stderr on resolve — which would kill
				// output for a backgrounded process.
				const exitPromise = new Promise<number | null>((resolveExit, rejectExit) => {
					child.once("close", (code: number | null) => resolveExit(code));
					child.once("error", (err: Error) => rejectExit(err));
				});

				// Background promise: resolves when backgroundCheck() returns true.
				// The poller detaches listeners so the child keeps running.
				let resolveBg: () => void = () => {};
				const bgPromise = new Promise<void>((r) => {
					resolveBg = r;
				});
				let backgroundPoller: NodeJS.Timeout | undefined;
				if (backgroundCheck) {
					backgroundPoller = setInterval(() => {
						if (backgroundCheck()) {
							child.stdout?.removeListener("data", onData);
							child.stderr?.removeListener("data", onData);
							if (signal) signal.removeEventListener("abort", onAbort);
							if (child.pid) untrackDetachedChildPid(child.pid);
							resolveBg();
						}
					}, 100);
					backgroundPoller.unref?.();
				}

				const raceResult = await Promise.race([
					exitPromise.then((code) => ({ exited: true as const, code })),
					bgPromise.then(() => ({ exited: false as const, code: null })),
				]);

				if (backgroundPoller) clearInterval(backgroundPoller);

				if (!raceResult.exited) {
					// Background requested — return the child for background tracking.
					// The finally block clears the timeout (so it won't kill the
					// process later) and removes the abort listener (already done).
					return { exitCode: null, backgrounded: true, child };
				}

				const exitCode = raceResult.code;
				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					throw new Error(`timeout:${timeout}`);
				}
				return { exitCode };
			} finally {
				if (child.pid) untrackDetachedChildPid(child.pid);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = { command, cwd, env: { ...getShellEnv() } };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Optional explicit shell path from settings */
	shellPath?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
}

const BASH_PREVIEW_LINES = 5;
const BASH_UPDATE_THROTTLE_MS = 100;

type BashRenderState = {
	startedAt: number | undefined;
	endedAt: number | undefined;
	interval: NodeJS.Timeout | undefined;
	progressComponent: BashProgressComponent | undefined;
};

type BashResultRenderState = {
	cachedWidth: number | undefined;
	cachedLines: string[] | undefined;
	cachedSkipped: number | undefined;
};

class BashResultRenderComponent extends Container {
	state: BashResultRenderState = {
		cachedWidth: undefined,
		cachedLines: undefined,
		cachedSkipped: undefined,
	};
}

function formatBashCall(args: { command?: string; timeout?: number } | undefined): string {
	const command = str(args?.command);
	const timeout = args?.timeout as number | undefined;
	const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
	const commandDisplay = command === null ? invalidArgText(theme) : command ? command : theme.fg("toolOutput", "...");
	return theme.fg("toolTitle", theme.bold(`$ ${commandDisplay}`)) + timeoutSuffix;
}

function rebuildBashResultRenderComponent(
	component: BashResultRenderComponent,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
	startedAt: number | undefined,
	endedAt: number | undefined,
): void {
	const state = component.state;
	component.clear();

	let output = getTextOutput(result as any, showImages).trim();
	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
		const footerStart = output.lastIndexOf("\n\n[");
		if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
			output = output.slice(0, footerStart).trimEnd();
		}
	}

	if (output) {
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");

		if (options.expanded) {
			component.addChild(new Text(`\n${styledOutput}`, 0, 0));
		} else {
			component.addChild({
				render: (width: number) => {
					if (state.cachedLines === undefined || state.cachedWidth !== width) {
						const preview = truncateToVisualLines(styledOutput, BASH_PREVIEW_LINES, width);
						state.cachedLines = preview.visualLines;
						state.cachedSkipped = preview.skippedCount;
						state.cachedWidth = width;
					}
					if (state.cachedSkipped && state.cachedSkipped > 0) {
						const hint =
							theme.fg("muted", `... (${state.cachedSkipped} earlier lines,`) +
							` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
						return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
					}
					return ["", ...(state.cachedLines ?? [])];
				},
				invalidate: () => {
					state.cachedWidth = undefined;
					state.cachedLines = undefined;
					state.cachedSkipped = undefined;
				},
			});
		}
	}

	// Render stderr separately in error color if captured.
	const stderr = result.details?.stderr;
	if (stderr) {
		const styledStderr = stderr
			.split("\n")
			.map((line) => theme.fg("error", line))
			.join("\n");
		component.addChild(new Text(`\n${theme.fg("muted", "stderr:")}\n${styledStderr}`, 0, 0));
	}

	if (truncation?.truncated || fullOutputPath) {
		const warnings: string[] = [];
		if (fullOutputPath) {
			warnings.push(`Full output: ${fullOutputPath}`);
		}
		if (truncation?.truncated) {
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
				);
			}
		}
		component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
	}

	if (startedAt !== undefined) {
		const label = options.isPartial ? "Elapsed" : "Took";
		const endTime = endedAt ?? Date.now();
		component.addChild(new Text(`\n${theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`)}`, 0, 0));
	}
}

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
	const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds. Set background: true for long-running commands (dev servers, watchers) — the command runs detached and the tool returns immediately.`,
		promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
		promptGuidelines: [
			"Use background: true for long-running commands like dev servers, file watchers, or builds that should keep running while you continue other work. The tool returns immediately and output is captured to a temp file.",
		],
		parameters: bashSchema,
		async execute(
			toolCallId,
			{ command, timeout, background }: { command: string; timeout?: number; background?: boolean },
			signal?: AbortSignal,
			onUpdate?,
			_ctx?,
		) {
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);
			const output = new OutputAccumulator({ tempFilePrefix: "pi-bash" });
			let acceptingOutput = true;
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;

			// Live progress side-channel: publish stdout/stderr chunks to the
			// bash-progress store so the UI can render a live tail while the
			// command runs. The store handles throttling and a 1s heartbeat.
			const timeoutMs = timeout !== undefined ? timeout * 1000 : undefined;
			startBashProgress(toolCallId, timeoutMs);

			// Background mode: spawn detached, return immediately, track in the
			// background-process store. The agent gets a quick confirmation and
			// can continue working; the user monitors via the background bar.
			if (background) {
				const bgOutput = new OutputAccumulator({ tempFilePrefix: "pi-bash-bg" });
				const bgShellConfig = getShellConfig(options?.shellPath);
				const bgCommandFromStdin = bgShellConfig.commandTransport === "stdin";
				const bgChild = spawn(
					bgShellConfig.shell,
					bgCommandFromStdin ? bgShellConfig.args : [...bgShellConfig.args, spawnContext.command],
					{
						cwd: spawnContext.cwd,
						detached: true,
						env: spawnContext.env,
						stdio: [bgCommandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
						windowsHide: true,
					},
				);
				if (bgCommandFromStdin && bgChild.stdin) {
					bgChild.stdin.on("error", () => {});
					bgChild.stdin.end(spawnContext.command);
				}
				if (bgChild.pid) trackDetachedChildPid(bgChild.pid);

				const bgSnapshot = bgOutput.snapshot({ persistIfTruncated: true });
				startBackgroundProcess(toolCallId, command, bgChild.pid, bgSnapshot.fullOutputPath);

				const bgOnData = (data: Buffer) => {
					bgOutput.append(data);
					appendBackgroundProcessOutput(toolCallId, data.toString());
				};
				bgChild.stdout?.on("data", bgOnData);
				bgChild.stderr?.on("data", bgOnData);

				bgChild.on("error", () => {
					completeBackgroundProcess(toolCallId, undefined, false);
					if (bgChild.pid) untrackDetachedChildPid(bgChild.pid);
				});
				bgChild.on("close", (code) => {
					bgOutput.finish();
					completeBackgroundProcess(toolCallId, code ?? undefined, false);
					if (bgChild.pid) untrackDetachedChildPid(bgChild.pid);
				});

				// Don't wait — return immediately so the agent can continue.
				completeBashProgress(toolCallId);
				return {
					content: [
						{
							type: "text",
							text: `Background process started (pid ${bgChild.pid ?? "unknown"}). Output is being captured. The command will continue running after this tool call returns.`,
						},
					],
					details: undefined,
				};
			}

			const emitOutputUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
					},
				});
			};

			const clearUpdateTimer = () => {
				if (updateTimer) {
					clearTimeout(updateTimer);
					updateTimer = undefined;
				}
			};

			const scheduleOutputUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitOutputUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitOutputUpdate();
				}, delay);
			};

			if (onUpdate) {
				onUpdate({ content: [], details: undefined });
			}

			const handleData = (data: Buffer) => {
				if (!acceptingOutput) return;
				output.append(data);
				appendBashProgress(toolCallId, data.toString());
				scheduleOutputUpdate();
			};

			// Accumulate stderr separately for layered rendering (stdout muted, stderr red).
			const stderrChunks: Buffer[] = [];
			const handleStderrData = (data: Buffer) => {
				if (!acceptingOutput) return;
				stderrChunks.push(data);
			};

			const finishOutput = async () => {
				acceptingOutput = false;
				output.finish();
				clearUpdateTimer();
				emitOutputUpdate();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				await output.closeTempFile();
				return snapshot;
			};

			const formatOutput = (snapshot: Awaited<ReturnType<typeof finishOutput>>, emptyText = "(no output)") => {
				const truncation = snapshot.truncation;
				let text = snapshot.content || emptyText;
				let details: BashToolDetails | undefined;
				// Include stderr if captured.
				const stderrText =
					stderrChunks.length > 0 ? Buffer.concat(stderrChunks).toString("utf8").trimEnd() : undefined;
				if (truncation.truncated || stderrText) {
					details = {
						truncation: truncation.truncated ? truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
						stderr: stderrText,
					};
					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;
					if (truncation.truncated) {
						if (truncation.lastLinePartial) {
							const lastLineSize = formatSize(output.getLastLineBytes());
							text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
						} else if (truncation.truncatedBy === "lines") {
							text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
						} else {
							text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
						}
					}
				}
				return { text, details };
			};

			const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

			try {
				let exitCode: number | null;
				try {
					const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
						onData: handleData,
						onStderrData: handleStderrData,
						signal,
						timeout,
						env: spawnContext.env,
						backgroundCheck: () => isBackgroundRequested(toolCallId),
					});

					// If the command was backgrounded mid-flight (Ctrl+B), take
					// ownership of the child process: attach new listeners that
					// feed the background-process store, register it, and return
					// a confirmation to the model.
					if (result.backgrounded && result.child) {
						const bgChild = result.child;
						const bgSnapshot = output.snapshot({ persistIfTruncated: true });
						startBackgroundProcess(toolCallId, command, bgChild.pid, bgSnapshot.fullOutputPath);
						const bgOnData = (data: Buffer) => {
							appendBackgroundProcessOutput(toolCallId, data.toString());
						};
						bgChild.stdout?.on("data", bgOnData);
						bgChild.stderr?.on("data", bgOnData);
						bgChild.on("close", (code) => {
							completeBackgroundProcess(toolCallId, code ?? undefined, false);
						});
						clearBackgroundRequest(toolCallId);
						completeBashProgress(toolCallId);
						const partialOutput = output.snapshot({ persistIfTruncated: true });
						return {
							content: [
								{
									type: "text",
									text: `Command backgrounded (pid ${bgChild.pid ?? "unknown"}). The process is still running. Output so far:\n${partialOutput.content || "(no output yet)"}`,
								},
							],
							details: undefined,
						};
					}
					exitCode = result.exitCode;
				} catch (err) {
					const snapshot = await finishOutput();
					const { text } = formatOutput(snapshot, "");
					if (err instanceof Error && err.message === "aborted") {
						throw new Error(appendStatus(text, "Command aborted"));
					}
					if (err instanceof Error && err.message.startsWith("timeout:")) {
						const timeoutSecs = err.message.split(":")[1];
						throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`));
					}
					throw err;
				}

				const snapshot = await finishOutput();
				const { text: outputText, details } = formatOutput(snapshot);
				if (exitCode !== 0 && exitCode !== null) {
					throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`));
				}
				return { content: [{ type: "text", text: outputText }], details };
			} finally {
				clearUpdateTimer();
				completeBashProgress(toolCallId);
			}
		},
		renderCall(args, _theme, context) {
			const state = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatBashCall(args));
			return text;
		},
		renderResult(result, options, _theme, context) {
			const state = context.state;
			if (state.startedAt !== undefined && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 1000);
			}
			if (!options.isPartial || context.isError) {
				state.endedAt ??= Date.now();
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
				// Command finished — dispose the live progress component and
				// fall through to the normal result renderer.
				if (state.progressComponent) {
					state.progressComponent.dispose();
					state.progressComponent = undefined;
				}
			} else if (options.isPartial && !context.isError && context.ui) {
				// Command still running — render the live tail from the store.
				// Reuse the existing component if we already created one.
				if (!state.progressComponent) {
					state.progressComponent = new BashProgressComponent(context.toolCallId, context.ui);
				}
				return state.progressComponent;
			}
			const component =
				(context.lastComponent as BashResultRenderComponent | undefined) ?? new BashResultRenderComponent();
			rebuildBashResultRenderComponent(
				component,
				result as any,
				options,
				context.showImages,
				state.startedAt,
				state.endedAt,
			);
			component.invalidate();
			return component;
		},
	};
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	return wrapToolDefinition(createBashToolDefinition(cwd, options));
}

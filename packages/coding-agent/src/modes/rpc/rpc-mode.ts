/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */

import * as crypto from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import { VERSION } from "../../config.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import { captureCliSessionEnd } from "../../core/analytics.ts";
import { CronService } from "../../core/cron/service.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import { reconnectMcpServer } from "../../core/mcp/inline-extension.ts";
import { getMcpServerStates } from "../../core/mcp/status-store.ts";
import { summarizeCoworkerSession } from "../../core/office/coworker-stats.ts";
import { OfficeService } from "../../core/office/service.ts";
import type { Errand } from "../../core/office/types.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { archiveSessionFile } from "../../core/session-maintenance.ts";
import { type SessionInfo, SessionManager } from "../../core/session-manager.ts";
import { getBackgroundProcesses, subscribeBackgroundProcesses } from "../../core/stores/index.ts";
import { findWorkflow } from "../../core/workflows/loader.ts";
import { getWorkflowRunSummaries, stopWorkflowRun, subscribeWorkflowRuns } from "../../core/workflows/registry.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import { externalizeAttachments, type RpcAttachmentData } from "./rpc-attachments.ts";
import { flattenSessionTree, pageMessages, pageTranscriptEntries, toTranscriptEntries } from "./rpc-history.ts";
import { RpcSessionEventStream } from "./rpc-stream.ts";
import type {
	RpcCapability,
	RpcCommand,
	RpcCronRunEvent,
	RpcCronUpdateEvent,
	RpcEngineInfoEvent,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcOfficeActivityEvent,
	RpcOfficeHuddleDeltaEvent,
	RpcOfficeHuddleEvent,
	RpcOfficeUpdateEvent,
	RpcResponse,
	RpcSessionState,
	RpcSessionStatsEvent,
	RpcSlashCommand,
} from "./rpc-types.ts";
import { RPC_CONTRACT } from "./rpc-types.ts";

// Re-export types for consumers
export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
} from "./rpc-types.ts";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime, options?: { logPath?: string }): Promise<never> {
	takeOverStdout();
	// Protocol trace: one JSONL line per inbound command and outbound frame,
	// direction-tagged. Client races (event ordering, latch windows) are
	// otherwise invisible from the engine side; this is the flight recorder.
	// Tracing failures are swallowed: diagnostics must never break the engine.
	const logStream = options?.logPath ? createWriteStream(options.logPath, { flags: "a" }) : undefined;
	logStream?.on("error", () => {});
	const trace = (dir: "in" | "out", payload: unknown) => {
		if (!logStream) return;
		logStream.write(`${JSON.stringify({ ts: new Date().toISOString(), dir, payload })}\n`);
	};
	let session = runtimeHost.session;
	/** Monotonic activation id: changes when the bound session object changes. */
	let activationId = 0;
	let boundSession: typeof session | undefined;
	let cronService: import("../../core/cron/service.ts").CronService | undefined;
	/** Live event subscriptions for detached (background) sessions. */
	const attachments = new Map<string, RpcAttachmentData>();
	const MAX_ATTACHMENTS = 256;

	const registerAttachment = (mimeType: string, data: string, _bytes: number) => {
		const id = crypto.createHash("sha256").update(mimeType).update(data).digest("hex").slice(0, 24);
		const bytes = Buffer.byteLength(data, "base64");
		if (!attachments.has(id)) {
			attachments.set(id, { id, mimeType, data, bytes });
			if (attachments.size > MAX_ATTACHMENTS) {
				const oldest = attachments.keys().next().value;
				if (oldest) attachments.delete(oldest);
			}
		}
		return { id, mimeType, bytes };
	};

	const backgroundSubscriptions = new Map<string, () => void>();
	const backgroundActivations = new Map<string, number>();
	let nextBackgroundActivation = 1_000_000;
	const MAX_BACKGROUND_SUBSCRIPTIONS = 4;

	const stopBackgroundSubscription = (path: string): boolean => {
		const unsubscribe = backgroundSubscriptions.get(path);
		if (!unsubscribe) return false;
		unsubscribe();
		backgroundSubscriptions.delete(path);
		backgroundActivations.delete(path);
		return true;
	};

	const pruneBackgroundSubscriptions = (): void => {
		for (const path of [...backgroundSubscriptions.keys()]) {
			if (!runtimeHost.getSessionForPath(path) || path === session.sessionFile) {
				stopBackgroundSubscription(path);
			}
		}
	};
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;
	/** A reconnect requested while a turn was running; applied at agent_end. */
	let pendingMcpReconnect: string | null | undefined;
	let unsubscribeBackgroundProcesses: (() => void) | undefined;
	let unsubscribeWorkflowRuns: (() => void) | undefined;

	const writeFrame = (frame: Record<string, unknown>) => {
		trace("out", frame);
		writeRawStdout(serializeJsonLine(frame));
	};
	// Session frames are shaped here: sequence numbers, session identity, and
	// (for opted-in clients) compact deltas + batches. Responses and global
	// events bypass batching but flush pending session frames first.
	const eventStream = new RpcSessionEventStream(writeFrame, () => ({
		sessionId: session.sessionId,
		sessionFile: session.sessionFile,
		activationId,
	}));
	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		const frame = obj as Record<string, unknown>;
		if (frame.type === "response") eventStream.pushResponse(frame);
		else eventStream.pushImmediate(frame);
	};

	// Handshake: the first frame identifies the engine and its protocol
	// contract so embedded clients (desktop, mobile bridge) can detect
	// engine/client skew early instead of failing cryptically downstream.
	output({
		type: "engine_info",
		version: VERSION,
		contract: RPC_CONTRACT,
		capabilities: ["delta", "batch", "tool-progress", "attachments"] satisfies RpcCapability[],
	} satisfies RpcEngineInfoEvent);

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (
		id: string | undefined,
		command: string,
		message: string,
		code = "command_failed",
		options?: { retryable?: boolean; details?: Record<string, unknown> },
	): RpcResponse => {
		return {
			id,
			type: "response",
			command,
			success: false,
			error: message,
			code,
			...(options?.retryable !== undefined ? { retryable: options.retryable } : {}),
			...(options?.details ? { details: options.details } : {}),
		};
	};

	// Pending extension UI requests waiting for response
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>();

	// Shutdown request flag
	let shutdownRequested = false;
	let shuttingDown = false;
	const signalCleanupHandlers: Array<() => void> = [];

	/** Helper for dialog methods with signal/timeout support. `sessionFile` is
	 *  the session whose bound UI context opened the dialog — used to flag that
	 *  runtime as waiting for input (surfaced via sessions_update events). */
	function createDialogPromise<T>(
		sessionFile: string | undefined,
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		runtimeHost.markSessionNeedsInput?.(sessionFile, true);
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
				runtimeHost.markSessionNeedsInput?.(sessionFile, false);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
			});
			output({ type: "extension_ui_request", id, sessionFile, ...request } as RpcExtensionUIRequest);
		});
	}

	/**
	 * Create an extension UI context that uses the RPC protocol.
	 */
	/**
	 * Run an OAuth sign-in for one provider in the background, bridging the
	 * provider's login callbacks onto the desktop UI:
	 *
	 *   - browser / device-code info  -> `oauth_login_status` events (desktop opens
	 *     the URL and shows the code inline in the Account settings)
	 *   - onPrompt (paste redirect)   -> existing `input` dialog request
	 *   - onSelect (login method)     -> existing `select` dialog request
	 *   - success                    -> authStorage persists to auth.json, a
	 *     success event tells the desktop to re-read it.
	 *
	 * One login per provider at a time; progress is fire-and-forget stdout so
	 * the command loop never blocks while the browser callback waits.
	 */
	const oauthLoginsInFlight = new Set<string>();

	async function runOAuthLogin(providerId: string): Promise<void> {
		const emitOAuth = (event: {
			providerId: string;
			phase: "started" | "browser" | "device_code" | "progress" | "success" | "error";
			url?: string;
			instructions?: string;
			verificationUri?: string;
			userCode?: string;
			message?: string;
		}) => {
			output({ type: "oauth_login_status", ...event });
		};

		if (oauthLoginsInFlight.has(providerId)) {
			emitOAuth({ providerId, phase: "error", message: "A sign-in for this provider is already in progress." });
			return;
		}
		oauthLoginsInFlight.add(providerId);
		emitOAuth({ providerId, phase: "started" });
		try {
			await runtimeHost.services.authStorage.login(providerId, {
				onAuth: (info) => {
					emitOAuth({ providerId, phase: "browser", url: info.url, instructions: info.instructions });
				},
				onDeviceCode: (info) => {
					emitOAuth({
						providerId,
						phase: "device_code",
						verificationUri: info.verificationUri,
						userCode: info.userCode,
					});
				},
				onPrompt: async (p) => {
					const value = await createDialogPromise<string | undefined>(
						undefined,
						undefined,
						undefined,
						{ method: "input", title: p.message, message: p.message, placeholder: p.placeholder },
						(r) =>
							"cancelled" in r && r.cancelled ? undefined : "value" in r ? String(r.value ?? "") : undefined,
					);
					return value ?? "";
				},
				onProgress: (message) => {
					emitOAuth({ providerId, phase: "progress", message });
				},
				onSelect: async (p) => {
					// The desktop's select dialog resolves with the option label;
					// map it back to the option id the provider expects.
					const labels = p.options.map((o) => o.label);
					const chosen = await createDialogPromise<string | undefined>(
						undefined,
						undefined,
						undefined,
						{ method: "select", title: p.message, options: labels },
						(r) =>
							"cancelled" in r && r.cancelled ? undefined : "value" in r ? String(r.value ?? "") : undefined,
					);
					if (chosen === undefined) return undefined;
					const index = labels.indexOf(chosen);
					return index >= 0 ? p.options[index]?.id : undefined;
				},
				getDeviceId: () => runtimeHost.services.settingsManager.getOrCreateDeviceId(),
			});
			void session.modelRegistry.refresh();
			emitOAuth({ providerId, phase: "success" });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			emitOAuth({ providerId, phase: "error", message });
		} finally {
			oauthLoginsInFlight.delete(providerId);
		}
	}

	const createExtensionUIContext = (sessionFile: string | undefined): ExtensionUIContext => ({
		select: (title, options, opts) =>
			createDialogPromise(
				sessionFile,
				opts,
				undefined,
				{ method: "select", title, options, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
			),

		confirm: (title, message, opts) =>
			createDialogPromise(
				sessionFile,
				opts,
				false,
				{ method: "confirm", title, message, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(
				sessionFile,
				opts,
				undefined,
				{ method: "input", title, placeholder, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
			),

		requestUserQuestion: (payload, opts) =>
			createDialogPromise(
				sessionFile,
				opts,
				undefined,
				{ method: "question", title: "Questions", questions: payload.questions, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? undefined : "answers" in r ? { answers: r.answers } : undefined),
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			} as RpcExtensionUIRequest);
		},

		onTerminalInput(): () => void {
			// Raw terminal input not supported in RPC mode
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcExtensionUIRequest);
		},

		setWorkingMessage(_message?: string): void {
			// Working message not supported in RPC mode - requires TUI loader access
		},

		setWorkingVisible(_visible: boolean): void {
			// Working visibility not supported in RPC mode - requires TUI loader access
		},

		setWorkingIndicator(_options?: WorkingIndicatorOptions): void {
			// Working indicator customization not supported in RPC mode - requires TUI loader access
		},

		setHiddenThinkingLabel(_label?: string): void {
			// Hidden thinking label not supported in RPC mode - requires TUI message rendering access
		},

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in RPC mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				} as RpcExtensionUIRequest);
			}
			// Component factories are not supported in RPC mode - would need TUI access
		},

		setFooter(_factory: unknown): void {
			// Custom footer not supported in RPC mode - requires TUI access
		},

		setHeader(_factory: unknown): void {
			// Custom header not supported in RPC mode - requires TUI access
		},

		setTitle(title: string): void {
			// Fire and forget - host can implement terminal title control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
			} as RpcExtensionUIRequest);
		},

		async custom() {
			// Custom UI not supported in RPC mode
			return undefined as never;
		},

		pasteToEditor(text: string): void {
			// Paste handling not supported in RPC mode - falls back to setEditorText
			this.setEditorText(text);
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			} as RpcExtensionUIRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			runtimeHost.markSessionNeedsInput?.(sessionFile, true);
			return new Promise((resolve) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => {
						runtimeHost.markSessionNeedsInput?.(sessionFile, false);
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject: () => {
						runtimeHost.markSessionNeedsInput?.(sessionFile, false);
						resolve(undefined);
					},
				});
				output({
					type: "extension_ui_request",
					id,
					sessionFile,
					method: "editor",
					title,
					prefill,
				} as RpcExtensionUIRequest);
			});
		},

		addAutocompleteProvider(): void {
			// Autocomplete provider composition is not supported in RPC mode
		},

		setEditorComponent(): void {
			// Custom editor components not supported in RPC mode
		},

		getEditorComponent() {
			// Custom editor components not supported in RPC mode
			return undefined;
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | Theme) {
			// Theme switching not supported in RPC mode
			return { success: false, error: "Theme switching not supported in RPC mode" };
		},

		getToolsExpanded() {
			// Tool expansion not supported in RPC mode - no TUI
			return false;
		},

		setToolsExpanded(_expanded: boolean) {
			// Tool expansion not supported in RPC mode - no TUI
		},
	});

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		if (boundSession !== session) {
			boundSession = session;
			activationId++;
		}
		const boundSessionFile = session.sessionFile;
		// The active session's events flow through the main subscription; drop a
		// background subscription for the same file to avoid duplicate frames.
		if (boundSessionFile) stopBackgroundSubscription(boundSessionFile);
		await session.bindExtensions({
			uiContext: createExtensionUIContext(boundSessionFile),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (options) => runtimeHost.newSession({ ...options, discardPrevious: true }),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => {
					return runtimeHost.switchSession(sessionPath, { ...options, discardPrevious: true });
				},
				reload: async () => {
					await session.reload();
				},
			},
			shutdownHandler: () => {
				shutdownRequested = true;
			},
			permissionPromptHandler: async (toolName, reason, args) => {
				const id = crypto.randomUUID();
				runtimeHost.markSessionNeedsInput?.(boundSessionFile, true);
				// Workflow detail for the desktop's run_workflow approval card: the
				// workflow name and its meta-declared phases.
				let workflow: { name: string; phases: string[] } | undefined;
				if (toolName === "run_workflow" && typeof args?.workflow === "string") {
					const name = args.workflow;
					const { workflow: spec } = findWorkflow(name, {
						cwd: session.sessionManager.getCwd(),
						agentDir: runtimeHost.services.agentDir,
					});
					if (spec) {
						workflow = { name: spec.name, phases: spec.phases ?? [] };
					}
				}
				return new Promise<boolean>((resolve) => {
					pendingExtensionRequests.set(id, {
						resolve: (response: RpcExtensionUIResponse) => {
							runtimeHost.markSessionNeedsInput?.(boundSessionFile, false);
							if ("cancelled" in response && response.cancelled) {
								resolve(false);
							} else if ("confirmed" in response) {
								resolve(response.confirmed);
							} else {
								resolve(false);
							}
						},
						reject: () => {
							runtimeHost.markSessionNeedsInput?.(boundSessionFile, false);
							resolve(false);
						},
					});
					output({
						type: "extension_ui_request",
						id,
						method: "confirm",
						title: `Allow ${toolName}?`,
						message: reason ?? `Permission required for "${toolName}"`,
						kind: "permission",
						toolName,
						...(workflow !== undefined ? { workflow } : {}),
						sessionFile: boundSessionFile,
					} as RpcExtensionUIRequest);
				});
			},
			onError: (err) => {
				output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
			},
		});

		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribeBackgroundProcesses?.();
		unsubscribe = session.subscribe((event) => {
			eventStream.push(event as unknown as Record<string, unknown>);
			// Push stats at natural boundaries instead of making every client poll.
			if (
				(event.type === "agent_end" && event.willRetry !== true) ||
				(event.type === "compaction_end" && event.willRetry !== true)
			) {
				eventStream.pushImmediate({
					type: "session_stats",
					stats: session.getSessionStats(),
				} satisfies RpcSessionStatsEvent);
			}
			// Session events double as cron event triggers: a finished turn
			// (natural end, not a retry-in-progress) may fire `on:turn-end` jobs
			// for this project. CronService coalesces via cooldowns.
			if (event.type === "agent_end" && event.willRetry !== true) {
				cronService?.notifyEvent({ type: "turn_end", cwd: session.sessionManager.getCwd() });
				if (pendingMcpReconnect !== undefined) {
					const requested = pendingMcpReconnect;
					pendingMcpReconnect = undefined;
					void reconnectMcpServer(requested ?? undefined).catch(() => {});
				}
			}
		});
		unsubscribeBackpressure = session.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
		// Stream background bash-process updates to the desktop (live viewer).
		unsubscribeBackgroundProcesses = subscribeBackgroundProcesses(() => {
			output({ type: "background_processes_update", processes: getBackgroundProcesses() });
		});
		// Emit an initial snapshot so the desktop has the current state on (re)bind.
		output({ type: "background_processes_update", processes: getBackgroundProcesses() });
		// Stream workflow run summaries (live per-run status for the desktop's
		// Running tasks panel).
		unsubscribeWorkflowRuns = subscribeWorkflowRuns(() => {
			output({ type: "workflows_update", runs: getWorkflowRunSummaries() });
		});
		output({ type: "workflows_update", runs: getWorkflowRunSummaries() });
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	await rebindSession();
	// Push runtime-registry changes (background sessions detaching, turns
	// finishing while detached, reaping) so the client can badge session tabs.
	runtimeHost.subscribeRuntimes?.(() => {
		pruneBackgroundSubscriptions();
		output({ type: "sessions_update", sessions: runtimeHost.getSessionsStatus?.() ?? [] });
	});
	output({ type: "sessions_update", sessions: runtimeHost.getSessionsStatus?.() ?? [] });
	registerSignalHandlers();

	// Your Office — coworker sessions, huddles, errands. Events ride the same
	// stdout stream; prompts route back through `office_respond`.
	const office = new OfficeService({
		runtime: runtimeHost,
		sink: {
			update: (snapshot) => {
				output({ type: "office_update", snapshot } satisfies RpcOfficeUpdateEvent);
			},
			huddle: (payload) => {
				output({ type: "office_huddle", payload } satisfies RpcOfficeHuddleEvent);
			},
			delta: (delta) => {
				output({ type: "office_huddle_delta", delta } satisfies RpcOfficeHuddleDeltaEvent);
			},
			activity: (activity) => {
				output({ type: "office_activity", activity } satisfies RpcOfficeActivityEvent);
			},
			prompt: () => {},
		},
	});
	office.start();
	signalCleanupHandlers.push(() => {
		void office.dispose();
	});
	void office
		.snapshot()
		.then((snapshot) => {
			output({ type: "office_update", snapshot } satisfies RpcOfficeUpdateEvent);
		})
		.catch(() => {});

	// Cron — scheduled tasks for the main agent. Fires due jobs into the
	// active session (project match) or a continuity side session; snapshots
	// ride the same stdout stream.
	const cron = new CronService({
		runtime: runtimeHost,
		onUpdate: (snapshot) => {
			output({ type: "cron_update", jobs: snapshot.jobs } satisfies RpcCronUpdateEvent);
		},
		onRunEvent: (event) => {
			output({
				type: "cron_run",
				event: event.type === "run_started" ? "started" : "finished",
				run: event.run,
			} satisfies RpcCronRunEvent);
		},
	});
	cronService = cron;
	runtimeHost.setScheduleService?.(cron);
	cron.start();
	signalCleanupHandlers.push(() => {
		runtimeHost.setScheduleService?.(undefined);
		void cron.dispose();
	});
	void cron
		.snapshot()
		.then((snapshot) => {
			output({ type: "cron_update", jobs: snapshot.jobs } satisfies RpcCronUpdateEvent);
		})
		.catch(() => {});

	// Pre-fetch dynamic (Ollama Cloud) models in the background so the model
	// picker is populated by the time the user opens it, without blocking startup.
	void session.modelRegistry.refreshDynamicModels().catch(() => {});

	// Handle a single command
	const currentSessionState = (): RpcSessionState => ({
		model: session.model,
		thinkingLevel: session.thinkingLevel,
		permissionMode: session.permissionMode,
		planMode: session.planMode,
		isStreaming: session.isStreaming,
		isCompacting: session.isCompacting,
		steeringMode: session.steeringMode,
		followUpMode: session.followUpMode,
		cwd: session.sessionManager.getCwd(),
		sessionFile: session.sessionFile,
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		activationId,
		autoCompactionEnabled: session.autoCompactionEnabled,
		compactionAutoContinue: session.compactionAutoContinue,
		messageCount: session.messages.length,
		pendingMessageCount: session.pendingMessageCount,
	});

	const handleCommand = async (command: RpcCommand): Promise<RpcResponse | undefined> => {
		const id = command.id;

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				// Session-scoped routing: a sessionPath targets a background
				// (detached) session; omitted means the active session.
				const target = runtimeHost.getSessionForPath(command.sessionPath);
				if (!target) {
					return error(id, "prompt", `Unknown session: ${command.sessionPath}`);
				}
				// Start prompt handling immediately, but emit the authoritative response only after
				// prompt preflight succeeds. Queued and immediately handled prompts also count as success.
				let preflightSucceeded = false;
				// Voice turns bind the auxiliary voice model for this turn only:
				// speech is latency-sensitive, typed turns and background work
				// keep the user's model. Unknown/unconfigured ids are ignored by
				// bindTurnModel (the turn simply runs on the current model).
				let unbindTurnModel: (() => void) | undefined;
				if (command.voiceTurn) {
					const configured = target.settingsManager.getVoiceTurnModel();
					const slash = configured?.indexOf("/") ?? -1;
					if (configured && slash > 0) {
						unbindTurnModel = target.bindTurnModel(configured.slice(0, slash), configured.slice(slash + 1));
					}
				}
				void target
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
						preflightResult: (didSucceed) => {
							if (didSucceed) {
								preflightSucceeded = true;
								output(success(id, "prompt"));
							}
						},
					})
					.catch((e) => {
						if (!preflightSucceeded) {
							output(error(id, "prompt", e.message));
						}
					})
					.finally(() => {
						unbindTurnModel?.();
					});
				return undefined;
			}

			case "steer": {
				const target = runtimeHost.getSessionForPath(command.sessionPath);
				if (!target) {
					return error(id, "steer", `Unknown session: ${command.sessionPath}`);
				}
				await target.steer(command.message, command.images, { source: "rpc" });
				return success(id, "steer");
			}

			case "follow_up": {
				const target = runtimeHost.getSessionForPath(command.sessionPath);
				if (!target) {
					return error(id, "follow_up", `Unknown session: ${command.sessionPath}`);
				}
				await target.followUp(command.message, command.images, { source: "rpc" });
				return success(id, "follow_up");
			}

			case "abort": {
				const target = runtimeHost.getSessionForPath(command.sessionPath);
				if (!target) {
					return error(id, "abort", `Unknown session: ${command.sessionPath}`);
				}
				await target.abort();
				return success(id, "abort");
			}

			case "clear_queue": {
				const target = runtimeHost.getSessionForPath(command.sessionPath);
				if (!target) {
					return error(id, "clear_queue", `Unknown session: ${command.sessionPath}`);
				}
				return success(id, "clear_queue", target.clearQueue());
			}

			case "queue_remove": {
				const target = runtimeHost.getSessionForPath(command.sessionPath);
				if (!target) {
					return error(id, "queue_remove", `Unknown session: ${command.sessionPath}`);
				}
				return success(id, "queue_remove", {
					removed: target.removeQueuedMessage(command.kind, command.index),
				});
			}

			case "stop_workflow_run": {
				return success(id, "stop_workflow_run", { stopped: stopWorkflowRun(command.runId) });
			}

			case "kill_subagent": {
				const record = session.killSubAgent(command.subagentId, "user");
				if (!record) {
					return error(id, "kill_subagent", `Unknown sub-agent: ${command.subagentId}`);
				}
				return success(id, "kill_subagent", { subagent: record });
			}

			case "rerun_subagent": {
				const record = session.listSubAgents().find((r) => r.id === command.subagentId);
				if (!record) {
					return error(id, "rerun_subagent", `Unknown sub-agent: ${command.subagentId}`);
				}
				if (record.status === "running") {
					return error(id, "rerun_subagent", "Sub-agent is still running. Stop it before rerunning.");
				}
				const prompt = record.prompt ?? record.goal;
				if (!prompt) {
					return error(id, "rerun_subagent", "No prompt recorded for this sub-agent.");
				}
				const model = record.model
					? record.modelProvider
						? session.modelRegistry.find(record.modelProvider, record.model)
						: session.modelRegistry.getAll().find((m) => m.id === record.model)
					: undefined;
				const rerunId = `${record.agentType}-rerun-${Date.now().toString(36)}`;
				session.runSubAgentBackground({
					id: rerunId,
					agentType: record.agentType,
					prompt,
					model,
					detached: true,
					isolation: record.isolation,
					name: record.teammateName,
					teamName: record.teamName,
				});
				return success(id, "rerun_subagent", { id: rerunId });
			}

			case "new_session": {
				const options = {
					parentSession: command.parentSession,
					cwd: command.cwd,
				};
				const result = await runtimeHost.newSession(options.parentSession || options.cwd ? options : undefined);
				if (!result.cancelled) {
					await rebindSession();
					if (session.sessionFile) {
						output({
							type: "session_changed",
							event: "created",
							sessionPath: session.sessionFile,
							name: session.sessionName,
						});
					}
				}
				return success(id, "new_session", { ...result, activationId });
			}

			case "clear_conversation": {
				const result = await runtimeHost.clearConversation();
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "clear_conversation", result);
			}

			// =================================================================
			// State
			// =================================================================

			case "client_info": {
				const allowed: RpcCapability[] = ["delta", "batch", "tool-progress", "attachments"];
				const capabilities = (command.capabilities ?? []).filter((capability): capability is RpcCapability =>
					allowed.includes(capability),
				);
				eventStream.setCapabilities(capabilities);
				return success(id, "client_info", { contract: RPC_CONTRACT, capabilities });
			}

			case "get_state": {
				return success(id, "get_state", currentSessionState());
			}

			case "get_session_snapshot": {
				// One round trip for activation: state + stats (context usage) together.
				return success(id, "get_session_snapshot", {
					state: currentSessionState(),
					stats: session.getSessionStats(),
				});
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = session.modelRegistry.getAvailable();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				// Non-blocking: return the cached list immediately so the picker never
				// waits on a fetch. A background refresh keeps the catalog warm; the
				// desktop picker additionally fires the forced refresh_models command
				// on open and updates its list when it settles. The explicit
				// refresh_models command does a forced fetch.
				void session.modelRegistry.refreshDynamicModels().catch(() => {});
				const models = session.modelRegistry.getAvailable();
				return success(id, "get_available_models", { models });
			}

			case "refresh_models": {
				session.modelRegistry.refresh();
				const refreshError = await session.modelRegistry.refreshDynamicModels(true);
				if (refreshError) {
					return error(id, "refresh_models", refreshError);
				}
				return success(id, "refresh_models");
			}

			case "get_llama_cpp_status": {
				return success(id, "get_llama_cpp_status", await session.getLlamaCppStatus(false));
			}

			case "get_decision_models": {
				const models = await session.listDecisionModels();
				return success(id, "get_decision_models", {
					models,
					autoContinue: session.getAutoContinueSettings(),
				});
			}

			case "get_auto_continue_settings": {
				return success(id, "get_auto_continue_settings", session.getAutoContinueSettings());
			}

			case "set_auto_continue_settings": {
				if (!command.settings || typeof command.settings !== "object") {
					return error(id, "set_auto_continue_settings", "settings must be an object");
				}
				const mode = command.settings.mode;
				if (mode !== undefined && mode !== "off" && mode !== "compaction" && mode !== "smart") {
					return error(id, "set_auto_continue_settings", `Unknown auto-continue mode: ${String(mode)}`);
				}
				session.setAutoContinueSettings(command.settings);
				return success(id, "set_auto_continue_settings");
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "set_system_prompt_addendum": {
				session.setSystemPromptAddendum(command.addendum ?? null);
				return success(id, "set_system_prompt_addendum");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			// =================================================================
			// Permission mode
			// =================================================================

			case "set_permission_mode": {
				const mode = command.mode;
				if (!["ask", "allow", "read-only", "auto"].includes(mode)) {
					return error(id, "set_permission_mode", `Invalid permission mode: ${mode}`);
				}
				session.setPermissionMode(mode);
				return success(id, "set_permission_mode");
			}

			case "get_permission_mode": {
				return success(id, "get_permission_mode", { mode: session.permissionMode });
			}

			case "add_session_allow_rules": {
				const rules = command.rules.filter((rule) => typeof rule === "string" && rule.trim().length > 0);
				if (rules.length === 0) {
					return error(id, "add_session_allow_rules", "No valid rules provided");
				}
				session.addSessionAllowRules(rules);
				return success(id, "add_session_allow_rules");
			}

			case "set_plan_mode": {
				session.setPlanMode(command.enabled);
				return success(id, "set_plan_mode");
			}

			case "get_plan_mode": {
				return success(id, "get_plan_mode", { enabled: session.planMode });
			}

			// =================================================================
			// Auth
			// =================================================================

			case "reload_auth": {
				runtimeHost.services.authStorage.reload();
				return success(id, "reload_auth");
			}

			case "oauth_login": {
				const providerId = String(command.providerId ?? "");
				if (!getOAuthProvider(providerId)) {
					return error(id, "oauth_login", `Unknown OAuth provider: ${providerId}`);
				}
				void runOAuthLogin(providerId);
				return success(id, "oauth_login", { started: true });
			}

			case "mcp_status": {
				return success(id, "mcp_status", { servers: getMcpServerStates() });
			}

			case "mcp_reconnect": {
				const name = typeof command.name === "string" && command.name.trim() ? command.name.trim() : undefined;
				if (session.isStreaming) {
					// Never yank a server out from under the tool call that is using it.
					// Remember the request and apply it at the next natural turn end.
					pendingMcpReconnect = name ?? null;
					return success(id, "mcp_reconnect", { ok: true, deferred: true, name });
				}
				const result = await reconnectMcpServer(name);
				return success(id, "mcp_reconnect", { ...result, deferred: false, name });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			case "set_compaction_auto_continue": {
				session.setCompactionAutoContinue(command.enabled);
				return success(id, "set_compaction_auto_continue");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const result = await session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext,
				});
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "export_jsonl": {
				const path = session.exportToJsonl(command.outputPath);
				return success(id, "export_jsonl", { path });
			}

			case "import_jsonl": {
				const result = await runtimeHost.importFromJsonl(command.inputPath);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "import_jsonl", result);
			}

			case "switch_session": {
				// `cwd` overrides the session's stored working directory, mirroring
				// the TUI's missing-cwd prompt ("continue in current cwd"): the
				// desktop passes the current workspace when the stored folder is
				// gone instead of leaving the user stuck on an error toast.
				const result = await runtimeHost.switchSession(
					command.sessionPath,
					command.cwd ? { cwdOverride: command.cwd } : undefined,
				);
				if (!result.cancelled) {
					await rebindSession();
				}
				// Authoritative session identity in the response: clients that adopt
				// it immediately (tab labels, workspace indicator) stay correct even
				// when the session_start event races the optimistic UI update.
				return success(
					id,
					"switch_session",
					result.cancelled
						? result
						: {
								...result,
								sessionFile: session.sessionFile,
								sessionId: session.sessionId,
								sessionName: session.sessionName,
								cwd: session.sessionManager.getCwd(),
								activationId,
							},
				);
			}

			case "get_sessions_status": {
				return success(id, "get_sessions_status", { sessions: runtimeHost.getSessionsStatus?.() ?? [] });
			}

			case "abort_session": {
				const found = await runtimeHost.abortSession(command.sessionPath);
				return success(id, "abort_session", { found });
			}

			case "subscribe_session": {
				const target = runtimeHost.getSessionForPath(command.sessionPath);
				if (!target) {
					return error(id, "subscribe_session", `Unknown session: ${command.sessionPath}`, "unknown_session");
				}
				if (target === session) {
					return success(id, "subscribe_session", { subscribed: false, active: true });
				}
				if (backgroundSubscriptions.has(command.sessionPath)) {
					return success(id, "subscribe_session", {
						subscribed: true,
						sessionFile: command.sessionPath,
						sessionId: target.sessionId,
						activationId: backgroundActivations.get(command.sessionPath),
					});
				}
				if (backgroundSubscriptions.size >= MAX_BACKGROUND_SUBSCRIPTIONS) {
					return error(
						id,
						"subscribe_session",
						`Too many background subscriptions (max ${MAX_BACKGROUND_SUBSCRIPTIONS})`,
						"subscription_limit",
					);
				}
				let activationId = backgroundActivations.get(command.sessionPath);
				if (activationId === undefined) {
					activationId = ++nextBackgroundActivation;
					backgroundActivations.set(command.sessionPath, activationId);
				}
				const info = {
					sessionId: target.sessionId,
					sessionFile: command.sessionPath,
					activationId,
				};
				const unsubscribe = target.subscribe((event) => {
					eventStream.push(event as unknown as Record<string, unknown>, info);
				});
				backgroundSubscriptions.set(command.sessionPath, unsubscribe);
				return success(id, "subscribe_session", {
					subscribed: true,
					sessionFile: command.sessionPath,
					sessionId: target.sessionId,
					activationId,
				});
			}

			case "unsubscribe_session": {
				return success(id, "unsubscribe_session", {
					unsubscribed: stopBackgroundSubscription(command.sessionPath),
				});
			}

			case "fork": {
				const result = await runtimeHost.fork(command.entryId);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled, activationId });
			}

			case "clone": {
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) {
					return error(id, "clone", "Cannot clone session: no current entry selected");
				}
				const result = await runtimeHost.fork(leafId, { position: "at" });
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "clone", { cancelled: result.cancelled, activationId });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return success(id, "get_fork_messages", { messages });
			}

			case "get_entries": {
				const sessionManager = session.sessionManager;
				let entries = sessionManager.getEntries();
				if (command.since !== undefined) {
					const sinceIndex = entries.findIndex((e) => e.id === command.since);
					if (sinceIndex === -1) {
						return error(id, "get_entries", `Entry not found: ${command.since}`);
					}
					entries = entries.slice(sinceIndex + 1);
				}
				return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
			}

			case "get_tree": {
				const sessionManager = session.sessionManager;
				const fullTree = sessionManager.getTree();
				// Strip full message bodies from the tree. The desktop only needs the
				// entry id, the message role, the label, and the parent/child structure.
				// Returning full AgentMessages made get_tree ~13MB for large sessions,
				// which stalled or lost the response over the IPC pipe.
				const strip = (nodes: typeof fullTree): unknown[] =>
					nodes.map((n) => {
						const entry: Record<string, unknown> = {
							id: n.entry.id,
							type: n.entry.type,
							parentId: n.entry.parentId,
							timestamp: n.entry.timestamp,
						};
						if (n.entry.type === "message") {
							entry.message = { role: n.entry.message.role };
						}
						return {
							entry,
							children: strip(n.children),
							label: n.label,
							labelTimestamp: n.labelTimestamp,
						};
					});
				if (command.flat) {
					return success(id, "get_tree", {
						nodes: flattenSessionTree(fullTree),
						leafId: sessionManager.getLeafId(),
						version: sessionManager.getEntries().length,
					});
				}
				return success(id, "get_tree", { tree: strip(fullTree), leafId: sessionManager.getLeafId() });
			}

			case "list_sessions": {
				const sessions = (await SessionManager.listAll()).sort(
					(a, b) => b.modified.getTime() - a.modified.getTime(),
				);
				const limited =
					typeof command.limit === "number" && command.limit > 0
						? sessions.slice(0, Math.min(command.limit, 500))
						: sessions;
				return success(id, "list_sessions", {
					sessions: limited.map((s: SessionInfo) => ({
						path: s.path,
						id: s.id,
						cwd: s.cwd,
						name: s.name,
						parentSessionPath: s.parentSessionPath,
						created: s.created.toISOString(),
						modified: s.modified.toISOString(),
						messageCount: s.messageCount,
						firstMessage: s.firstMessage,
						model: s.model,
						totalTokens: s.totalTokens,
						totalCost: s.totalCost,
					})),
				});
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				if (command.sessionPath && runtimeHost.getSessionForPath(command.sessionPath) === undefined) {
					return error(id, "set_session_name", `Unknown session: ${command.sessionPath}`);
				}
				const targetSession = runtimeHost.getSessionForPath(command.sessionPath) ?? session;
				targetSession.setSessionName(name);
				return success(id, "set_session_name");
			}

			case "rename_session": {
				// Rename any stored session, including one with no live runtime:
				// open its file and append the session_info entry, exactly what
				// AgentSession.setSessionName does for the active session.
				const name = command.name.replace(/[\r\n]+/g, " ").trim();
				if (!name) {
					return error(id, "rename_session", "Session name cannot be empty");
				}
				const live = runtimeHost.getSessionForPath(command.sessionPath);
				if (live) {
					live.setSessionName(name);
					output({ type: "session_changed", event: "updated", sessionPath: command.sessionPath, name });
					return success(id, "rename_session");
				}
				if (!existsSync(command.sessionPath)) {
					return error(id, "rename_session", `Unknown session: ${command.sessionPath}`);
				}
				try {
					SessionManager.open(command.sessionPath).appendSessionInfo(name);
				} catch (e) {
					return error(id, "rename_session", e instanceof Error ? e.message : String(e));
				}
				output({ type: "session_changed", event: "updated", sessionPath: command.sessionPath, name });
				return success(id, "rename_session");
			}

			case "delete_session": {
				// Delete moves the file into the sessions dir's .trash folder:
				// recoverable, never touches live runtimes, and refuses paths
				// outside the store so the RPC cannot unlink arbitrary files.
				if (runtimeHost.getSessionForPath(command.sessionPath)) {
					return error(id, "delete_session", "Cannot delete the active session or one with a running turn");
				}
				if (!existsSync(resolve(command.sessionPath))) {
					return error(id, "delete_session", `Unknown session: ${command.sessionPath}`);
				}
				try {
					const { trashPath } = archiveSessionFile(command.sessionPath);
					return success(id, "delete_session", { trashPath });
				} catch (e) {
					return error(id, "delete_session", e instanceof Error ? e.message : String(e));
				}
			}

			case "set_entry_label": {
				try {
					const sessionManager = session.sessionManager;
					const labelEntryId = sessionManager.appendLabelChange(command.entryId, command.label);
					const labelEntry = sessionManager.getEntry(labelEntryId);
					const target = sessionManager.getEntry(command.entryId);
					if (labelEntry) {
						eventStream.push({
							type: "tree_delta",
							version: sessionManager.getEntryCount(),
							leafId: sessionManager.getLeafId(),
							added: [
								{
									id: labelEntry.id,
									parentId: labelEntry.parentId,
									type: labelEntry.type,
									timestamp: labelEntry.timestamp,
								},
							],
							updated: target
								? [
										{
											id: target.id,
											parentId: target.parentId,
											type: target.type,
											messageRole: target.type === "message" ? target.message.role : undefined,
											timestamp: target.timestamp,
											label: command.label,
										},
									]
								: undefined,
						});
					}
					return success(id, "set_entry_label");
				} catch (e) {
					return error(id, "set_entry_label", e instanceof Error ? e.message : String(e));
				}
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				const target = command.sessionPath ? runtimeHost.getSessionForPath(command.sessionPath) : session;
				if (!target) {
					return error(id, "get_messages", `Unknown session: ${command.sessionPath}`, "unknown_session");
				}
				const page = pageMessages(target.messages, { limit: command.limit, before: command.before });
				if (eventStream.has("attachments")) {
					return success(id, "get_messages", {
						...page,
						messages: externalizeAttachments(page.messages, registerAttachment),
					});
				}
				return success(id, "get_messages", page);
			}

			case "get_transcript_page": {
				const target = command.sessionPath ? runtimeHost.getSessionForPath(command.sessionPath) : session;
				if (!target) {
					return error(id, "get_transcript_page", `Unknown session: ${command.sessionPath}`, "unknown_session");
				}
				const page = pageTranscriptEntries(toTranscriptEntries(target.sessionManager.getTranscriptEntries()), {
					limit: command.limit,
					before: command.before,
				});
				if (eventStream.has("attachments")) {
					page.entries = externalizeAttachments(page.entries, registerAttachment) as typeof page.entries;
				}
				return success(id, "get_transcript_page", page);
			}

			case "get_attachment": {
				const attachment = attachments.get(command.attachmentId);
				if (!attachment) {
					return error(id, "get_attachment", `Unknown attachment: ${command.attachmentId}`, "unknown_attachment");
				}
				return success(id, "get_attachment", attachment);
			}

			// =================================================================
			// File history
			// =================================================================

			case "rewind": {
				const fileHistory = session.fileHistory;
				if (!fileHistory.isEnabled()) {
					return error(id, "rewind", "File history is disabled. Nothing to rewind.");
				}
				const total = fileHistory.snapshotCount();
				if (total === 0) {
					return error(id, "rewind", "No file-history snapshots yet — make an edit first.");
				}
				const steps = command.steps ?? 1;
				if (!Number.isInteger(steps) || steps < 1) {
					return error(id, "rewind", `Invalid step count: ${steps}. Usage: /rewind [n] where n ≥ 1.`);
				}
				const target = fileHistory.getSnapshotByOffset(steps);
				if (!target) {
					return error(id, "rewind", `Cannot rewind ${steps} step(s): only ${total} snapshot(s) available.`);
				}
				try {
					const stats = await fileHistory.getDiffStats(target.messageId);
					const changed = await fileHistory.rewind(target.messageId);
					return success(id, "rewind", {
						steps,
						filesChanged: changed,
						insertions: stats.insertions,
						deletions: stats.deletions,
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return error(id, "rewind", `Rewind failed: ${msg}`);
				}
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				for (const command of session.extensionRunner.getRegisteredCommands()) {
					commands.push({
						name: command.invocationName,
						description: command.description,
						source: "extension",
						sourceInfo: command.sourceInfo,
					});
				}

				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						sourceInfo: template.sourceInfo,
					});
				}

				for (const skill of session.resourceLoader.getSkills().skills) {
					commands.push({
						name: `skill:${skill.name}`,
						description: skill.description,
						source: "skill",
						sourceInfo: skill.sourceInfo,
					});
				}

				return success(id, "get_commands", { commands });
			}

			default: {
				const officeResponse = await handleOfficeCommand(command, id);
				if (officeResponse !== undefined) {
					return officeResponse;
				}
				const unknownCommand = command as { type: string };
				return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`, "unknown_command");
			}
		}
	};

	/** Your Office command surface. Returns undefined for non-office commands. */
	const handleOfficeCommand = async (
		command: RpcCommand,
		id: string | undefined,
	): Promise<RpcResponse | undefined> => {
		switch (command.type) {
			case "office_list":
				return success(id, "office_list", await office.snapshot());
			case "office_coworker_save": {
				const input = command.coworker;
				const coworker = input.id
					? await office.updateCoworker(input.id, input)
					: await office.createCoworker(input);
				if (!coworker) return error(id, command.type, "Coworker not found");
				return success(id, "office_coworker_save", { coworker });
			}
			case "office_coworker_details": {
				const snapshot = await office.snapshot();
				const coworker = snapshot.coworkers.find((entry) => entry.id === command.coworkerId);
				if (!coworker) return error(id, command.type, "Coworker not found", "unknown_coworker");
				const sessions = Object.entries(coworker.sessions)
					.filter(([, sessionPath]) => existsSync(sessionPath))
					.map(([cwd, sessionPath]) => {
						try {
							const manager = SessionManager.open(sessionPath);
							return summarizeCoworkerSession(manager.getTranscriptEntries(), sessionPath, cwd);
						} catch {
							return null;
						}
					})
					.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
					.sort((a, b) => b.lastActivity - a.lastActivity);
				const totals = sessions.reduce(
					(acc, entry) => ({
						sessions: acc.sessions + 1,
						turns: acc.turns + entry.turns,
						tokens: acc.tokens + entry.tokens,
						lastActivity: Math.max(acc.lastActivity, entry.lastActivity),
					}),
					{ sessions: 0, turns: 0, tokens: 0, lastActivity: 0 },
				);
				return success(id, command.type, {
					coworkerId: coworker.id,
					name: coworker.name,
					handle: coworker.handle,
					sessions,
					totals,
				});
			}
			case "office_coworker_delete": {
				await office.deleteCoworker(command.coworkerId);
				return success(id, "office_coworker_delete");
			}
			case "office_huddle_save": {
				const input = command.huddle;
				let huddleId: string;
				if (input.id) {
					await office.updateHuddle(input.id, input.name, input.members);
					huddleId = input.id;
				} else {
					const huddle = await office.createHuddle(input.name, input.members);
					huddleId = huddle.id;
				}
				return success(id, "office_huddle_save", { huddleId });
			}
			case "office_huddle_delete": {
				await office.deleteHuddle(command.huddleId);
				return success(id, "office_huddle_delete");
			}
			case "office_send": {
				const images = (command.images ?? []).map((attachment) => ({
					name: attachment.name,
					kind: attachment.kind,
					data: attachment.dataUrl,
				}));
				const message = await office.sendToHuddle(command.huddleId, command.text, images);
				return success(id, "office_send", { huddleId: command.huddleId, messageId: message.id });
			}
			case "office_huddle_get":
				return success(id, "office_huddle_get", await office.getHuddle(command.huddleId));
			case "office_stop": {
				await office.stopHuddle(command.huddleId);
				return success(id, "office_stop");
			}
			case "office_respond": {
				const handled = await office.respondPrompt(command.requestId, command.choice);
				return success(id, "office_respond", { handled });
			}
			case "office_errand_save": {
				const input = command.errand;
				let errand: Errand | undefined;
				if (input.id) {
					await office.updateErrand(input.id, input);
					const errands = await office.snapshot();
					errand = errands.errands.find((e) => e.id === input.id);
					if (!errand) return error(id, command.type, "Errand not found");
				} else {
					errand = await office.createErrand({
						coworkerId: input.coworkerId,
						name: input.name,
						prompt: input.prompt,
						schedule: input.schedule,
						continuity: input.continuity,
						delivery: input.delivery,
						huddleId: input.huddleId,
					});
				}
				return success(id, "office_errand_save", { errand });
			}
			case "office_errand_delete": {
				await office.deleteErrand(command.errandId);
				return success(id, "office_errand_delete");
			}
			case "office_errand_run": {
				await office.runErrandNow(command.errandId);
				return success(id, "office_errand_run");
			}

			// =================================================================
			// Cron (scheduled tasks for the main agent)
			// =================================================================

			case "cron_list":
				return success(id, "cron_list", await cron.snapshot());

			case "cron_create": {
				const job = await cron.create(command.job);
				return success(id, "cron_create", { job });
			}

			case "cron_update": {
				const job = await cron.update(command.jobId, command.patch);
				return success(id, "cron_update", { job });
			}

			case "cron_delete": {
				await cron.remove(command.jobId);
				return success(id, "cron_delete");
			}

			case "cron_run_now": {
				await cron.runNow(command.jobId, command.variables);
				return success(id, "cron_run_now");
			}

			case "cron_runs": {
				const runs = await cron.listRuns(command.jobId);
				return success(id, "cron_runs", { runs });
			}

			case "cron_revisions": {
				const revisions = await cron.listRevisions(command.jobId);
				return success(id, "cron_revisions", { revisions });
			}

			case "cron_restore_revision": {
				const job = await cron.restoreRevision(command.jobId, command.revisionId);
				return success(id, "cron_restore_revision", { job });
			}
			default:
				return undefined;
		}
	};

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 * Called after handling each command when waiting for the next command.
	 */
	let detachInput = () => {};

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribeBackgroundProcesses?.();
		unsubscribeWorkflowRuns?.();
		for (const path of [...backgroundSubscriptions.keys()]) stopBackgroundSubscription(path);
		eventStream.dispose();
		await office.dispose();
		await runtimeHost.dispose();
		await captureCliSessionEnd(runtimeHost.session, runtimeHost.services.settingsManager).catch(() => undefined);
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	async function checkShutdownRequested(): Promise<void> {
		if (!shutdownRequested) return;
		await shutdown();
	}

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
			trace("in", parsed);
		} catch (parseError: unknown) {
			trace("in", {
				parseError: parseError instanceof Error ? parseError.message : String(parseError),
				raw: line.slice(0, 4000),
			});
			output(
				error(
					undefined,
					"parse",
					`Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
					"parse_error",
				),
			);
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "extension_ui_response"
		) {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) {
				pendingExtensionRequests.delete(response.id);
				pending.resolve(response);
			}
			return;
		}

		const command = parsed as RpcCommand;
		try {
			const response = await handleCommand(command);
			if (response) {
				output(response);
				await waitForRawStdoutBackpressure();
			}
			await checkShutdownRequested();
		} catch (commandError: unknown) {
			const message = commandError instanceof Error ? commandError.message : String(commandError);
			const missingCwd = message.includes("Stored session working directory does not exist");
			output(
				error(
					command.id,
					command.type,
					message,
					missingCwd ? "missing_session_cwd" : "command_failed",
					missingCwd ? { retryable: true } : undefined,
				),
			);
			await waitForRawStdoutBackpressure();
		}
	};

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
			void handleInputLine(line);
		});
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	// Keep process alive forever
	return new Promise(() => {});
}

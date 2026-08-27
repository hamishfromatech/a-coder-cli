import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { resolvePath } from "../utils/paths.ts";
import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionRuntimeDiagnostic, AgentSessionServices } from "./agent-session-services.ts";
import type {
	ProjectTrustContext,
	ReplacedSessionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";
import type { CreateAgentSessionResult } from "./sdk.ts";
import { assertSessionCwdExists } from "./session-cwd.ts";
import { getDefaultSessionDir, SessionManager } from "./session-manager.ts";

/**
 * Result returned by runtime creation.
 *
 * The caller gets the created session, its cwd-bound services, and all
 * diagnostics collected during setup.
 */
export interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
	services: AgentSessionServices;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}

/**
 * Creates a full runtime for a target cwd and session manager.
 *
 * The factory closes over process-global fixed inputs, recreates cwd-bound
 * services for the effective cwd, resolves session options against those
 * services, and finally creates the AgentSession.
 */
export type CreateAgentSessionRuntimeFactory = (options: {
	cwd: string;
	agentDir: string;
	sessionManager: SessionManager;
	sessionStartEvent?: SessionStartEvent;
	projectTrustContext?: ProjectTrustContext;
}) => Promise<CreateAgentSessionRuntimeResult>;

/**
 * Thrown when /import references a JSONL file path that does not exist.
 */
export class SessionImportFileNotFoundError extends Error {
	readonly filePath: string;

	constructor(filePath: string) {
		super(`File not found: ${filePath}`);
		this.name = "SessionImportFileNotFoundError";
		this.filePath = filePath;
	}
}

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

/**
 * A live runtime bundle: the session plus the cwd-bound services it was created
 * with. The active runtime is pointed at by `current`; runtimes whose turn kept
 * running across a switch are parked in `detached` until they settle.
 */
interface RuntimeInstance {
	session: AgentSession;
	services: AgentSessionServices;
	diagnostics: AgentSessionRuntimeDiagnostic[];
	modelFallbackMessage?: string;
	/** Set while the instance is detached (running in the background). */
	detachedAt?: number;
	/** Unsubscribes the detached-lifecycle watcher. */
	detachUnsubscribe?: () => void;
	/** A UI request (permission prompt / extension dialog) is pending on this runtime. */
	needsInput?: boolean;
	/** Armed while detached: reaps the instance after the idle timeout. */
	idleTimer?: ReturnType<typeof setTimeout>;
	/** Per-instance idle timeout (defaults to DEFAULT_DETACHED_IDLE_TIMEOUT_MS). */
	idleTimeoutMs?: number;
}

/** State of a re-attached runtime at the moment of re-attachment. */
export interface ReattachSnapshot {
	running: boolean;
	needsInput: boolean;
	pendingMessageCount: number;
}

/** Serializable status for one runtime (the active one, or a detached one). */
export interface RuntimeSessionStatus {
	sessionFile?: string;
	sessionId: string;
	/** True for the session the client is currently attached to. */
	active: boolean;
	/** A turn or compaction is in flight on this runtime. */
	running: boolean;
	/** Queued steering/follow-up messages waiting on this session. */
	pendingMessageCount: number;
	/** A UI request (permission prompt / extension dialog) is pending on this runtime. */
	needsInput?: boolean;
}

/** Maximum number of detached (background) runtimes kept alive at once. */
const MAX_DETACHED_RUNTIMES = 4;
/**
 * How long a settled detached runtime stays alive before it is reaped
 * (Phase 2: idle keep-alive — switching back to a recently-used session is a
 * pure re-attach with no runtime creation and no history refetch).
 */
const DEFAULT_DETACHED_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Owns the current AgentSession plus its cwd-bound services.
 *
 * Session replacement methods tear down the current runtime first, then create
 * and apply the next runtime. If creation fails, the error is propagated to the
 * caller. The caller is responsible for user-facing error handling.
 *
 * A runtime whose turn is still running when the user switches away is NOT
 * disposed: it is parked in a detached registry, keeps streaming to its own
 * session file in the background, and is reaped once it settles (turn ended,
 * nothing queued). Switching back to a detached session re-attaches the same
 * live runtime instead of creating a second one over the same file. This is
 * Phase 1 of the session architecture roadmap
 * (desktop-app/SESSION-ARCHITECTURE.md): the registry is the substrate for
 * later multi-live-runtime support.
 */
export class AgentSessionRuntime {
	private rebindSession?: (session: AgentSession) => Promise<void>;
	private beforeSessionInvalidate?: () => void;
	private current: RuntimeInstance;
	private readonly createRuntime: CreateAgentSessionRuntimeFactory;
	private detached: Map<string, RuntimeInstance> = new Map();
	private runtimeListeners = new Set<() => void>();
	private detachedIdleTimeoutMs?: number;

	constructor(
		_session: AgentSession,
		_services: AgentSessionServices,
		createRuntime: CreateAgentSessionRuntimeFactory,
		_diagnostics: AgentSessionRuntimeDiagnostic[] = [],
		_modelFallbackMessage?: string,
	) {
		this.current = {
			session: _session,
			services: _services,
			diagnostics: _diagnostics,
			modelFallbackMessage: _modelFallbackMessage,
		};
		this.createRuntime = createRuntime;
	}

	get services(): AgentSessionServices {
		return this.current.services;
	}

	get session(): AgentSession {
		return this.current.session;
	}

	get cwd(): string {
		return this.current.services.cwd;
	}

	get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
		return this.current.diagnostics;
	}

	get modelFallbackMessage(): string | undefined {
		return this.current.modelFallbackMessage;
	}

	setRebindSession(rebindSession?: (session: AgentSession) => Promise<void>): void {
		this.rebindSession = rebindSession;
	}

	/**
	 * Set a synchronous callback that runs after `session_shutdown` handlers finish
	 * but before the current session is invalidated.
	 *
	 * This is for host-owned UI teardown that must not yield to the event loop,
	 * such as detaching extension-provided TUI components before the old extension
	 * context becomes stale.
	 */
	setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
		this.beforeSessionInvalidate = beforeSessionInvalidate;
	}

	private async emitBeforeSwitch(
		reason: "new" | "resume" | "clear",
		targetSessionFile?: string,
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_switch")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_switch",
			reason,
			targetSessionFile,
		});
		return { cancelled: result?.cancel === true };
	}

	private async emitBeforeFork(
		entryId: string,
		options: { position: "before" | "at" },
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_fork")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_fork",
			entryId,
			...options,
		});
		return { cancelled: result?.cancel === true };
	}

	private async teardownCurrent(reason: SessionShutdownEvent["reason"], targetSessionFile?: string): Promise<void> {
		await emitSessionShutdownEvent(this.session.extensionRunner, {
			type: "session_shutdown",
			reason,
			targetSessionFile,
		});
		this.beforeSessionInvalidate?.();
		this.session.dispose();
	}

	private apply(result: CreateAgentSessionRuntimeResult): void {
		this.current = {
			session: result.session,
			services: result.services,
			diagnostics: result.diagnostics,
			modelFallbackMessage: result.modelFallbackMessage,
		};
	}

	/**
	 * Move the current runtime off the active slot without disposing it.
	 *
	 * Called instead of `teardownCurrent` when the current session still has a
	 * turn in flight: the turn keeps streaming to its session file in the
	 * background, and the runtime is reaped once it settles. The consumer's
	 * event subscription is expected to move to the new session as part of the
	 * usual rebind (both rpc-mode and the TUI do), so a detached runtime's
	 * events simply stop being observed — its output still lands in the
	 * session file.
	 */
	private detachCurrent(): void {
		const instance = this.current;
		const file = instance.session.sessionFile;
		this.beforeSessionInvalidate?.();

		if (!file) {
			// In-memory sessions cannot be re-attached later; abort and dispose.
			void instance.session.abort().catch(() => {});
			emitSessionShutdownEvent(instance.session.extensionRunner, {
				type: "session_shutdown",
				reason: "quit",
			}).catch(() => {});
			instance.session.dispose();
			this.emitRuntimesChanged();
			return;
		}

		instance.detachedAt = Date.now();
		this.armIdleReaper(instance);
		instance.detachUnsubscribe = instance.session.subscribe((event) => {
			if (event.type === "agent_end" && !event.willRetry) {
				this.armIdleReaper(instance);
				this.emitRuntimesChanged();
			} else if (event.type === "compaction_end" && !event.willRetry) {
				this.armIdleReaper(instance);
				this.emitRuntimesChanged();
			} else if (event.type === "agent_start" || event.type === "compaction_start") {
				this.armIdleReaper(instance);
				this.emitRuntimesChanged();
			}
		});
		this.detached.set(file, instance);
		this.evictOldestDetached();
		this.emitRuntimesChanged();
	}

	/**
	 * Move the current runtime into the detached registry instead of tearing
	 * it down. Phase 2/3 keep-alive: EVERY session the user switches away from
	 * stays live (bounded by MAX_DETACHED_RUNTIMES + the idle reaper), so
	 * switching back is a pure re-attach — for a session that was mid-turn,
	 * idle, or hosted in another project. The only exception is a replacement
	 * that targets the SAME session file (e.g. /clear rewrites it in place):
	 * the detached writer would race the rewritten file.
	 */
	private async detachOrTeardownCurrent(
		reason: SessionShutdownEvent["reason"],
		targetSessionFile?: string,
		options?: { discardPrevious?: boolean },
	): Promise<void> {
		// Extension-initiated replacements discard the previous session: the
		// documented ctx contract is that a captured ctx goes stale after
		// ctx.newSession()/ctx.switchSession()/ctx.fork() (#2860), so extensions
		// never observe a live background session they did not opt into.
		const sameFile = targetSessionFile !== undefined && this.session.sessionFile === targetSessionFile;
		if (!sameFile && !options?.discardPrevious) {
			this.detachCurrent();
			return;
		}
		await this.teardownCurrent(reason, targetSessionFile);
	}

	/**
	 * (Re-)arm the idle reaper for a detached runtime. Phase 2 keep-alive: a
	 * settled detached runtime stays alive so switching back is a pure
	 * re-attach; it is only reaped after `idleTimeoutMs` with no turn
	 * activity. A runtime blocked on user input (needsInput) is never reaped —
	 * it cannot proceed until answered, and the user is on their way.
	 */
	private armIdleReaper(instance: RuntimeInstance): void {
		const file = instance.session.sessionFile;
		if (!file) return;
		if (instance.idleTimer) clearTimeout(instance.idleTimer);
		instance.idleTimer = setTimeout(
			() => {
				instance.idleTimer = undefined;
				if (this.detached.get(file) !== instance) return;
				if (this.current.session === instance.session) return;
				const s = instance.session;
				if (s.isStreaming || s.isCompacting || s.pendingMessageCount > 0 || instance.needsInput) {
					// Busy or blocked on input — re-arm; the next turn event refreshes.
					this.armIdleReaper(instance);
					return;
				}
				this.disposeDetached(instance);
			},
			instance.idleTimeoutMs ?? this.detachedIdleTimeoutMs ?? DEFAULT_DETACHED_IDLE_TIMEOUT_MS,
		);
	}

	private clearIdleReaper(instance: RuntimeInstance): void {
		if (instance.idleTimer) {
			clearTimeout(instance.idleTimer);
			instance.idleTimer = undefined;
		}
	}

	private async disposeDetached(instance: RuntimeInstance): Promise<void> {
		const file = instance.session.sessionFile;
		if (!file || this.detached.get(file) !== instance) return;
		this.detached.delete(file);
		this.clearIdleReaper(instance);
		instance.detachUnsubscribe?.();
		instance.detachUnsubscribe = undefined;
		try {
			await emitSessionShutdownEvent(instance.session.extensionRunner, {
				type: "session_shutdown",
				reason: "quit",
			});
		} catch {
			// A failing shutdown handler must not block the reaper.
		}
		instance.session.dispose();
		this.emitRuntimesChanged();
	}

	private evictOldestDetached(): void {
		while (this.detached.size > MAX_DETACHED_RUNTIMES) {
			let oldest: RuntimeInstance | undefined;
			let oldestFile: string | undefined;
			for (const [file, instance] of this.detached) {
				if (!oldest || (instance.detachedAt ?? 0) < (oldest.detachedAt ?? 0)) {
					oldest = instance;
					oldestFile = file;
				}
			}
			if (!oldest || !oldestFile) break;
			if (oldest.session.isStreaming || oldest.session.isCompacting) {
				// Abort the oldest: its agent_end leaves it idle for the reaper.
				void oldest.session.abort().catch(() => {});
				this.armIdleReaper(oldest);
			} else {
				void this.disposeDetached(oldest);
			}
			break;
		}
	}

	private emitRuntimesChanged(): void {
		for (const listener of this.runtimeListeners) {
			listener();
		}
	}

	/**
	 * Override the idle-keep-alive timeout for detached runtimes (mainly for
	 * tests and embedding hosts that want eager reaping).
	 */
	setDetachedIdleTimeoutMs(ms: number): void {
		this.detachedIdleTimeoutMs = ms;
		for (const instance of this.detached.values()) {
			this.armIdleReaper(instance);
		}
	}

	/**
	 * Resolve a session by file path to its live runtime session: the active
	 * one when the path matches (or is omitted), otherwise a detached
	 * (background) runtime. Used by session-scoped RPC commands.
	 */
	getSessionForPath(sessionPath?: string): AgentSession | undefined {
		if (!sessionPath || this.session.sessionFile === sessionPath) {
			return this.session;
		}
		return this.detached.get(sessionPath)?.session;
	}

	/**
	 * Serializable status for every live runtime: the active one plus any
	 * detached ones still running (or lingering until settled).
	 */
	getSessionsStatus(): RuntimeSessionStatus[] {
		const statusFor = (instance: RuntimeInstance, active: boolean): RuntimeSessionStatus => ({
			sessionFile: instance.session.sessionFile,
			sessionId: instance.session.sessionId,
			active,
			running: instance.session.isStreaming || instance.session.isCompacting,
			pendingMessageCount: instance.session.pendingMessageCount,
			needsInput: instance.needsInput === true,
		});
		const statuses = [statusFor(this.current, true)];
		for (const instance of this.detached.values()) {
			if (instance.session === this.current.session) continue;
			statuses.push(statusFor(instance, false));
		}
		return statuses;
	}

	/**
	 * Subscribe to runtime-registry changes (detach, re-attach, background
	 * turn start/end, reaping). Listeners should read `getSessionsStatus()`
	 * for the fresh snapshot.
	 */
	subscribeRuntimes(listener: () => void): () => void {
		this.runtimeListeners.add(listener);
		return () => {
			this.runtimeListeners.delete(listener);
		};
	}

	/**
	 * Flag/unflag a runtime as waiting for user input (a permission prompt or
	 * extension dialog opened against its bound UI context). Called by the RPC
	 * host when it emits a request for a specific session and when the client
	 * answers it. Surfaces in `getSessionsStatus()` so clients can badge
	 * background sessions that are blocked on input.
	 */
	markSessionNeedsInput(sessionFile: string | undefined, needsInput: boolean): void {
		if (!sessionFile) return;
		let instance = this.current.session.sessionFile === sessionFile ? this.current : undefined;
		if (!instance) {
			instance = this.detached.get(sessionFile);
		}
		if (!instance || instance.needsInput === needsInput) return;
		instance.needsInput = needsInput;
		this.emitRuntimesChanged();
	}

	/**
	 * Abort a session's in-flight turn by session file. Works for the active
	 * session and for detached (background) runtimes. Returns false when no
	 * runtime matches the path.
	 */
	async abortSession(sessionPath: string): Promise<boolean> {
		if (this.session.sessionFile === sessionPath) {
			await this.session.abort();
			return true;
		}
		const instance = this.detached.get(sessionPath);
		if (!instance) return false;
		await instance.session.abort();
		return true;
	}

	private async finishSessionReplacement(
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>,
		startEvent?: SessionStartEvent,
	): Promise<void> {
		if (this.rebindSession) {
			await this.rebindSession(this.session);
		}
		// Listeners are now re-attached; tell the UI the session context changed.
		this.session.emitSessionStartEvent(startEvent);
		if (withSession) {
			await withSession(this.session.createReplacedSessionContext());
		}
	}

	async switchSession(
		sessionPath: string,
		options?: {
			cwdOverride?: string;
			withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
			projectTrustContextFactory?: (cwd: string) => ProjectTrustContext;
			/** Tear down (dispose + invalidate) the previous runtime instead of
			 *  keeping it live in the background registry (extension ctx contract). */
			discardPrevious?: boolean;
		},
	): Promise<{ cancelled: boolean; reattached?: boolean; snapshot?: ReattachSnapshot }> {
		const beforeResult = await this.emitBeforeSwitch("resume", sessionPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;

		// Re-attach fast path: the target session's runtime is still live in the
		// background (detached while its turn kept running). Reuse it instead of
		// creating a second runtime over the same session file. The result
		// carries a snapshot so clients can adopt an in-flight turn (show the
		// streaming state immediately) without a separate status round-trip.
		const detached = this.detached.get(sessionPath);
		if (detached) {
			this.detached.delete(sessionPath);
			this.clearIdleReaper(detached);
			detached.detachUnsubscribe?.();
			detached.detachUnsubscribe = undefined;
			detached.detachedAt = undefined;
			await this.detachOrTeardownCurrent("resume", sessionPath, options);
			this.current = detached;
			this.emitRuntimesChanged();
			await this.finishSessionReplacement(options?.withSession, {
				type: "session_start",
				reason: "resume",
				previousSessionFile,
			});
			return {
				cancelled: false,
				reattached: true,
				snapshot: {
					running: detached.session.isStreaming || detached.session.isCompacting,
					needsInput: detached.needsInput === true,
					pendingMessageCount: detached.session.pendingMessageCount,
				},
			};
		}

		const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
		assertSessionCwdExists(sessionManager, this.cwd);
		await this.detachOrTeardownCurrent("resume", sessionManager.getSessionFile(), options);
		this.apply(
			await this.createRuntime({
				cwd: sessionManager.getCwd(),
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
				projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	async newSession(options?: {
		parentSession?: string;
		/** Start the new session in a different project (Phase 3 multi-project):
		 *  the session lands in that project's session dir and the runtime is
		 *  created with cwd-bound services for that project. */
		cwd?: string;
		/** Tear down (dispose + invalidate) the previous runtime instead of
		 *  keeping it live in the background registry. Set by extension-initiated
		 *  replacements to preserve the stale-ctx contract (#2860). */
		discardPrevious?: boolean;
		setup?: (sessionManager: SessionManager) => Promise<void>;
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
	}): Promise<{ cancelled: boolean }> {
		const beforeResult = await this.emitBeforeSwitch("new");
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		const targetCwd = options?.cwd ? resolvePath(options.cwd) : this.cwd;
		if (options?.cwd && !existsSync(targetCwd)) {
			throw new Error(`Project directory does not exist: ${targetCwd}`);
		}
		const sessionDir = options?.cwd
			? getDefaultSessionDir(targetCwd, this.services.agentDir)
			: this.session.sessionManager.getSessionDir();
		const sessionManager =
			options?.cwd || this.session.sessionManager.isPersisted()
				? SessionManager.create(targetCwd, sessionDir)
				: SessionManager.inMemory(targetCwd);
		if (options?.parentSession) {
			sessionManager.newSession({ parentSession: options.parentSession });
		}

		await this.detachOrTeardownCurrent("new", sessionManager.getSessionFile(), options);
		this.apply(
			await this.createRuntime({
				cwd: targetCwd,
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
			}),
		);
		if (options?.setup) {
			await options.setup(this.session.sessionManager);
			this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
		}
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	/**
	 * `/clear` — reset the current session in place: keep the same session id
	 * and file (and its parent link in the session tree) but drop every message
	 * entry, rewriting the file to a fresh header. The runtime is replaced so
	 * all in-memory conversation state is reset cleanly. Distinct from
	 * `newSession`, which starts a brand-new session file.
	 */
	async clearConversation(options?: {
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
	}): Promise<{ cancelled: boolean }> {
		const beforeResult = await this.emitBeforeSwitch("clear");
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		const currentFile = this.session.sessionFile;
		const currentId = this.session.sessionManager.getSessionId();
		const parentSession = this.session.sessionManager.getHeader()?.parentSession;
		const sessionDir = this.session.sessionManager.getSessionDir();

		const sessionManager = this.session.sessionManager.isPersisted()
			? SessionManager.create(this.cwd, sessionDir)
			: SessionManager.inMemory(this.cwd);
		// Fresh header with the SAME id + parent, then rebind to the EXISTING file
		// and overwrite it (drops all prior message entries in place).
		sessionManager.newSession({ id: currentId, parentSession });
		if (currentFile) {
			sessionManager.rebindAndOverwriteFile(currentFile);
		}

		await this.teardownCurrent("clear", currentFile);
		this.apply(
			await this.createRuntime({
				cwd: this.cwd,
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "clear", previousSessionFile },
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	async fork(
		entryId: string,
		options?: { position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
	): Promise<{ cancelled: boolean; selectedText?: string }> {
		const position = options?.position ?? "before";
		const beforeResult = await this.emitBeforeFork(entryId, { position });
		if (beforeResult.cancelled) {
			return { cancelled: true };
		}
		let targetLeafId: string | null;
		let selectedText: string | undefined;

		const selectedEntry = this.session.sessionManager.getEntry(entryId);
		if (!selectedEntry) {
			throw new Error("Invalid entry ID for forking");
		}

		if (position === "at") {
			targetLeafId = selectedEntry.id;
		} else {
			if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
				throw new Error("Invalid entry ID for forking");
			}
			targetLeafId = selectedEntry.parentId;
			selectedText = extractUserMessageText(selectedEntry.message.content);
		}

		const previousSessionFile = this.session.sessionFile;
		if (this.session.sessionManager.isPersisted()) {
			const currentSessionFile = this.session.sessionFile;
			if (!currentSessionFile) {
				throw new Error("Persisted session is missing a session file");
			}
			const sessionDir = this.session.sessionManager.getSessionDir();
			if (!targetLeafId) {
				const sessionManager = SessionManager.create(this.cwd, sessionDir);
				sessionManager.newSession({ parentSession: currentSessionFile });
				await this.teardownCurrent("fork", sessionManager.getSessionFile());
				this.apply(
					await this.createRuntime({
						cwd: this.cwd,
						agentDir: this.services.agentDir,
						sessionManager,
						sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
					}),
				);
				await this.finishSessionReplacement(options?.withSession);
				return { cancelled: false, selectedText };
			}

			const sessionManager = SessionManager.open(currentSessionFile, sessionDir);
			const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
			if (!forkedSessionPath) {
				throw new Error("Failed to create forked session");
			}
			await this.teardownCurrent("fork", sessionManager.getSessionFile());
			this.apply(
				await this.createRuntime({
					cwd: sessionManager.getCwd(),
					agentDir: this.services.agentDir,
					sessionManager,
					sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
				}),
			);
			await this.finishSessionReplacement(options?.withSession);
			return { cancelled: false, selectedText };
		}

		const sessionManager = this.session.sessionManager;
		if (!targetLeafId) {
			sessionManager.newSession({ parentSession: this.session.sessionFile });
		} else {
			sessionManager.createBranchedSession(targetLeafId);
		}
		await this.teardownCurrent("fork", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: this.cwd,
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false, selectedText };
	}

	/**
	 * Import a session JSONL file and switch runtime state to the imported session.
	 *
	 * @returns `{ cancelled: true }` when cancelled by `session_before_switch`, otherwise `{ cancelled: false }`.
	 * @throws {SessionImportFileNotFoundError} When the input path does not exist.
	 * @throws {MissingSessionCwdError} When the imported session cwd cannot be resolved and no override is provided.
	 */
	async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
		const resolvedPath = resolvePath(inputPath);
		if (!existsSync(resolvedPath)) {
			throw new SessionImportFileNotFoundError(resolvedPath);
		}

		const sessionDir = this.session.sessionManager.getSessionDir();
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		const destinationPath = join(sessionDir, basename(resolvedPath));
		const beforeResult = await this.emitBeforeSwitch("resume", destinationPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		if (resolve(destinationPath) !== resolvedPath) {
			copyFileSync(resolvedPath, destinationPath);
		}

		const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
		assertSessionCwdExists(sessionManager, this.cwd);
		await this.teardownCurrent("resume", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: sessionManager.getCwd(),
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
			}),
		);
		await this.finishSessionReplacement();
		return { cancelled: false };
	}

	async dispose(): Promise<void> {
		// Reap any detached (background) runtimes first so their in-flight turns
		// get a chance to run shutdown handlers before the process exits.
		const detached = [...this.detached.values()];
		this.detached.clear();
		for (const instance of detached) {
			this.clearIdleReaper(instance);
			instance.detachUnsubscribe?.();
			try {
				await emitSessionShutdownEvent(instance.session.extensionRunner, {
					type: "session_shutdown",
					reason: "quit",
				});
			} catch {
				// Shutdown handlers must not block process exit.
			}
			instance.session.dispose();
		}
		await emitSessionShutdownEvent(this.session.extensionRunner, {
			type: "session_shutdown",
			reason: "quit",
		});
		this.beforeSessionInvalidate?.();
		this.session.dispose();
	}
}

/**
 * Create the initial runtime from a runtime factory and initial session target.
 *
 * The same factory is stored on the returned AgentSessionRuntime and reused for
 * later /new, /resume, /fork, and import flows.
 */
export async function createAgentSessionRuntime(
	createRuntime: CreateAgentSessionRuntimeFactory,
	options: {
		cwd: string;
		agentDir: string;
		sessionManager: SessionManager;
		sessionStartEvent?: SessionStartEvent;
	},
): Promise<AgentSessionRuntime> {
	assertSessionCwdExists(options.sessionManager, options.cwd);
	const result = await createRuntime(options);
	return new AgentSessionRuntime(
		result.session,
		result.services,
		createRuntime,
		result.diagnostics,
		result.modelFallbackMessage,
	);
}

export {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	clearAgentSessionServicesCache,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.ts";

/**
 * Shared engine-event pipeline: the single reducer that turns the engine's
 * `rpc://event` stream into store mutations. Mounted by the main App window
 * and by any auxiliary window (HUD) that renders live conversation state.
 *
 * Pure store mutations + side effects; the caller supplies per-window refs
 * (history-loading latch, session-switch generation, parked questions) and
 * its engine-state sync. Window-local UI (React state pickers, overlays)
 * stays in the caller.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

import * as rpc from "./rpc";
import { openExternalLink } from "./external-link";
import { playCompletionSound } from "./completion-sound";
import { playAudioBlob, synthesize, type VoiceSettings } from "./voice";
import { speechify } from "./speech-text";
import { triggerHaptic } from "./haptics";
import { pickLoadingVerb } from "./loading-verbs";
import { getCachedSessionMessages, setCachedSessionMessages } from "./session-cache";
import { applyHistoryPage, HISTORY_PAGE_SIZE } from "./history";
import { applyBackgroundSessionEvent } from "./background-session-events";
import { dropBackgroundSubscription, syncBackgroundSubscriptions } from "./background-sessions";
import { toast } from "../stores/toast-store";
import { notice } from "../stores/notice-store";
import { voiceCall, useVoiceCallStore } from "./voice-call";
import { huddleCall } from "./huddle-call";
import {
	useSessionStore,
	type QuestionUiRequest,
	type UiRequestMethod,
} from "../stores/session-store";
import { useSettingsStore } from "../stores/settings-store";
import { useUiStore } from "../stores/ui-store";
import { useRuntimeStatusStore } from "../stores/runtime-status-store";
import { useStatsStore, type SessionStats } from "../stores/stats-store";
import { useTabsStore } from "../stores/tabs-store";
import { useSessionTreeStore } from "../stores/session-tree-store";
import { useOfficeStore } from "../stores/office-store";
import { useCronStore } from "../stores/cron-store";
import { useActivityStore } from "../stores/activity-store";
import { useSessionTranscriptsStore } from "../stores/session-transcripts-store";
import { useToolProgressStore } from "../stores/tool-progress-store";
import { useWidgetStore } from "../stores/widget-store";

/** Per-window state the pipeline drives through (refs live in the window). */
export interface AgentEventDeps {
	/** True while authoritative history is loading: live message events yield. */
	loadingHistoryRef: { current: boolean };
	/** Monotonic guard so a slow session-switch fetch can't paint stale data. */
	sessionStartGenerationRef: { current: number };
	/** Questions parked for background sessions, promoted on activation. */
	parkedQuestionsRef: Map<string, QuestionUiRequest>;
	/** User echoes that arrived while history was loading: the latch defers
	 *  them here instead of dropping (a first send inside the boot window),
	 *  and the history fetch drains + merges them into the fetched snapshot. */
	deferredUserEchoesRef: { current: AgentMessage[] };
	/** Pull the authoritative engine state into the stores (App's callback). */
	syncEngineState: () => Promise<void>;
}

// ============================================================================
// Reply/text helpers (moved out of App.tsx so both windows share them).
// ============================================================================

const OFFICE_TURN_CUE_MIN_GAP_MS = 700;
let lastOfficeTurnCueAt = 0;

/** Play a coworker office turn-end cue, throttled by a min gap. */
function playOfficeTurnCompletionSound() {
	const now = Date.now();
	if (now - lastOfficeTurnCueAt < OFFICE_TURN_CUE_MIN_GAP_MS) return;
	lastOfficeTurnCueAt = now;
	playCompletionSound();
	triggerHaptic("streamDone");
}

/** Extract the text of the last assistant message in a run (for voice mode). */
function agentEndText(event: { messages?: AgentMessage[]; summary?: { lastAssistantText?: string } }): string {
	if (event.summary) return event.summary.lastAssistantText ?? "";
	if (Array.isArray(event.messages)) return lastAssistantText(event.messages);
	return "";
}

function lastAssistantText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const content = m.content;
		if (!Array.isArray(content)) return "";
		const text = content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");
		return text;
	}
	return "";
}

/** Speak text aloud via the configured TTS endpoint. Best-effort; errors are non-fatal. */
async function speakReply(text: string): Promise<void> {
	const voice = useSettingsStore.getState();
	if (!voice.voiceEnabled || !voice.voiceAutoSpeak) return;
	const settings: VoiceSettings = {
		voiceSttBaseUrl: voice.voiceSttBaseUrl,
		voiceSttApiKey: voice.voiceSttApiKey,
		voiceSttModel: voice.voiceSttModel,
		voiceTtsBaseUrl: voice.voiceTtsBaseUrl,
		voiceTtsApiKey: voice.voiceTtsApiKey,
		voiceTtsModel: voice.voiceTtsModel,
		voiceTtsVoice: voice.voiceTtsVoice,
	};
	try {
		// Same sanitizer as call mode: never read markdown/URLs/paths aloud.
		const spoken = speechify(text, { mode: voice.voiceSpeechMode });
		const blob = await synthesize(spoken, settings);
		playAudioBlob(blob);
	} catch (e) {
		console.warn("TTS failed", e);
	}
}

/** Plain text of a user message, both content shapes. */
export function getUserMessageText(message: import("@earendil-works/pi-ai").UserMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

/** Merge a fetched history snapshot with locally appended user echoes: the
 *  boot history fetch is issued before the first send, so a user echo that
 *  appended live during the fetch's flight must survive the snapshot's
 *  setMessages — otherwise the row the user just typed vanishes from the
 *  transcript until a tab switch or restart refetches it. Only TRAILING
 *  local user rows the snapshot lacks are re-added, by text identity. */
export function mergeUserEchoes(fetched: AgentMessage[], local: AgentMessage[]): AgentMessage[] {
	if (local.length === 0) return fetched;
	const fetchedUserTexts = new Set(
		fetched
			.filter((m) => m.role === "user")
			.map((m) => getUserMessageText(m as import("@earendil-works/pi-ai").UserMessage)),
	);
	const orphans = local.filter(
		(m) =>
			m.role === "user" &&
			!fetchedUserTexts.has(getUserMessageText(m as import("@earendil-works/pi-ai").UserMessage)),
	);
	return orphans.length > 0 ? [...fetched, ...orphans] : fetched;
}

/** Keep the warm session cache in step with live mutations. Without this,
 *  switching back to a session that had streaming activity paints the
 *  transcript as it looked when the session was last left, then repaints on
 *  the fetch — a visible stale-then-fresh flash. */
function cacheCurrentTranscript(): void {
	const store = useSessionStore.getState();
	if (!store.sessionFile) return;
	const messages = store.streamingMessage
		? [...store.messages, store.streamingMessage]
		: store.messages;
	setCachedSessionMessages(store.sessionFile, messages);
}

// ── Contract-2 streaming accumulator ────────────────────────────────────────
// Compact deltas mutate a draft message; the store is written at most once per
// ~16ms instead of once per token (and the draft avoids an O(n) transcript copy
// per delta). The final `message_end` remains authoritative.

let assistantStream: { messageId: string; message: AssistantMessage } | null = null;
let assistantStreamTimer: ReturnType<typeof setTimeout> | null = null;

function cloneAssistantMessage(message: AssistantMessage): AssistantMessage {
	const content = Array.isArray(message.content)
		? message.content.map((block) => ({ ...block }))
		: message.content;
	return { ...message, content } as AssistantMessage;
}

function commitAssistantStream(): void {
	assistantStreamTimer = null;
	if (!assistantStream) return;
	if (!hasAssistantContent(assistantStream.message)) return;
	// Clone so the streaming store slice gets a new reference; the draft itself
	// keeps mutating between frames and the committed transcript is untouched.
	useSessionStore.getState().setStreamingMessage(cloneAssistantMessage(assistantStream.message));
}

function finalizeAssistantStream(): void {
	commitAssistantStream();
	if (assistantStream && hasAssistantContent(assistantStream.message)) {
		useSessionStore.getState().commitAssistantMessage(cloneAssistantMessage(assistantStream.message));
	}
	resetAssistantStream();
	useSessionStore.getState().setStreamingMessage(null);
}

function scheduleAssistantCommit(): void {
	if (assistantStreamTimer !== null) return;
	assistantStreamTimer = setTimeout(commitAssistantStream, 16);
}

export function resetStreamingAccumulator(): void {
	resetAssistantStream();
}

function resetAssistantStream(): void {
	if (assistantStreamTimer !== null) {
		clearTimeout(assistantStreamTimer);
		assistantStreamTimer = null;
	}
	assistantStream = null;
}

function startAssistantStream(message: AssistantMessage, messageId: string): void {
	assistantStream = { messageId, message: cloneAssistantMessage(message) };
	useSessionStore.getState().setStreamingMessage(null);
}

function applyAssistantDelta(event: {
	messageId: string;
	contentIndex: number;
	kind: "text" | "thinking";
	delta: string;
}): void {
	if (!event.delta) return;
	if (!assistantStream || assistantStream.messageId !== event.messageId) {
		// The stream start was dropped (e.g. it landed during a history fetch).
		// Continue from the in-flight slice, if one is already painted.
		const streaming = useSessionStore.getState().streamingMessage;
		if (!streaming) return;
		assistantStream = { messageId: event.messageId, message: cloneAssistantMessage(streaming) };
	}
	const content = assistantStream.message.content;
	if (!Array.isArray(content)) return;
	const index = Math.max(0, event.contentIndex);
	const block = content[index] as { type?: string; text?: string; thinking?: string } | undefined;
	if (event.kind === "text") {
		if (block?.type === "text") block.text = (block.text ?? "") + event.delta;
		else content[index] = { type: "text", text: event.delta } as never;
	} else {
		if (block?.type === "thinking") block.thinking = (block.thinking ?? "") + event.delta;
		else content[index] = { type: "thinking", thinking: event.delta } as never;
	}
	scheduleAssistantCommit();
}

function applyAssistantSnapshot(event: { messageId: string; message: AssistantMessage }): void {
	if (!event.message) return;
	assistantStream = { messageId: event.messageId, message: cloneAssistantMessage(event.message) };
	scheduleAssistantCommit();
}

/** Generate a concise session name from the first user message. */
function deriveSessionName(text: string): string | null {
	const normalized = text.replace(/[\r\n]+/g, " ").trim();
	if (normalized.length < 3) return null;
	const maxLen = 50;
	return normalized.length > maxLen ? `${normalized.slice(0, maxLen).trimEnd()}…` : normalized;
}

function hasAssistantContent(message: import("@earendil-works/pi-ai").AssistantMessage): boolean {
	const content = message.content;
	if (!Array.isArray(content)) return false;
	return content.some(
		(c) =>
			(c.type === "text" && c.text.length > 0) ||
			(c.type === "thinking" && (c.thinking?.length ?? 0) > 0) ||
			c.type === "toolCall",
	);
}

type StatsPayload = SessionStats & {
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
};

function applySessionStats(stats: StatsPayload): void {
	useStatsStore.getState().setStats(stats);
	if (stats.contextUsage && stats.contextUsage.contextWindow > 0) {
		useSessionStore.getState().setContextUsage({
			tokens: stats.contextUsage.tokens ?? null,
			contextWindow: stats.contextUsage.contextWindow,
			percent: stats.contextUsage.percent ?? null,
		});
	}
}

/** Pull stats and paint them (fallback for engines without push). */
async function refreshSessionStats(): Promise<void> {
	try {
		const statsRes = (await rpc.sendCommand({ type: "get_session_stats" })) as SessionStats & {
			contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
		};
		if (statsRes) applySessionStats(statsRes);
	} catch (e) {
		console.error("Failed to refresh stats", e);
	}
}

// ============================================================================
// The pipeline.
// ============================================================================

// The last browser_* toolCall id this window revealed for — dedupes the
// per-message-update scans so a single call reveals once.
let lastBrowserToolId = "";

/** When the agent reaches for a desktop-browser tool and the right rail
 *  isn't showing the browser panel, bring the panel forward — the hand-off
 *  should feel automatic, like the agent just pulled the browser out. MCP
 *  tools register as mcp__<server>__<tool>, so desktop-browser calls arrive
 *  as "mcp__desktop-browser__browser_tabs" and friends; any tool on the
 *  desktop-browser server counts (its whole purpose is the panel). Bare
 *  `browser_` names are covered too for non-MCP callers. A new tool call
 *  re-reveals; the same call's streamed updates don't. */
function maybeRevealBrowserPanel(message: { role: string; content?: unknown }): void {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return;
	for (const block of message.content as Array<Record<string, unknown>>) {
		if (block?.type !== "toolCall") continue;
		const id = typeof block.id === "string" ? block.id : "";
		if (!id || id === lastBrowserToolId) continue;
		const name = typeof block.name === "string" ? block.name : "";
		if (!name.startsWith("browser_") && !name.startsWith("mcp__desktop-browser__")) continue;
		lastBrowserToolId = id;
		const ui = useUiStore.getState();
		// Reveal when the panel isn't showing — a closed sidebar keeps its tab on
		// "browser", so the closed state alone is also a reason to open it.
		if (!ui.rightSidebarOpen || ui.rightSidebarTab !== "browser") ui.setRightSidebarTab("browser");
	}
}

/** Error text that means the run failed for missing/expired credentials. */
const AUTH_ERROR_RE =
	/(not (?:logged|signed) in|authentication (?:failed|required)|unauthorized|\b401\b|invalid api key|api key (?:is )?(?:missing|invalid|expired)|token (?:expired|invalid)|credentials? (?:missing|expired|invalid))/i;

/** Error text that means an MCP server could not be reached. */
const MCP_ERROR_RE =
	/(mcp[^\n]*(?:fail|error|not connected|unavailable|timed out|refused)|(?:failed to connect|connection (?:closed|refused)|server unavailable)[^\n]*mcp)/i;

/** Surface credential failures as a persistent, actionable notice: the
 *  transcript error block scrolls away, but the problem does not fix itself. */
function noticeForRunError(message: import("@earendil-works/pi-ai").AssistantMessage): void {
	const text = (message as { errorMessage?: string }).errorMessage ?? "";
	if (!text || !AUTH_ERROR_RE.test(text)) return;
	notice({
		id: "auth-expired",
		title: "Credentials expired or missing",
		message: text.replace(/\s+/g, " ").slice(0, 180),
		tone: "warning",
		persistKey: "auth-expired",
		action: {
			label: "Open account",
			onSelect: () => window.dispatchEvent(new CustomEvent("a-coder:open-account")),
		},
	});
}

/** Same for an MCP server that cannot connect: repeated tool failures should
 *  read as one standing condition, not N transient toasts. */
function noticeForToolError(message: AgentMessage): void {
	if ((message as { isError?: boolean }).isError !== true) return;
	const text = getUserMessageText(message as unknown as import("@earendil-works/pi-ai").UserMessage);
	if (!text || !MCP_ERROR_RE.test(text)) return;
	notice({
		id: "mcp-unavailable",
		title: "An MCP server is unavailable",
		message: text.replace(/\s+/g, " ").slice(0, 180),
		tone: "warning",
		persistKey: "mcp-unavailable",
		action: {
			label: "Open settings",
			onSelect: () => window.dispatchEvent(new CustomEvent("a-coder:open-settings")),
		},
	});
}

export function processAgentEvent(event: rpc.RpcEvent, deps: AgentEventDeps): void {
	if (event.type === "event_batch") {
		for (const inner of event.events) processAgentEvent(inner, deps);
		return;
	}

	// Frames from a subscribed background runtime never touch the active
	// transcript; route them into the per-session cache instead.
	const eventFile = (event as { sessionFile?: string }).sessionFile;
	if (event.type !== "session_start" && eventFile) {
		const activeFile = useSessionStore.getState().sessionFile;
		if (eventFile !== activeFile && useSessionTranscriptsStore.getState().subscribed[eventFile]) {
			applyBackgroundSessionEvent(eventFile, event);
			return;
		}
	}

	const { loadingHistoryRef, sessionStartGenerationRef, parkedQuestionsRef, deferredUserEchoesRef, syncEngineState } = deps;
	const isSessionStart = event.type === "session_start";
	const active = useSessionStore.getState();
	if (isSessionStart) {
		// A delayed start from an older activation must not reset a newer session.
		const incoming = (event as rpc.SessionStartEvent).activationId;
		if (typeof incoming === "number" && active.activationId > 0 && incoming < active.activationId) return;
	} else {
		// Frames are tagged with the session/activation that produced them; drop
		// late frames from the session we just switched away from.
		const eventSession = (event as { sessionFile?: string }).sessionFile;
		if (eventSession && active.sessionFile && eventSession !== active.sessionFile) return;
		const eventActivation = (event as { activationId?: number }).activationId;
		if (
			typeof eventActivation === "number" &&
			active.activationId > 0 &&
			eventActivation !== active.activationId
		) {
			return;
		}
	}
	const session = active;

	switch (event.type) {
		case "engine_info": {
			// Engine/client skew guard: the engine's first event names its
			// protocol contract. Missing event = legacy engine = contract 1.
			if (event.contract !== rpc.ENGINE_RPC_CONTRACT) {
				const newer = event.contract > rpc.ENGINE_RPC_CONTRACT;
				// Persistent, not a toast: skew stays true until something is
				// updated, and the notice carries the remedy in place.
				notice({
					id: "engine-skew",
					title: newer ? "Engine newer than this app" : "Engine older than this app",
					message: `CLI v${event.version} speaks contract ${event.contract}; this app expects ${rpc.ENGINE_RPC_CONTRACT}. Update the ${newer ? "app" : "CLI"}.`,
					tone: "warning",
					persistKey: `engine-skew:${rpc.ENGINE_RPC_CONTRACT}`,
				});
			}
			break;
		}
		case "agent_start":
			useToolProgressStore.getState().clear();
			session.setIsStreaming(true);
			session.setStreamingVerb(pickLoadingVerb());
			// A new turn started — forget any abort the user requested
			// during the previous turn.
			session.setAbortRequested(false);
			triggerHaptic("streamStart");
			voiceCall.notifyAgentStart();
			break;
		case "agent_end":
			// Commit a partial stream that ended without message_end (error/abort),
			// then drop the draft so the next turn starts clean.
			finalizeAssistantStream();
			cacheCurrentTranscript();
			// A retryable failure re-enters the loop; stay streaming and suppress the
			// completion cue until the retry resolves.
			if ("willRetry" in event && event.willRetry) {
				break;
			}
			session.setIsStreaming(false);
			if (session.abortRequested) {
				// A user-initiated abort also reaches agent_end; the chime is
				// suppressed, but the call must unwind its thinking state.
				voiceCall.notifyAgentAborted();
				break;
			}
			// Chime + haptic at the end of a natural turn.
			triggerHaptic("streamDone");
			if (useVoiceCallStore.getState().active) {
				// Voice call: the spoken reply is the turn-end signal — the
				// chime is suppressed and speaking is owned by the controller.
				const text = agentEndText(event);
				voiceCall.notifyAgentEnd(text);
			} else {
				playCompletionSound();
				// Voice mode: read the final assistant reply aloud.
				const voice = useSettingsStore.getState();
				if (voice.voiceEnabled && voice.voiceAutoSpeak) {
					const text = agentEndText(event);
					if (text) void speakReply(text);
				}
			}
			break;
		case "tool_start":
			useToolProgressStore.getState().start(event.toolCallId, event.toolName);
			break;
		case "tool_delta":
			useToolProgressStore
				.getState()
				.append(event.toolCallId, event.stream, event.delta, event.reset);
			break;
		case "tool_end":
			useToolProgressStore.getState().end(event.toolCallId, event.isError);
			break;
		case "auto_retry_start":
			toast.warning(
				`Retrying (attempt ${event.attempt}/${event.maxAttempts})…`,
				event.errorMessage,
			);
			break;
		case "auto_retry_end":
			if (!event.success && event.finalError) {
				toast.error("Model request failed", event.finalError);
			}
			break;
		case "auto_continue_decision": {
			const decision = event as rpc.AutoContinueDecisionEvent;
			const continueP = Math.round((decision.probabilities.continue ?? 0) * 100);
			const detail = `${decision.reason} · progress ${Math.round(decision.progress * 100)}% · ${decision.latencyMs}ms${decision.model ? ` · ${decision.model}` : ""}`;
			if (decision.action === "continue") {
				toast.info(`Auto-continuing (${continueP}%)`, detail);
			} else if (decision.action === "ask_user") {
				toast.warning("Agent paused", detail);
			} else {
				toast.info("Auto-continue stopped", detail);
			}
			break;
		}
		case "thinking_level_changed":
			// The engine can change the thinking level itself (the `/think`
			// command, /think cycling, or thinking-keyword escalation like
			// "ultrathink"). Keep the status bar in sync.
			session.setThinkingLevel(event.level);
			break;
		case "sessions_update": {
			// Runtime registry changed (background session detaching,
			// background turn started/finished, or reaped).
			useRuntimeStatusStore.getState().update(event.sessions, useTabsStore.getState().activePath);
			syncBackgroundSubscriptions(event.sessions, useSessionStore.getState().sessionFile);
			break;
		}
		case "office_update":
			// Your Office roster changed.
			useOfficeStore.getState().applySnapshot(
				(event as import("./rpc").OfficeUpdateEvent).snapshot,
			);
			break;
		case "cron_update":
			// Scheduled-task jobs changed (created, edited, fired).
			useCronStore.getState().applyJobs(
				(event as import("./rpc").CronUpdateEvent).jobs,
			);
			break;
		case "cron_run": {
			// A scheduled-task run started or finished — feed the inbox.
			const cronRun = (event as import("./rpc").CronRunEvent).run;
			const started = (event as import("./rpc").CronRunEvent).event === "started";
			useActivityStore.getState().add({
				kind: "cron",
				severity: started ? "info" : cronRun.status === "ok" ? "success" : "error",
				title: started ? `${cronRun.jobName}: run started` : `${cronRun.jobName}: run ${cronRun.status}`,
				detail: started
					? undefined
					: cronRun.error ?? (cronRun.delivery === "background" ? "Ran in a background session" : undefined),
				at: cronRun.startedAt,
				sessionFile: cronRun.sessionFile,
				jobId: cronRun.jobId,
				runId: cronRun.id,
				running: started,
			});
			break;
		}
		case "office_huddle": {
			// A huddle's full log (first contact or a reset after trimming).
			const payload = (event as import("./rpc").OfficeHuddleEvent).payload;
			useOfficeStore.getState().applyHuddle(payload);
			huddleCall.notifyHuddle(payload);
			break;
		}
		case "office_huddle_delta": {
			// Appended messages + live drive state; merge into the warm room.
			const delta = (event as import("./rpc").OfficeHuddleDeltaEvent).delta;
			useOfficeStore.getState().applyHuddleDelta(delta);
			huddleCall.notifyHuddleDelta(delta);
			break;
		}
		case "office_activity": {
			// Live coworker activity for the floor view.
			const activity = (event as import("./rpc").OfficeActivityEvent).activity;
			useOfficeStore.getState().applyActivity(activity);
			// Composer stop-reason parity: chime when a coworker's turn ends
			// naturally. Aborts (office Stop), in-session errors and retryable
			// failures stay quiet — the same suppression rules as agent_end.
			if (
				activity.kind === "turn_end" &&
				!activity.willRetry &&
				activity.stopReason !== "aborted" &&
				activity.stopReason !== "error"
			) {
				playOfficeTurnCompletionSound();
			}
			break;
		}
		case "oauth_login_status": {
			// OAuth sign-in progress from the engine (Account settings).
			// The engine is headless — the desktop owns browser opening.
			const oauth = event as import("./rpc").OAuthLoginEvent;
			if (oauth.phase === "browser" && oauth.url) {
				openExternalLink(oauth.url, { forceDefault: true });
			}
			if (oauth.phase === "error" && oauth.message) {
				toast.error("Sign-in failed", oauth.message);
			}
			if (oauth.phase === "success") {
				toast.success("Signed in", "Credentials saved to auth.json");
				void rpc.reloadAuth().catch(() => {});
			}
			window.dispatchEvent(new CustomEvent("a-coder:oauth-status", { detail: oauth }));
			break;
		}
		case "compaction_start":
			// Show the compacting state immediately. isCompacting only used
			// to sync via syncEngineState (connect / session switch), so a
			// mid-session manual /compact showed no progress in the UI.
			session.setIsCompacting(true);
			break;
		case "compaction_end": {
			session.setIsCompacting(false);
			const cmp = event as import("./rpc").CompactionEndEvent;
			if (!cmp.aborted && !cmp.willRetry && cmp.errorMessage) {
				// Manual /compact failures reject the routed rpc promise (see
				// commandRouter) and toast there; this covers auto-compaction
				// (threshold/overflow), which has no routed promise.
				toast.error("Compaction failed", cmp.errorMessage);
			}
			// Compaction changes the context size. Refresh stats and the
			// footer context-usage bar immediately so it doesn't stay stale.
			void refreshSessionStats();
			break;
		}
		case "session_start": {
			// The engine switched to a new or resumed session. Clear local state
			// and re-sync so the UI matches the authoritative session. While we
			// fetch history, ignore live message events so a streaming response
			// cannot race ahead and create an empty duplicate ahead of the
			// authoritative snapshot.
			resetAssistantStream();
			loadingHistoryRef.current = true;
			const generation = ++sessionStartGenerationRef.current;
			// Echoes deferred by an older switch belonged to that session. Clear
			// them at the start of this one so this chain's drain can never paint
			// an abandoned session's send into the session now being loaded
			// (the superseded chain drops its own share on exit).
			deferredUserEchoesRef.current = [];
			// Keep the previous transcript on screen under the loading state until
			// the target paints. `resetSession` clears it; restore it for the gap.
			const previousMessages = session.messages;
			session.resetSession();
			if (previousMessages.length > 0) session.setMessages(previousMessages);
			// Adopt identity from the event before the fetch resolves so frames for
			// this activation are not filtered and stale frames are.
			if (typeof event.activationId === "number") session.setActivationId(event.activationId);
			if (event.sessionFile) {
				session.setSessionFile(event.sessionFile);
				useSessionTranscriptsStore.getState().markRead(event.sessionFile);
				void dropBackgroundSubscription(event.sessionFile);
			}
			if (event.sessionId) session.setSessionId(event.sessionId);
			// History is loading — swap the EmptyState for a loading screen
			// until get_messages paints (or fails).
			session.setSessionLoading(true);
			void (async () => {
				// Stale-switch guard: bail before every paint if another
				// session_start landed while this fetch chain was in flight,
				// so a slow fetch from a previous session can never paint
				// its transcript over the newly selected one.
				const isCurrent = () => sessionStartGenerationRef.current === generation;
				try {
					await syncEngineState();
					if (!isCurrent()) return;
					// Warm-cache fast path: paint the cached transcript for the
					// target session immediately so switching back to a recently
					// visited session doesn't flash blank while history loads.
					const newSessionFile = useSessionStore.getState().sessionFile;
					const cached = newSessionFile ? getCachedSessionMessages(newSessionFile) : undefined;
					let painted = false;
					if (cached && cached.length > 0) {
						useSessionStore.getState().setMessages(cached);
						painted = true;
					}
					// Tree + history in flight together: the transcript is what the
					// user is waiting for, so it must never queue behind the tree
					// refresh's retry backoff. The tree applies whenever it lands.
					// Best-effort: the connect-time get_tree already populated it, so
					// a failure here is non-critical — retry silently and never nag.
					const treePromise = (async () => {
						for (let attempt = 0; attempt < 3; attempt++) {
							try {
								const treeRes = (await rpc.getTree(true)) as rpc.GetTreeResult;
								if (treeRes?.nodes || treeRes?.tree) return treeRes;
								return null;
							} catch (e) {
								console.warn("session_start get_tree attempt failed", attempt, e);
								if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
							}
						}
						return null;
					})();
					try {
						try {
							const msgsRes = (await rpc.getMessages({ limit: HISTORY_PAGE_SIZE })) as rpc.GetMessagesResult;
							if (!isCurrent()) return;
							if (msgsRes?.messages) {
								applyHistoryPage(msgsRes, "replace");
								painted = true;
								const sessionFile = useSessionStore.getState().sessionFile;
								if (sessionFile) setCachedSessionMessages(sessionFile, msgsRes.messages);
							}
						} catch (e) {
							if (isCurrent()) {
								// Never leave the previous session's transcript under a new
								// session's identity; the cache (if any) is the safe paint.
								if (!painted) useSessionStore.getState().setMessages([]);
								toast.error(
									"Failed to load messages after session start",
									e instanceof Error ? e.message : String(e),
								);
							}
						}
					} finally {
						// Drain deferred echoes for this switch BEFORE discarding stale
						// ones: user sends arriving while this chain was in flight are
						// merged into the store once, and a superseded chain (newer
						// session_start landed) still resets the ref so its old-session
						// echoes can never paint into the new session.
						const deferred = deferredUserEchoesRef.current;
						deferredUserEchoesRef.current = [];
						if (isCurrent()) {
							// Transcript settled (painted, failed, or stale). Latch off
							// FIRST (mirror the boot flow), then merge any echoes deferred
							// during the flight into one extra paint, then hand the chat
							// area back to EmptyState / the painted transcript. The tree
							// may still be in flight — it does not gate live messages.
							loadingHistoryRef.current = false;
							if (deferred.length > 0) {
								const store = useSessionStore.getState();
								store.setMessages(mergeUserEchoes(store.messages, deferred));
							}
							useSessionStore.getState().setSessionLoading(false);
						}
					}
					const treeRes = await treePromise;
					if (!isCurrent()) return;
					// A failed tree clears the previous session's structure rather
					// than showing it against the new session's messages.
					if (treeRes?.nodes) {
						useSessionTreeStore.getState().setFlatTree(treeRes.nodes, treeRes.leafId);
					} else if (treeRes?.tree) {
						useSessionTreeStore.getState().setTree(treeRes.tree, treeRes.leafId);
					} else {
						useSessionTreeStore.getState().setTree([], null);
					}
				} catch (e) {
					// syncEngineState (or any unexpected throw before the transcript
					// settled) must still release the latch — otherwise every later
					// send is swallowed exactly like the original switch bug.
					if (isCurrent()) {
						loadingHistoryRef.current = false;
						useSessionStore.getState().setSessionLoading(false);
					}
					console.error("session_start history load failed", e);
				}
			})();
			break;
		}
		case "session_info_changed":
			session.setSessionName(event.name ?? null);
			break;
		case "tree_delta":
			useSessionTreeStore.getState().applyTreeDelta(event);
			break;
		case "session_stats":
			applySessionStats(event.stats as unknown as StatsPayload);
			break;
		case "session_changed":
			window.dispatchEvent(new CustomEvent("a-coder:sessions-changed", { detail: event }));
			break;
		case "message_delta":
			if (loadingHistoryRef.current) break;
			applyAssistantDelta(event);
			break;
		case "message_snapshot":
			if (loadingHistoryRef.current) break;
			applyAssistantSnapshot(event);
			break;
		case "message_start":
			if (loadingHistoryRef.current) {
				// Defer, don't drop: a first send inside the boot window echoes
				// while the history fetch is in flight; discarding it loses the
				// row until a tab switch or restart refetches. The boot flow
				// drains this into the fetched snapshot (mergeUserEchoes).
				if (event.message.role === "user") deferredUserEchoesRef.current.push(event.message);
				break;
			}
			if (event.message.role === "user") {
				// Avoid double-appending the same user message if the engine echoes it
				// after it was already injected by the composer.
				const messages = useSessionStore.getState().messages;
				const userText = getUserMessageText(
					event.message as import("@earendil-works/pi-ai").UserMessage,
				);
				const isDuplicateUser = messages.some(
					(m) =>
						m.role === "user" &&
						getUserMessageText(m as import("@earendil-works/pi-ai").UserMessage) ===
							userText,
				);
				if (!isDuplicateUser) {
					session.appendMessage(event.message);
					cacheCurrentTranscript();
					// Name new sessions from the first non-trivial user message.
					if (!useSessionStore.getState().sessionName) {
						const autoName = deriveSessionName(userText);
						if (autoName) void rpc.setSessionName(autoName);
					}
				}
			}
			// Assistant messages are created on the first content update so we
			// don't show an empty avatar-only row before the model starts streaming.
			// Contract 2: seed the delta draft now; commits are frame-coalesced.
			if (event.message.role === "assistant") {
				const messageId = (event as { messageId?: string }).messageId;
				if (messageId) startAssistantStream(event.message, messageId);
			}
			break;
		case "message_update":
		case "message_end":
			if (loadingHistoryRef.current) break;
			if (event.message.role === "assistant") {
				voiceCall.notifyAssistantMessage(event.message);
				if (event.type === "message_end") {
					noticeForRunError(event.message);
					resetAssistantStream();
					session.commitAssistantMessage(event.message);
				} else {
					// Contract-1 full snapshots: keep them in the streaming slice so
					// the committed transcript is only written on message_end.
					assistantStream = {
						messageId: (event as { messageId?: string }).messageId ?? "legacy",
						message: cloneAssistantMessage(event.message),
					};
					session.setStreamingMessage(cloneAssistantMessage(event.message));
				}
				maybeRevealBrowserPanel(event.message);
			} else if (event.message.role === "toolResult") {
				if (event.type === "message_end") noticeForToolError(event.message);
				// Append or replace an existing tool result with the same id so streaming
				// tool output stays visible without duplicating final results.
				const messages = useSessionStore.getState().messages;
				const id = (event.message as import("@earendil-works/pi-ai").ToolResultMessage).toolCallId;
				const existingIndex = messages.findLastIndex(
					(m) => m.role === "toolResult" && (m as import("@earendil-works/pi-ai").ToolResultMessage).toolCallId === id,
				);
				if (existingIndex >= 0) {
					useSessionStore.getState().setMessages([
						...messages.slice(0, existingIndex),
						event.message,
						...messages.slice(existingIndex + 1),
					]);
				} else {
					session.appendMessage(event.message);
				}
			}
			cacheCurrentTranscript();
			break;
		case "queue_update":
			session.updateQueue(event.steering ?? [], event.followUp ?? []);
			break;
		case "subagents_update": {
			const sub = event as import("./rpc").SubagentsUpdateEvent;
			session.setSubAgents(sub.agents ?? []);
			break;
		}
		case "background_processes_update": {
			const upd = event as import("./rpc").BackgroundProcessesUpdateEvent;
			session.setBackgroundProcesses(upd.processes ?? []);
			break;
		}
		case "workflows_update": {
			const upd = event as import("./rpc").WorkflowsUpdateEvent;
			session.setWorkflowRuns(upd.runs ?? []);
			break;
		}
		case "extension_ui_request": {
			const req = event as import("./rpc").ExtensionUiRequestEvent;

			// Tool approvals surface in the activity inbox so they're
			// visible even when this session isn't the focused tab.
			if (req.method === "confirm" && "kind" in req && req.kind === "permission") {
				const approvalSession = "sessionFile" in req ? req.sessionFile : undefined;
				useActivityStore.getState().add({
					kind: "approval",
					severity: "action",
					title: req.toolName ? `Approval needed: ${req.toolName}` : "Approval needed",
					detail: "title" in req ? req.title : undefined,
					at: Date.now(),
					sessionFile: approvalSession ?? useSessionStore.getState().sessionFile ?? undefined,
				});
			}

			// Structured question dialog (ask_user_question tool).
			if (req.method === "question" && "questions" in req) {
				const q = req as import("./rpc").ExtensionUiRequestEvent & {
					questions: import("./rpc").UserQuestion[];
				};
				const requestSession = "sessionFile" in req ? req.sessionFile : undefined;
				// Read the ACTIVE session file from the store, not a captured value:
				// the caller registers this pipeline before any session_start sets
				// sessionFile, so a captured value is stale (null). A request for a
				// background session is parked and promoted on activation.
				const currentSessionFile = useSessionStore.getState().sessionFile;
				if (requestSession && requestSession !== currentSessionFile) {
					parkedQuestionsRef.set(requestSession, { id: req.id, questions: q.questions });
				} else {
					session.setQuestionRequest({ id: req.id, questions: q.questions });
				}
				break;
			}

			// Fire-and-forget extension UI methods: no response required.
			if (req.method === "notify") {
				const kind = (req.notifyType ?? "info") as "info" | "success" | "warning" | "error";
				toast[kind in toast ? kind : "info"](req.message ?? "Notification");
				break;
			}
			if (req.method === "setStatus") {
				useWidgetStore.getState().setStatus(req.statusKey, req.statusText);
				break;
			}
			if (req.method === "setWidget") {
				useWidgetStore.getState().setWidget(req.widgetKey, req.widgetLines, req.widgetPlacement ?? "belowEditor");
				break;
			}
			if (req.method === "setTitle") {
				document.title = req.title;
				break;
			}
			if (req.method === "set_editor_text") {
				window.dispatchEvent(
					new CustomEvent("a-coder:set-editor-text", { detail: { text: req.text } }),
				);
				break;
			}

			const hasDialog =
				req.method === "confirm" ||
				req.method === "select" ||
				req.method === "input" ||
				req.method === "editor";
			if (!hasDialog || !("title" in req)) {
				// Cancel unsupported UI requests so the engine is unblocked.
				void rpc.sendUiResponse({
					type: "extension_ui_response",
					id: (req as import("./rpc").ExtensionUiRequestEvent).id,
					cancelled: true as const,
				});
				break;
			}
			session.addUiRequest({
				id: req.id,
				method: req.method as UiRequestMethod,
				title: req.title,
				message: "message" in req ? req.message : undefined,
				options: "options" in req ? req.options : undefined,
				placeholder: "placeholder" in req ? req.placeholder : undefined,
				prefill: "prefill" in req ? req.prefill : undefined,
				kind: "kind" in req ? req.kind : undefined,
				toolName: "toolName" in req ? req.toolName : undefined,
				workflow:
					"workflow" in req && req.workflow
						? { name: req.workflow.name, phases: req.workflow.phases }
						: undefined,
				sessionFile: "sessionFile" in req ? req.sessionFile : undefined,
			}).then((response) => {
				const cancelled = response.cancelled === true;
				const res: import("./rpc").ExtensionUiResponse = cancelled
					? { type: "extension_ui_response", id: req.id, cancelled: true as const }
					: "value" in response
						? { type: "extension_ui_response", id: req.id, value: response.value ?? "" }
						: { type: "extension_ui_response", id: req.id, confirmed: response.confirmed ?? false };
				rpc.sendUiResponse(res).catch(() => {
					// A dropped response leaves the agent blocked on a prompt
					// nobody can answer — surface it instead of failing silently.
					toast.error(
						"Response not delivered",
						"The engine is not running, so the agent never received this response. Restart the engine and resend.",
					);
				});
			});
			break;
		}
	}
}
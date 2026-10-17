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

import * as rpc from "./rpc";
import { openExternalLink } from "./external-link";
import { playCompletionSound } from "./completion-sound";
import { playAudioBlob, synthesize, type VoiceSettings } from "./voice";
import { triggerHaptic } from "./haptics";
import { pickLoadingVerb } from "./loading-verbs";
import { getCachedSessionMessages, setCachedSessionMessages } from "./session-cache";
import { toast } from "../stores/toast-store";
import { voiceCall, useVoiceCallStore } from "./voice-call";
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
import { useWidgetStore } from "../stores/widget-store";

/** Per-window state the pipeline drives through (refs live in the window). */
export interface AgentEventDeps {
	/** True while authoritative history is loading: live message events yield. */
	loadingHistoryRef: { current: boolean };
	/** Monotonic guard so a slow session-switch fetch can't paint stale data. */
	sessionStartGenerationRef: { current: number };
	/** Questions parked for background sessions, promoted on activation. */
	parkedQuestionsRef: Map<string, QuestionUiRequest>;
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
		const blob = await synthesize(text, settings);
		playAudioBlob(blob);
	} catch (e) {
		console.warn("TTS failed", e);
	}
}

function getUserMessageText(message: import("@earendil-works/pi-ai").UserMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((c) => (c.type === "text" ? c.text : "")).join("");
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

/** Pull stats and paint them — mirrors App's old applySessionStats exactly
 *  (stats store + the footer context-usage bar). */
async function refreshSessionStats(): Promise<void> {
	try {
		const statsRes = (await rpc.sendCommand({ type: "get_session_stats" })) as SessionStats & {
			contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
		};
		if (!statsRes) return;
		useStatsStore.getState().setStats(statsRes);
		if (statsRes.contextUsage && statsRes.contextUsage.contextWindow > 0) {
			useSessionStore.getState().setContextUsage({
				tokens: statsRes.contextUsage.tokens ?? null,
				contextWindow: statsRes.contextUsage.contextWindow,
				percent: statsRes.contextUsage.percent ?? null,
			});
		}
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

/** When the agent reaches for a desktop-browser tool (browser_* toolCall
 *  block) and the right rail isn't showing the browser panel, bring the
 *  panel forward — the hand-off should feel automatic, like the agent just
 *  pulled the browser out. A new tool call re-reveals; the same call's
 *  streamed updates don't. */
function maybeRevealBrowserPanel(message: { role: string; content?: unknown }): void {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return;
	for (const block of message.content as Array<Record<string, unknown>>) {
		if (block?.type !== "toolCall") continue;
		const id = typeof block.id === "string" ? block.id : "";
		if (!id || id === lastBrowserToolId) continue;
		const name = typeof block.name === "string" ? block.name : "";
		if (!name.startsWith("browser_")) continue;
		lastBrowserToolId = id;
		const ui = useUiStore.getState();
		if (ui.rightSidebarTab !== "browser") ui.setRightSidebarTab("browser");
	}
}

export function processAgentEvent(event: rpc.RpcEvent, deps: AgentEventDeps): void {
	const { loadingHistoryRef, sessionStartGenerationRef, parkedQuestionsRef, syncEngineState } = deps;
	const session = useSessionStore.getState();

	switch (event.type) {
		case "engine_info": {
			// Engine/client skew guard: the engine's first event names its
			// protocol contract. Missing event = legacy engine = contract 1.
			if (event.contract !== rpc.ENGINE_RPC_CONTRACT) {
				const newer = event.contract > rpc.ENGINE_RPC_CONTRACT;
				toast.warning(
					newer ? "Engine newer than this app" : "Engine older than this app",
					`The CLI engine (v${event.version}) speaks protocol contract ${event.contract}; this app expects ${rpc.ENGINE_RPC_CONTRACT}. Update the ${newer ? "app" : "CLI"}.`,
				);
			}
			break;
		}
		case "agent_start":
			session.setIsStreaming(true);
			session.setStreamingVerb(pickLoadingVerb());
			// A new turn started — forget any abort the user requested
			// during the previous turn.
			session.setAbortRequested(false);
			triggerHaptic("streamStart");
			voiceCall.notifyAgentStart();
			break;
		case "agent_end":
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
				const text = "messages" in event ? lastAssistantText((event as { messages: AgentMessage[] }).messages) : "";
				voiceCall.notifyAgentEnd(text);
			} else {
				playCompletionSound();
				// Voice mode: read the final assistant reply aloud.
				const voice = useSettingsStore.getState();
				if (voice.voiceEnabled && voice.voiceAutoSpeak && "messages" in event) {
					const text = lastAssistantText((event as { messages: AgentMessage[] }).messages);
					if (text) void speakReply(text);
				}
			}
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
		case "thinking_level_changed":
			// The engine can change the thinking level itself (the `/think`
			// command, /think cycling, or thinking-keyword escalation like
			// "ultrathink"). Keep the status bar in sync.
			session.setThinkingLevel(event.level);
			break;
		case "sessions_update":
			// Runtime registry changed (background session detaching,
			// background turn started/finished, or reaped).
			useRuntimeStatusStore.getState().update(event.sessions, useTabsStore.getState().activePath);
			break;
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
		case "office_huddle":
			// A huddle's log changed.
			useOfficeStore.getState().applyHuddle(
				(event as import("./rpc").OfficeHuddleEvent).payload,
			);
			break;
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
				openExternalLink(oauth.url);
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
			loadingHistoryRef.current = true;
			const generation = ++sessionStartGenerationRef.current;
			session.resetSession();
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
					if (cached && cached.length > 0 && useSessionStore.getState().messages.length === 0) {
						useSessionStore.getState().setMessages(cached);
					}
					// Best-effort tree refresh after a session switch. The connect-time get_tree
					// already populated it, so a failure here is non-critical: retry silently
					// (a lost/delayed response usually succeeds on retry) and never nag.
					// If every retry fails, clear the stale tree rather than show the
					// previous session's structure against the new session's messages.
					let treeLoaded = false;
					for (let attempt = 0; attempt < 3; attempt++) {
						try {
							const treeRes = (await rpc.sendCommand({ type: "get_tree" })) as {
								tree: rpc.SessionTreeNode[];
								leafId: string | null;
							};
							if (treeRes?.tree) {
								useSessionTreeStore.getState().setTree(treeRes.tree, treeRes.leafId);
								treeLoaded = true;
							}
							break;
						} catch (e) {
							console.warn("session_start get_tree attempt failed", attempt, e);
							if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
						}
					}
					if (!isCurrent()) return;
					if (!treeLoaded) useSessionTreeStore.getState().setTree([], null);
					try {
						const msgsRes = (await rpc.sendCommand({ type: "get_messages" })) as {
							messages: import("@earendil-works/pi-agent-core").AgentMessage[];
						};
						if (!isCurrent()) return;
						if (msgsRes?.messages) {
							useSessionStore.getState().setMessages(msgsRes.messages);
							const sessionFile = useSessionStore.getState().sessionFile;
							if (sessionFile) setCachedSessionMessages(sessionFile, msgsRes.messages);
						}
					} catch (e) {
						if (isCurrent()) {
							toast.error(
								"Failed to load messages after session start",
								e instanceof Error ? e.message : String(e),
							);
						}
					}
				} finally {
					if (isCurrent()) {
						// History load finished (painted, failed, or stale) — hand the
						// chat area back to EmptyState / the painted transcript.
						useSessionStore.getState().setSessionLoading(false);
					}
				}
			})();
			break;
		}
		case "session_info_changed":
			session.setSessionName(event.name ?? null);
			break;
		case "message_start":
			if (loadingHistoryRef.current) break;
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
					// Name new sessions from the first non-trivial user message.
					if (!useSessionStore.getState().sessionName) {
						const autoName = deriveSessionName(userText);
						if (autoName) void rpc.setSessionName(autoName);
					}
				}
			}
			// Assistant messages are created on the first content update so we
			// don't show an empty avatar-only row before the model starts streaming.
			break;
		case "message_update":
		case "message_end":
			if (loadingHistoryRef.current) break;
			if (event.message.role === "assistant") {
				voiceCall.notifyAssistantMessage(event.message);
				maybeRevealBrowserPanel(event.message);
				const messages = useSessionStore.getState().messages;
				const hasAssistantRow = messages.length > 0 && messages[messages.length - 1].role === "assistant";
				if (hasAssistantRow) {
					session.updateLastAssistantMessage(event.message);
				} else if (hasAssistantContent(event.message)) {
					session.appendMessage(event.message);
				}
			} else if (event.message.role === "toolResult") {
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
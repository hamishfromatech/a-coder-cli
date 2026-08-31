import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronsUpDown, FolderGit2, MessageSquare, Plus, Settings, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as rpc from "./lib/rpc";
import { playCompletionSound } from "./lib/completion-sound";
import { triggerHaptic } from "./lib/haptics";
import { rafCoalesce } from "./lib/raf-coalesce";
import { synthesize, playAudioBlob, type VoiceSettings } from "./lib/voice";
import { pickLoadingVerb } from "./lib/loading-verbs";
import { getCachedSessionMessages, setCachedSessionMessages } from "./lib/session-cache";
import { useRuntimeStatusStore } from "./stores/runtime-status-store";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { useSessionStore, type QuestionUiRequest } from "./stores/session-store";
import { useSettingsStore } from "./stores/settings-store";
import { useWorkspaceStore } from "./stores/workspace-store";
import { useSessionTreeStore } from "./stores/session-tree-store";
import { useTabsStore } from "./stores/tabs-store";
import { useStatsStore, type SessionStats } from "./stores/stats-store";
import { useUiStore } from "./stores/ui-store";
import { useWidgetStore } from "./stores/widget-store";
import { useUpdateStore } from "./stores/update-store";
import { toast } from "./stores/toast-store";
import { applyNamedTheme } from "./lib/themes";
import { useGlobalKeybindings } from "./hooks/useGlobalKeybindings";
import { useClosedTabsStore } from "./stores/closed-tabs-store";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { BrandMark } from "./components/ui/BrandMark";
import { Loader } from "./components/ui/Loader";
import { ChangelogModal } from "./components/ChangelogModal";
import { ChatBackdrop } from "./components/ChatBackdrop";
import { CommandCenter } from "./components/CommandCenter";
import { CommandPalette, type CommandItem } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { FindBar } from "./components/FindBar";
import { HomeDashboard } from "./components/HomeDashboard";
import { AppsPanel } from "./components/AppsPanel";
import { MessageList } from "./components/MessageList";
import { MemoryModal } from "./components/MemoryModal";
import { ModelPicker } from "./components/ModelPicker";
import { OnboardingModal } from "./components/OnboardingModal";
import { ProjectPicker } from "./components/ProjectPicker";
import { RightSidebar } from "./components/RightSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { TodoPanel } from "./components/TodoPanel";
import { TaskPanel } from "./components/TaskPanel";
import { SessionActions, Toolbar } from "./components/Toolbar";
import { SessionPicker } from "./components/SessionPicker";
import { SessionTabs } from "./components/SessionTabs";
import { SessionTree } from "./components/SessionTree";
import { SidebarProjects } from "./components/SidebarProjects";
import { StatusBar } from "./components/StatusBar";
import { Titlebar } from "./components/Titlebar";
import { SubagentPanel } from "./components/SubagentPanel";
import { TeammateViewer } from "./components/TeammateViewer";
import { Toaster } from "./components/Toaster";
import { UpdateModal } from "./components/UpdateModal";
import { ApprovalModal } from "./components/panels/ApprovalModal";
import { ToolApprovalBar } from "./components/ToolApprovalBar";
import { ConnectingOverlay } from "./components/ConnectingOverlay";

const FALLBACK_CWD = "";

const ONBOARDING_FLAG = "onboarding-complete";

function isOnboardingComplete(): boolean {
	try {
		return localStorage.getItem(ONBOARDING_FLAG) === "true";
	} catch {
		return false;
	}
}

/** Extract the text of the last assistant message in a run (for voice mode). */
function lastAssistantText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
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

export default function App() {
	const [showProjectPicker, setShowProjectPicker] = useState(false);
	const [showResume, setShowResume] = useState(false);
	const [showModelPicker, setShowModelPicker] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [showFindBar, setShowFindBar] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [showCommandCenter, setShowCommandCenter] = useState(false);
	const [showHome, setShowHome] = useState(false);
	const [showApps, setShowApps] = useState(false);
	const [showSubagents, setShowSubagents] = useState(false);
	const [showTeams, setShowTeams] = useState(false);
	// Session-scoped question dialogs (Phase 2): a question asked by a
	// background session is parked under its session file and promoted when
	// that session becomes active. The currently-shown question is stashed
	// back when the user switches away. The active request lives in the
	// session store so the inline AskUserQuestionCard on the pending tool row
	// can read and resolve it (hermes-style inline card, not a modal).
	const parkedQuestionsRef = useRef<Map<string, QuestionUiRequest>>(new Map());
	const shownQuestionSessionRef = useRef<string | null | undefined>(undefined);
	const [showHotkeys, setShowHotkeys] = useState(false);
	const [showChangelog, setShowChangelog] = useState(false);
	const [showMemory, setShowMemory] = useState(false);
	const [showOnboarding, setShowOnboarding] = useState(() => !isOnboardingComplete());
	const [trustPrompt, setTrustPrompt] = useState<string | null>(null);
	// Gate first connect on the initial-workspace lookup so a `pi --desktop`
	// launch preselects the terminal's folder before the engine boots.
	const [bootReady, setBootReady] = useState(false);
	const unlistenRef = useRef<(() => void) | null>(null);
	const switchProjectRef = useRef<(path: string) => void>(() => {});
	const loadingHistoryRef = useRef(false);
	/** Increments on every session_start. Async history loads compare their
	 *  generation before painting, so a slow fetch from a previous session can
	 *  never paint over a newer switch (the A→B cross-paint bug hermes guards
	 *  with resume request ids). */
	const sessionStartGenerationRef = useRef(0);
	const {
		setStatus,
		setCwd,
		setModel,
		setThinkingLevel,
		setPermissionMode,
		setSessionName,
		setSessionId,
		setSessionFile,
		setIsStreaming,
		setIsCompacting,
		setAutoCompactionEnabled,
		setSteeringMode,
		setFollowUpMode,
		setStreamingVerb,
		setMessageCount,
		setPendingMessageCount,
		setContextUsage,
		setAvailableCommands,
		appendMessage,
		setMessages,
		updateLastAssistantMessage,
		updateQueue,
		resetSession,
		uiRequests,
		addUiRequest,
		resolveUiRequest,
		approvalInlineVisible,
	} = useSessionStore();
	// Tool approvals (kind === "permission") render as an inline bar in the
	// transcript (with a floating fallback above the composer when that row is
	// scrolled out of view). Everything else (select/input/editor and generic
	// extension confirms) still uses the modal.
	// Session-scoped routing (Phase 2): requests for other sessions stay queued
	// until that session is active; the runtime-status orb already signals them.
	const requestIsForCurrentSession = (r: { sessionFile?: string }) =>
		!r.sessionFile || r.sessionFile === sessionFile;
	const permissionRequest = uiRequests.find((r) => r.kind === "permission" && requestIsForCurrentSession(r));
	const modalRequest = uiRequests.find((r) => r.kind !== "permission" && requestIsForCurrentSession(r));
	const { cliPath, theme, skin, reopenLastProject, startupModel, cliGlobalSettings } =
		useSettingsStore();
	const { setStatus: setWidgetStatus, setWidget } = useWidgetStore();
	const updateRuntimeStatus = useRuntimeStatusStore((s) => s.update);
	const markRuntimeVisited = useRuntimeStatusStore((s) => s.markVisited);
	useGlobalKeybindings();
	const { status: updateStatus, update: availableUpdate, dismiss: dismissUpdate } = useUpdateStore();
	const updateCheckedRef = useRef(false);
	useUpdateCheck({
		onAvailable: (version) => {
			// Only toast on the first automatic check; manual checks via the menu
			// already show the modal, so we don't want a duplicate notification.
			if (!updateCheckedRef.current) {
				updateCheckedRef.current = true;
				return;
			}
			toast.info("Update available", `Version ${version} is ready to install.`);
		},
		onUpToDate: () => {
			// Only toast when this was a manual check (after the initial auto-check).
			if (updateCheckedRef.current) {
				toast.success("You're up to date", "A-Coder Desktop is on the latest version.");
			}
			updateCheckedRef.current = true;
		},
		onError: () => {
			if (updateCheckedRef.current) {
				toast.warning("Couldn't check for updates", "Please try again later.");
			}
			updateCheckedRef.current = true;
		},
	});
	const { current: projectPath, setCurrent: setProjectPath } = useWorkspaceStore();
	const { setTree } = useSessionTreeStore();
	const openTab = useTabsStore((s) => s.openTab);
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const sessionName = useSessionStore((s) => s.sessionName);
	const { setStats } = useStatsStore();

	// Apply a get_session_stats response to both the stats store and the
	// session store's context-usage bar. The engine reports contextUsage as
	// tokens/contextWindow/percent, and after compaction it may report
	// tokens/percent as null until the next assistant response.
	const applySessionStats = useCallback(
		(stats: SessionStats & { contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } }) => {
			setStats(stats);
			if (stats.contextUsage && stats.contextUsage.contextWindow > 0) {
				setContextUsage({
					tokens: stats.contextUsage.tokens ?? null,
					contextWindow: stats.contextUsage.contextWindow,
					percent: stats.contextUsage.percent ?? null,
				});
			}
		},
		[setStats, setContextUsage],
	);
	const { leftSidebarOpen, setLeftSidebarOpen, rightSidebarOpen, setRightSidebarOpen, rightSidebarWidth } = useUiStore();
	const effectiveCwd = projectPath || FALLBACK_CWD;

	// Apply theme class to the document root. Applies live (skin/mode changes
	// from the settings panel) and after the engine loads cliGlobalSettings.theme,
	// without re-running connectEngine (which would reconnect the backend).
	const resolvedTheme = (cliGlobalSettings.theme as import("./stores/settings-store").Theme) ?? theme;
	useEffect(() => {
		applyNamedTheme(skin, resolvedTheme);
	}, [skin, resolvedTheme]);

	// Resolve a workspace preselected by the `pi --desktop` CLI launcher
	// (A_CODER_DESKTOP_WORKSPACE) and apply it before booting the engine so the
	// terminal's folder opens directly, skipping the project picker. Runs once.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			let ws: string | null = null;
			try {
				ws = await rpc.getInitialWorkspace();
			} catch {
				// best-effort: fall back to persisted project / picker
			}
			if (cancelled) return;
			if (ws) setProjectPath(ws);
			setBootReady(true);
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// AudioContext priming is now handled in main.tsx on the first user gesture
	// so completion chimes and haptic click synthesis can fire automatically.

	// Reusable: pull the authoritative engine state into the session store.
	// Covers model, thinking, permission, compaction, queue modes, counts, and
	// session identity. Also derives a context-usage estimate from stats.
	const syncEngineState = useCallback(async () => {
		try {
			const s = (await rpc.sendCommand({ type: "get_state" })) as {
				model?: { provider: string; id: string; name?: string };
				thinkingLevel?: string;
				permissionMode?: import("./stores/session-store").PermissionMode;
				sessionName?: string;
				sessionId?: string;
				sessionFile?: string;
				isCompacting?: boolean;
				autoCompactionEnabled?: boolean;
				steeringMode?: import("./lib/settings.types").MessageDeliveryMode;
				followUpMode?: import("./lib/settings.types").MessageDeliveryMode;
				messageCount?: number;
				pendingMessageCount?: number;
			};
			if (s?.model) setModel(s.model as never);
			if (s?.thinkingLevel) setThinkingLevel(s.thinkingLevel);
			if (s?.permissionMode) setPermissionMode(s.permissionMode);
			if (s?.sessionName) setSessionName(s.sessionName);
			if (s?.sessionId) setSessionId(s.sessionId);
			setSessionFile(s?.sessionFile ?? null);
			setIsCompacting(s?.isCompacting ?? false);
			setAutoCompactionEnabled(s?.autoCompactionEnabled ?? true);
			if (s?.steeringMode) setSteeringMode(s.steeringMode);
			if (s?.followUpMode) setFollowUpMode(s.followUpMode);
			if (typeof s?.messageCount === "number") setMessageCount(s.messageCount);
			if (typeof s?.pendingMessageCount === "number")
				setPendingMessageCount(s.pendingMessageCount);
			// Derive context usage from the latest stats. The engine computes
			// contextUsage (tokens / contextWindow / percent) from the active
			// model's real context window — which for Ollama is discovered from
			// /api/show rather than the 128k catalog default.
			try {
				const stats = (await rpc.sendCommand({ type: "get_session_stats" })) as SessionStats & {
					contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
				};
				if (stats) applySessionStats(stats);
			} catch {
				// stats are best-effort
			}
		} catch (e) {
			toast.warning("Failed to sync engine state", e instanceof Error ? e.message : String(e));
		}
	}, [
		setModel,
		setThinkingLevel,
		setPermissionMode,
		setSessionName,
		setSessionId,
		setSessionFile,
		setIsCompacting,
		setAutoCompactionEnabled,
		setSteeringMode,
		setFollowUpMode,
		setMessageCount,
		setPendingMessageCount,
		applySessionStats,
	]);

	const connectEngine = useCallback(
		async (targetCwd: string, options?: { cliPath?: string; continueSession?: boolean }) => {
			setStatus("connecting");
			try {
				await rpc.connect({
					cwd: targetCwd,
					cliPath: options?.cliPath || cliPath || undefined,
					provider: startupModel?.provider,
					model: startupModel?.id,
					continueSession: options?.continueSession,
				});
				setStatus("connected");
				setCwd(targetCwd);

				// Sync the full engine state and prompt for trust if needed.
				// Theme is applied by a dedicated effect (see resolvedTheme) — not here,
				// to avoid re-creating connectEngine and reconnecting the backend
				// whenever the appearance changes.
				await syncEngineState();
				try {
					const trusted = await rpc.getProjectTrust(targetCwd);
					if (!trusted) setTrustPrompt(targetCwd);
				} catch {
					// trust check is best-effort
				}

				// Load session tree.
				try {
					const treeRes = (await rpc.sendCommand({ type: "get_tree" })) as {
						tree: rpc.SessionTreeNode[];
						leafId: string | null;
					};
					if (treeRes?.tree) setTree(treeRes.tree, treeRes.leafId);
				} catch (e) {
					toast.error("Failed to load session tree", e instanceof Error ? e.message : String(e));
				}

				// Load the active session's messages. When launched with --continue
				// (project switch / reconnect) this is the resumed session's history;
				// on a fresh launch it's empty. The initial session_start event is
				// not forwarded to subscribers, so we fetch the history ourselves.
				loadingHistoryRef.current = true;
				try {
					const msgsRes = (await rpc.sendCommand({ type: "get_messages" })) as {
						messages: import("@earendil-works/pi-agent-core").AgentMessage[];
					};
					if (msgsRes?.messages) {
						setMessages(msgsRes.messages);
					}
				} catch (e) {
					toast.error("Failed to load session history", e instanceof Error ? e.message : String(e));
				} finally {
					loadingHistoryRef.current = false;
				}

				// Load available slash commands.
				try {
					const cmdsRes = await rpc.getCommands();
					setAvailableCommands(cmdsRes.commands ?? []);
				} catch (e) {
					toast.error("Failed to load slash commands", e instanceof Error ? e.message : String(e));
				}

				const unlisten = await rpc.onRpcEvent((event) => {
					if ("type" in event === false) return;
					switch (event.type) {
						case "agent_start":
							setIsStreaming(true);
							setStreamingVerb(pickLoadingVerb());
							// A new turn started — forget any abort the user requested
							// during the previous turn.
							useSessionStore.getState().setAbortRequested(false);
							triggerHaptic("streamStart");
							break;
						case "agent_end":
							// A retryable failure re-enters the loop; stay streaming and suppress the
							// completion cue until the retry resolves.
							if ("willRetry" in event && event.willRetry) {
								break;
							}
							setIsStreaming(false);
							// Chime + haptic at the end of a natural turn. A user-initiated
							// abort also reaches agent_end, so suppress the cues then.
							if (!useSessionStore.getState().abortRequested) {
								playCompletionSound();
								triggerHaptic("streamDone");
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
							setThinkingLevel(event.level);
							break;
						case "sessions_update":
							// Runtime registry changed (background session detaching,
							// background turn started/finished, or reaped).
							updateRuntimeStatus(event.sessions, useTabsStore.getState().activePath);
							break;
						case "compaction_start":
							// Show the compacting state immediately. isCompacting only used
							// to sync via syncEngineState (connect / session switch), so a
							// mid-session manual /compact showed no progress in the UI.
							useSessionStore.getState().setIsCompacting(true);
							break;
						case "compaction_end": {
							useSessionStore.getState().setIsCompacting(false);
							const cmp = event as import("./lib/rpc").CompactionEndEvent;
							if (!cmp.aborted && !cmp.willRetry && cmp.errorMessage) {
								// Manual /compact failures reject the routed rpc promise (see
								// commandRouter) and toast there; this covers auto-compaction
								// (threshold/overflow), which has no routed promise.
								toast.error("Compaction failed", cmp.errorMessage);
							}
							// Compaction changes the context size. Refresh stats and the
							// footer context-usage bar immediately so it doesn't stay stale.
							void (async () => {
								try {
									const statsRes = (await rpc.sendCommand({ type: "get_session_stats" })) as SessionStats & {
										contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
									};
									if (statsRes) applySessionStats(statsRes);
								} catch (e) {
									console.error("Failed to refresh stats after compaction", e);
								}
							})();
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
							resetSession();
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
										setMessages(cached);
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
												setTree(treeRes.tree, treeRes.leafId);
												treeLoaded = true;
											}
											break;
										} catch (e) {
											console.warn("session_start get_tree attempt failed", attempt, e);
											if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
										}
									}
												if (!isCurrent()) return;
												if (!treeLoaded) setTree([], null);
												try {
													const msgsRes = (await rpc.sendCommand({ type: "get_messages" })) as {
														messages: import("@earendil-works/pi-agent-core").AgentMessage[];
													};
													if (!isCurrent()) return;
													if (msgsRes?.messages) {
														setMessages(msgsRes.messages);
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
													loadingHistoryRef.current = false;
												}
											}
							})();
							break;
						}
						case "session_info_changed":
							setSessionName(event.name ?? null);
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
									appendMessage(event.message);
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
								const messages = useSessionStore.getState().messages;
								const hasAssistantRow = messages.length > 0 && messages[messages.length - 1].role === "assistant";
								if (hasAssistantRow) {
									updateLastAssistantMessage(event.message);
								} else if (hasAssistantContent(event.message)) {
									appendMessage(event.message);
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
									setMessages([
										...messages.slice(0, existingIndex),
										event.message,
										...messages.slice(existingIndex + 1),
									]);
								} else {
									appendMessage(event.message);
								}
							}
							break;
						case "queue_update":
							updateQueue(event.steering ?? [], event.followUp ?? []);
							break;
						case "subagents_update": {
							const sub = event as import("./lib/rpc").SubagentsUpdateEvent;
							useSessionStore.getState().setSubAgents(sub.agents ?? []);
							break;
						}
						case "background_processes_update": {
							const upd = event as import("./lib/rpc").BackgroundProcessesUpdateEvent;
							useSessionStore.getState().setBackgroundProcesses(upd.processes ?? []);
							break;
						}
						case "extension_ui_request": {
							const req = event as import("./lib/rpc").ExtensionUiRequestEvent;

							// Structured question dialog (ask_user_question tool).
							if (req.method === "question" && "questions" in req) {
								const q = req as import("./lib/rpc").ExtensionUiRequestEvent & {
									questions: import("./lib/rpc").UserQuestion[];
								};
								const requestSession = "sessionFile" in req ? req.sessionFile : undefined;
								// Read the ACTIVE session file from the store, not the closure:
								// this listener is registered inside connectEngine, which is
								// memoised before any session_start sets sessionFile — the
								// closure value is stale (null), so comparing against it parked
								// every main-session request as "background" and the ask card
								// stayed read-only (options disabled).
								const currentSessionFile = useSessionStore.getState().sessionFile;
								if (requestSession && requestSession !== currentSessionFile) {
									// Background session — park it; promoted on activation.
									parkedQuestionsRef.current.set(requestSession, { id: req.id, questions: q.questions });
								} else {
									useSessionStore.getState().setQuestionRequest({ id: req.id, questions: q.questions });
								}
								break;
							}

							// Fire-and-forget extension UI methods: no response required.
							if (req.method === "notify") {
								const fn = toast[req.notifyType ?? "info"];
								fn(req.message ?? "Notification");
								break;
							}
							if (req.method === "setStatus") {
								setWidgetStatus(req.statusKey, req.statusText);
								break;
							}
							if (req.method === "setWidget") {
								setWidget(req.widgetKey, req.widgetLines, req.widgetPlacement ?? "belowEditor");
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
									id: (req as import("./lib/rpc").ExtensionUiRequestEvent).id,
									cancelled: true as const,
								});
								break;
							}
							addUiRequest({
								id: req.id,
								method: req.method as import("./stores/session-store").UiRequestMethod,
								title: req.title,
								message: "message" in req ? req.message : undefined,
								options: "options" in req ? req.options : undefined,
								placeholder: "placeholder" in req ? req.placeholder : undefined,
								prefill: "prefill" in req ? req.prefill : undefined,
							kind: "kind" in req ? req.kind : undefined,
							toolName: "toolName" in req ? req.toolName : undefined,
							sessionFile: "sessionFile" in req ? req.sessionFile : undefined,
							}).then((response) => {
								const cancelled = response.cancelled === true;
								const res: import("./lib/rpc").ExtensionUiResponse = cancelled
									? { type: "extension_ui_response", id: req.id, cancelled: true as const }
									: "value" in response
										? { type: "extension_ui_response", id: req.id, value: response.value ?? "" }
										: { type: "extension_ui_response", id: req.id, confirmed: response.confirmed ?? false };
								void rpc.sendUiResponse(res);
							});
							break;
						}
					}
				});
				unlistenRef.current = unlisten;

				// Refresh stats periodically.
				const statsInterval = setInterval(async () => {
					try {
						const statsRes = (await rpc.sendCommand({ type: "get_session_stats" })) as SessionStats & {
							contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
						};
						if (statsRes) applySessionStats(statsRes);
					} catch (e) {
						console.error("Failed to refresh stats", e);
					}
				}, 5000);
				unlistenRef.current = () => {
					unlisten();
					clearInterval(statsInterval);
				};
			} catch (e) {
				setStatus("error", e instanceof Error ? e.message : String(e));
			}
		},
		[
			cliPath,
			setStatus,
			setCwd,
			setModel,
			setThinkingLevel,
			setPermissionMode,
			setSessionName,
			setTree,
			setStats,
			setIsStreaming,
			setStreamingVerb,
			setAvailableCommands,
			appendMessage,
			setMessages,
			updateLastAssistantMessage,
			updateQueue,
			resetSession,
			syncEngineState,
			setWidgetStatus,
			setWidget,
		],
	);

	useEffect(() => {
		let cancelled = false;

			async function bootstrap() {
			if (cancelled) return;
			if (!bootReady) return; // Wait for the initial-workspace lookup
			if (showOnboarding) return; // Wait for onboarding to complete
			const startCwd = reopenLastProject ? effectiveCwd : FALLBACK_CWD;
			// Resume the most recent session for this project so past conversation
			// history loads on open (matches Hermes desktop). When there's no
			// project selected (empty cwd) we start a fresh session instead.
			await connectEngine(startCwd, {
				continueSession: reopenLastProject && effectiveCwd.length > 0,
			});
		}

		bootstrap();

		return () => {
			cancelled = true;
			unlistenRef.current?.();
			rpc.disconnect().catch(() => {});
		};
	}, [connectEngine, showOnboarding, reopenLastProject, effectiveCwd, bootReady]);

	// Listen for native menu actions.
	useEffect(() => {
		let unlisten: (() => void) | null = null;

		rpc.onMenuAction((action) => {
			switch (action) {
				case "new_session":
					void rpc.sendCommand({ type: "new_session" });
					break;
				case "compact":
					void rpc.sendCommand({ type: "compact" });
					break;
				case "abort":
					useSessionStore.getState().setAbortRequested(true);
					void rpc.sendCommand({ type: "abort" });
					break;
				case "settings":
					setShowSettings(true);
					break;
				case "project":
					setShowProjectPicker(true);
					break;
				case "resume":
					setShowResume(true);
					break;
				case "subagents":
					setShowSubagents(true);
					break;
				case "teams":
					setShowTeams(true);
					break;
				case "hotkeys":
					setShowHotkeys(true);
					break;
				case "changelog":
					setShowChangelog(true);
					break;
				case "reload":
					window.dispatchEvent(new CustomEvent("a-coder:reload"));
					break;
				case "check_updates":
					window.dispatchEvent(new CustomEvent("a-coder:check-updates"));
					break;
			}
		}).then((fn) => {
			unlisten = fn;
		});

		return () => {
			unlisten?.();
		};
	}, []);

	const handleSelectModel = async (m: { provider: string; id: string }) => {
		try {
			await rpc.sendCommand({ type: "set_model", provider: m.provider, modelId: m.id });
			setModel(m as never);
		} catch (e) {
			console.error(e);
		}
	};

	// Cross-component coordination for /settings, /reload, /quit, etc.
	useEffect(() => {
		const onOpenSettings = () => setShowSettings(true);
		const onOpenFindBar = () => setShowFindBar(true);
		const onOpenCommandPalette = () => setShowCommandPalette(true);
		const onOpenHome = () => setShowHome(true);
		const onOpenApps = () => setShowApps(true);
		const onReopenClosedTab = () => {
			const tab = useClosedTabsStore.getState().take();
			if (tab) {
				void rpc.switchSession(tab.sessionId).catch(() => {});
			}
			setShowHome(false);
			setShowResume(false);
		};
		const onOpenAccount = () => {
			setShowSettings(true);
			// Then navigate to the account section (handled by SettingsPanel via URL hash).
			window.location.hash = "account";
		};
		const onOpenModel = () => setShowModelPicker(true);
		const onOpenSession = () => setShowProjectPicker(true);
		const onSwitchProject = (e: Event) => {
			const detail = (e as CustomEvent).detail as { path?: string } | undefined;
			if (typeof detail?.path === "string" && detail.path) switchProjectRef.current(detail.path);
		};
		const onOpenResume = () => setShowResume(true);
		const onOpenSubagents = () => setShowSubagents(true);
		const onOpenTeams = () => setShowTeams(true);
		const onShowHotkeys = () => setShowHotkeys(true);
		const onShowChangelog = () => setShowChangelog(true);
		const onReload = async () => {
			try {
				const cmdsRes = await rpc.getCommands();
				setAvailableCommands(cmdsRes.commands ?? []);
			} catch (e) {
				console.error("reload commands failed", e);
			}
		};
		const onQuit = () => {
			void getCurrentWindow().close();
		};
		const onCheckUpdates = () => {
			window.dispatchEvent(new CustomEvent("a-coder:check-updates"));
		};

		window.addEventListener("a-coder:open-settings", onOpenSettings);
		window.addEventListener("a-coder:find-in-page", onOpenFindBar);
		window.addEventListener("a-coder:command-palette", onOpenCommandPalette);
		window.addEventListener("a-coder:open-home", onOpenHome);
		window.addEventListener("a-coder:open-apps", onOpenApps);
		window.addEventListener("a-coder:reopen-closed-tab", onReopenClosedTab);
		window.addEventListener("a-coder:open-account", onOpenAccount);
		window.addEventListener("a-coder:open-model-picker", onOpenModel);
		window.addEventListener("a-coder:open-session-picker", onOpenSession);
		window.addEventListener("a-coder:switch-project", onSwitchProject as EventListener);
		window.addEventListener("a-coder:open-resume", onOpenResume);
		window.addEventListener("a-coder:open-subagents", onOpenSubagents);
		window.addEventListener("a-coder:open-teams", onOpenTeams);
		window.addEventListener("a-coder:show-hotkeys", onShowHotkeys);
		window.addEventListener("a-coder:show-changelog", onShowChangelog);
		window.addEventListener("a-coder:reload", onReload);
		window.addEventListener("a-coder:quit", onQuit);
		window.addEventListener("a-coder:check-updates", onCheckUpdates);

		return () => {
			window.removeEventListener("a-coder:open-settings", onOpenSettings);
			window.removeEventListener("a-coder:find-in-page", onOpenFindBar);
			window.removeEventListener("a-coder:command-palette", onOpenCommandPalette);
		window.removeEventListener("a-coder:open-home", onOpenHome);
		window.removeEventListener("a-coder:open-apps", onOpenApps);
		window.removeEventListener("a-coder:reopen-closed-tab", onReopenClosedTab);
			window.removeEventListener("a-coder:open-account", onOpenAccount);
			window.removeEventListener("a-coder:open-model-picker", onOpenModel);
			window.removeEventListener("a-coder:open-session-picker", onOpenSession);
		window.removeEventListener("a-coder:switch-project", onSwitchProject as EventListener);
		window.removeEventListener("a-coder:open-resume", onOpenResume);
			window.removeEventListener("a-coder:open-subagents", onOpenSubagents);
			window.removeEventListener("a-coder:open-teams", onOpenTeams);
			window.removeEventListener("a-coder:show-hotkeys", onShowHotkeys);
			window.removeEventListener("a-coder:show-changelog", onShowChangelog);
			window.removeEventListener("a-coder:reload", onReload);
			window.removeEventListener("a-coder:quit", onQuit);
			window.removeEventListener("a-coder:check-updates", onCheckUpdates);
		};
	}, [setAvailableCommands]);

	// Push the current session onto the closed-tabs stack before switching.
	const pushCurrentToClosedTabs = useCallback(() => {
		const ss = useSessionStore.getState();
		if (ss.sessionId && ss.sessionName) {
			useClosedTabsStore.getState().push({
				sessionId: ss.sessionId,
				sessionName: ss.sessionName,
				projectPath: useWorkspaceStore.getState().current,
				closedAt: Date.now(),
			});
		}
	}, []);

	// Background-session attention: needs-input sessions take priority over
	// merely-finished ones. Both feed the sidebar rail's notification orb.
	const needsBackgroundInput = useRuntimeStatusStore((s) =>
		Object.entries(s.needsInput).some(([path, v]) => v && path !== sessionFile),
	);
	const hasBackgroundFinished = useRuntimeStatusStore((s) => Object.keys(s.finishedWhileAway).length > 0);
	const focusBackgroundSession = useCallback(() => {
		const status = useRuntimeStatusStore.getState();
		const needsInputPath = Object.entries(status.needsInput).find(([path, v]) => v && path !== sessionFile)?.[0];
		const target = needsInputPath ?? Object.keys(status.finishedWhileAway).find((p) => p !== sessionFile);
		if (!target) return;
		pushCurrentToClosedTabs();
		void rpc.switchSession(target).catch((e) =>
			toast.error("Failed to switch session", e instanceof Error ? e.message : String(e)),
		);
	}, [sessionFile, pushCurrentToClosedTabs]);

	const handleReconnect = useCallback(async () => {
		unlistenRef.current?.();
		unlistenRef.current = null;
		await rpc.disconnect().catch(() => {});
		await connectEngine(effectiveCwd, { continueSession: true });
	}, [connectEngine, effectiveCwd]);

	// Switch to a different project: update the store, drop the engine + open
	// session tabs (tabs are per-project), and reconnect against the new cwd.
	// Phase 3 multi-project: switching projects no longer restarts the engine.
	// The engine hosts runtimes for any cwd (its registry already carries
	// per-runtime services), so a project switch is a session switch: resume
	// that project's most recent session, or start a new session in it.
	const switchProject = useCallback(
		async (path: string) => {
			if (path === projectPath) return;
			setProjectPath(path);
			try {
				const trusted = await rpc.getProjectTrust(path);
				if (!trusted) setTrustPrompt(path);
			} catch {
				// trust check is best-effort
			}
			try {
				const res = await rpc.listSessions();
				const latest = (res.sessions ?? [])
					.filter((s) => s.cwd === path)
					.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())[0];
				if (latest) {
					pushCurrentToClosedTabs();
					await rpc.switchSession(latest.path);
				} else {
					await rpc.newSession(undefined, path);
				}
			} catch (e) {
				toast.error("Failed to switch project", e instanceof Error ? e.message : String(e));
			}
		},
		[setProjectPath, projectPath, pushCurrentToClosedTabs],
	);
	switchProjectRef.current = switchProject;

	// Keep the session tab strip in sync with the active session: open/update a
	// tab whenever the engine reports a session file (covers connect, resume,
	// new session, fork, and renames).
	useEffect(() => {
		if (sessionFile) openTab(sessionFile, sessionName ?? "Untitled session");
	}, [sessionFile, sessionName, openTab]);

	// A session the user switches to is no longer "finished while away".
	useEffect(() => {
		if (sessionFile) markRuntimeVisited(sessionFile);
	}, [sessionFile, markRuntimeVisited]);

	// Question dialogs follow their session: stash the shown one when leaving,
	// promote a parked one when arriving.
	useEffect(() => {
		const leavingSession = shownQuestionSessionRef.current;
		if (leavingSession !== undefined && leavingSession !== sessionFile) {
			const { questionRequest: current, setQuestionRequest } = useSessionStore.getState();
			if (current && leavingSession) parkedQuestionsRef.current.set(leavingSession, current);
			setQuestionRequest(parkedQuestionsRef.current.get(sessionFile ?? "") ?? null);
		}
		shownQuestionSessionRef.current = sessionFile;
	}, [sessionFile]);

	// Keep the warm per-session transcript cache in sync with the live store so
	// switching back to a recently visited session paints instantly. Skipped
	// while a history load is in flight — resetSession() briefly pairs the old
	// session file with an empty message list, and the authoritative fetch
	// re-populates the cache once it lands.
	const liveMessages = useSessionStore((s) => s.messages);
	useEffect(() => {
		if (sessionFile && !loadingHistoryRef.current) {
			setCachedSessionMessages(sessionFile, liveMessages);
		}
	}, [sessionFile, liveMessages]);

	const handleTrustAccept = async () => {
		if (!trustPrompt) return;
		try {
			await rpc.setProjectTrust(trustPrompt, true);
			toast.success("Project trusted", trustPrompt);
		} catch (e) {
			toast.error("Failed to trust project", e instanceof Error ? e.message : String(e));
		} finally {
			setTrustPrompt(null);
		}
	};

	const handleTrustDeny = async () => {
		if (!trustPrompt) return;
		try {
			await rpc.setProjectTrust(trustPrompt, false);
			toast.warning("Project not trusted", trustPrompt);
		} catch (e) {
			toast.error("Failed to set trust", e instanceof Error ? e.message : String(e));
		} finally {
			setTrustPrompt(null);
		}
	};

	const projectName = projectPath
		? (projectPath.split(/[/\\]/).filter(Boolean).at(-1) ?? projectPath)
		: "No project";

	// Build the command palette items from current app state.
	const commandItems = useMemo<CommandItem[]>(
		() => [
			{ id: "new-session", label: "New session", keybinding: "⌘N", group: "session", action: () => void rpc.sendCommand({ type: "new_session" }) },
			{ id: "abort", label: "Abort current turn", keybinding: "⌘.", group: "session", action: () => void rpc.sendCommand({ type: "abort" }) },
			{ id: "compact", label: "Compact context", group: "session", action: () => void rpc.sendCommand({ type: "compact" }) },
			{ id: "resume", label: "Resume another session", keybinding: "⇧⌘O", group: "session", action: () => setShowResume(true) },
			{ id: "model-picker", label: "Select model", keybinding: "⌘P", group: "navigate", action: () => setShowModelPicker(true) },
			{ id: "project-picker", label: "Open project", group: "navigate", action: () => setShowProjectPicker(true) },
			{ id: "find", label: "Find in page", keybinding: "⌘F", group: "navigate", action: () => setShowFindBar(true) },
			{ id: "home", label: "Open home dashboard", keybinding: "⇧⌘H", group: "navigate", action: () => setShowHome(true) },
			{ id: "apps", label: "Browse Composio apps", group: "tools", action: () => setShowApps(true) },
			{ id: "reopen-closed-tab", label: "Reopen closed session", keybinding: "⇧⌘T", group: "session", action: () => window.dispatchEvent(new CustomEvent("a-coder:reopen-closed-tab")) },
			{ id: "settings", label: "Open settings", keybinding: "⌘,", group: "settings", action: () => setShowSettings(true) },
			{ id: "hotkeys", label: "Show keyboard shortcuts", group: "settings", action: () => setShowHotkeys(true) },
			{ id: "changelog", label: "Show changelog", group: "settings", action: () => setShowChangelog(true) },
			{ id: "check-updates", label: "Check for updates", group: "settings", action: () => window.dispatchEvent(new CustomEvent("a-coder:check-updates")) },
			{ id: "subagents", label: "View sub-agents", group: "tools", action: () => setShowSubagents(true) },
			{ id: "teams", label: "View teams", group: "tools", action: () => setShowTeams(true) },
			{ id: "memory", label: "View memory", group: "tools", action: () => setShowMemory(true) },
			{ id: "command-center", label: "Open command center", group: "navigate", action: () => setShowCommandCenter(true) },
			{ id: "toggle-left-sidebar", label: leftSidebarOpen ? "Hide left sidebar" : "Show left sidebar", group: "view", action: () => setLeftSidebarOpen(!leftSidebarOpen) },
			{ id: "toggle-right-sidebar", label: rightSidebarOpen ? "Hide right sidebar" : "Show right sidebar", group: "view", action: () => setRightSidebarOpen(!rightSidebarOpen) },
		],
		[leftSidebarOpen, rightSidebarOpen, setLeftSidebarOpen, setRightSidebarOpen],
	);

	// Session list for the Command Center.
	const sessionList = useMemo(() => {
		const tree = useSessionTreeStore.getState();
		const sessions: Array<{ id: string; name: string; lastActive: number; messageCount: number }> = [];
		const walk = (nodes: typeof tree.tree) => {
			for (const node of nodes) {
				if (node.children.length > 0) walk(node.children);
				if (node.label) {
					sessions.push({
						id: node.id,
						name: node.label,
						lastActive: 0,
						messageCount: 0,
					});
				}
			}
		};
		walk(tree.tree);
		return sessions;
	}, []);

	// Projects list for the Home Dashboard.
	const recentProjects = useWorkspaceStore((s) => s.recentProjects);
	const homeProjects = useMemo(() => {
		return recentProjects.map((path) => ({
			path,
			name: path.split("/").pop() || path,
		}));
	}, [recentProjects]);

	// Sessions for the Home Dashboard (GroupableSession[]).
	const homeSessions = useMemo(() => {
		return sessionList.map((s) => ({
			id: s.id,
			name: s.name,
			lastActive: s.lastActive || Date.now(),
			projectPath: useWorkspaceStore.getState().current,
			projectName: useWorkspaceStore.getState().current.split("/").pop() || undefined,
		}));
	}, [sessionList]);

	// Usage stats for the Command Center.
	const statsState = useStatsStore((s) => s.stats);
	const usageStats = useMemo(() => {
		return {
			totalSessions: sessionList.length,
			totalApiCalls: statsState?.toolCalls ?? 0,
			totalInputTokens: statsState?.tokens?.input ?? 0,
			totalOutputTokens: statsState?.tokens?.output ?? 0,
		};
	}, [sessionList, statsState]);

	if (!bootReady) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-pi-bg text-pi-text">
				<div className="flex flex-col items-center gap-3">
					<Loader className="size-8" />
					<p className="text-sm text-pi-muted">Starting A-Coder Desktop…</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden bg-pi-bg text-pi-text">
			{/* ================== Startup loading screen ================== */}
			{!showOnboarding && <ConnectingOverlay pickerOpen={showProjectPicker} />}
			{/* ================== Custom titlebar ================== */}
			<Titlebar />

			{/* ================== Main row ================== */}
			<div className="flex min-h-0 flex-1">
				{/* ================== Left sidebar (pinned or hover rail) ================== */}
				{leftSidebarOpen ? (
					<aside className="flex shrink-0 flex-col border-r border-pi-border bg-pi-surface">
						<SidebarContent
							projectName={projectName}
							onPickProject={(path) => void switchProject(path)}
							onOpenPicker={() => setShowProjectPicker(true)}
							onOpenSettings={() => setShowSettings(true)}
							onCollapse={() => setLeftSidebarOpen(false)}
						/>
					</aside>
				) : (
					<SidebarRail
						projectName={projectName}
						onOpenPicker={() => setShowProjectPicker(true)}
						onOpenSettings={() => setShowSettings(true)}
						onExpand={() => setLeftSidebarOpen(true)}
						onPickProject={(path) => void switchProject(path)}
						needsBackgroundInput={needsBackgroundInput}
						hasBackgroundFinished={hasBackgroundFinished}
						onFocusBackground={focusBackgroundSession}
					/>
				)}

				{/* ================== Main column ================== */}
				<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<SessionTabs />
					<header className="flex h-11 shrink-0 items-center justify-between border-b border-pi-border bg-pi-bg/60 px-4 backdrop-blur">
						<Toolbar
							onShowModelPicker={() => setShowModelPicker(true)}
							onShowMemory={() => setShowMemory(true)}
						/>
					</header>

					<ChatContainer>
						<ChatBackdrop />
						<MessageList />
						<TodoPanel />
						<TaskPanel />
						{permissionRequest && !approvalInlineVisible && (
							<ToolApprovalBar request={permissionRequest} surface="floating" />
						)}
						<Composer />
					</ChatContainer>
					<StatusBar projectPath={projectPath} onReconnect={handleReconnect} />
				</main>

				{/* ================== Right sidebar (resizable drawer) ================== */}
				<ResizableRightSidebar
					open={rightSidebarOpen}
					width={rightSidebarWidth}
					projectPath={projectPath}
				/>
			</div>

			{/* ================== Toast notifications ================== */}
			<Toaster />

			{/* ================== Modals ================== */}
			{showOnboarding && (
				<OnboardingModal
					onComplete={(path) => {
						setProjectPath(path);
						setShowOnboarding(false);
					}}
				/>
			)}

			{showResume && (
				<SessionPicker
					onClose={() => setShowResume(false)}
					onResume={async (sessionPath) => {
						setShowResume(false);
						pushCurrentToClosedTabs();
						try {
							const result = await rpc.switchSession(sessionPath);
							if (result.reattached && result.snapshot?.running) {
								const store = useSessionStore.getState();
								if (!store.isStreaming) {
									store.setIsStreaming(true);
									store.setStreamingVerb(pickLoadingVerb());
								}
							}
						} catch (e) {
							toast.error("Failed to resume session", e instanceof Error ? e.message : String(e));
						}
						// The engine emits session_start after switching; the existing event
						// handler reloads messages/tree/state from the authoritative session.
					}}
				/>
			)}

			{showProjectPicker && (
				<ProjectPicker
						onClose={() => setShowProjectPicker(false)}
						onSelect={(path) => {
							setShowProjectPicker(false);
							void switchProject(path);
						}}
				/>
			)}

			{showModelPicker && (
				<ModelPicker
					onClose={() => setShowModelPicker(false)}
					onSelect={(m) => void handleSelectModel(m)}
				/>
			)}

			{showMemory && (
				<MemoryModal open={showMemory} onClose={() => setShowMemory(false)} />
			)}

			{showSettings && (
				<SettingsPanel onClose={() => setShowSettings(false)} />
			)}

			{modalRequest && (
				<ApprovalModal
					request={modalRequest}
					onResolve={(response) => resolveUiRequest(modalRequest.id, response)}
				/>
			)}

			<SubagentPanel open={showSubagents} onClose={() => setShowSubagents(false)} />
		<AppsPanel open={showApps} onClose={() => setShowApps(false)} />
			<TeammateViewer open={showTeams} onClose={() => setShowTeams(false)} />
			{trustPrompt && (
				<TrustModal
					cwd={trustPrompt}
					onAccept={handleTrustAccept}
					onDeny={handleTrustDeny}
					onClose={() => setTrustPrompt(null)}
				/>
			)}

			{showHotkeys && (
				<SimpleModal title="Keyboard shortcuts" onClose={() => setShowHotkeys(false)}>
					<div className="space-y-2 text-xs text-pi-text-secondary">
						<div className="flex justify-between"><span>New session</span><kbd className="font-mono">⌘N</kbd></div>
						<div className="flex justify-between"><span>Abort</span><kbd className="font-mono">⌘.</kbd></div>
						<div className="flex justify-between"><span>Settings</span><kbd className="font-mono">⌘,</kbd></div>
						<div className="flex justify-between"><span>Model picker</span><kbd className="font-mono">⌘P</kbd></div>
						<div className="flex justify-between"><span>Slash commands</span><kbd className="font-mono">/</kbd></div>
					</div>
				</SimpleModal>
			)}

			{showChangelog && (
				<ChangelogModal open={showChangelog} onClose={() => setShowChangelog(false)} />
			)}

			{/* ================== Update modal ================== */}
			{availableUpdate && (updateStatus === "available" || updateStatus === "downloading" || updateStatus === "ready-to-relaunch" || updateStatus === "error") && (
				<UpdateModal
					update={availableUpdate}
					onDismiss={() => dismissUpdate(availableUpdate.version)}
				/>
			)}

			{/* ================== Find bar (⌘F) ================== */}
			<FindBar open={showFindBar} onClose={() => setShowFindBar(false)} />

			{/* ================== Command palette (⌘K) ================== */}
			<CommandPalette
				open={showCommandPalette}
				commands={commandItems}
				onClose={() => setShowCommandPalette(false)}
			/>

			{/* ================== Command center (⇧⌘C) ================== */}
			<CommandCenter
				open={showCommandCenter}
				onClose={() => setShowCommandCenter(false)}
				sessions={sessionList}
				stats={usageStats}
			/>

			{/* ================== Home dashboard (⇧⌘H) ================== */}
			<HomeDashboard
				open={showHome}
				onClose={() => setShowHome(false)}
				sessions={homeSessions}
				projects={homeProjects}
				onOpenSession={async (sessionId) => {
					setShowHome(false);
					pushCurrentToClosedTabs();
					try {
						await rpc.switchSession(sessionId);
					} catch (e) {
						toast.error("Failed to open session", e instanceof Error ? e.message : String(e));
					}
				}}
				onOpenProject={(path) => {
					setShowHome(false);
					void switchProject(path);
				}}
				onNewSession={() => {
					setShowHome(false);
					void rpc.sendCommand({ type: "new" }).catch(() => {});
				}}
			/>
		</div>
	);
}

function SidebarSection({
	title,
	children,
	className = "",
}: {
	title: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={className}>
			<div className="mb-1.5 flex items-center justify-between px-2.5">
				<span className="text-3xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
					{title}
				</span>
			</div>
			{children}
		</div>
	);
}

interface SidebarContentProps {
	projectName: string;
	onPickProject: (path: string) => void;
	onOpenPicker: () => void;
	onOpenSettings: () => void;
	onCollapse?: () => void;
}

function SidebarContent({
	projectName,
	onPickProject,
	onOpenPicker,
	onOpenSettings,
	onCollapse,
}: SidebarContentProps) {
	return (
		<>
			{/* Workspace switcher */}
			<div className="flex items-center border-b border-pi-border p-3">
				<button
					onClick={onOpenPicker}
					className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-hover active-press hover:bg-pi-surface-raised focus-visible:shadow-focus focus-visible:outline-none"
				>
					<BrandMark className="h-7 w-7" />
					<div className="min-w-0 flex-1">
						<div className="truncate text-[13px] font-semibold tracking-tight">
							A-Coder
						</div>
						<div className="flex items-center gap-1 truncate text-2xs text-pi-text-muted">
							<FolderGit2 className="h-3 w-3 shrink-0 transition-smooth" />
							<span className="truncate">{projectName}</span>
						</div>
					</div>
					<ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-pi-text-faint transition-smooth group-hover:text-pi-text-muted" />
				</button>
				{onCollapse && (
					<button
						onClick={onCollapse}
						className="ml-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-pi-text-faint transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none" aria-label="Collapse sidebar"
					>
						<ChevronsUpDown className="h-3.5 w-3.5 rotate-90" />
					</button>
				)}
			</div>

			{/* Sidebar content */}
			<div className="flex-1 overflow-auto px-2 py-3">
				<SidebarSection title="Projects">
					<SidebarProjects onSelect={onPickProject} onAdd={onOpenPicker} />
				</SidebarSection>
				<SidebarSection title="Session" className="mt-5">
					<SessionActions />
				</SidebarSection>
				<SidebarSection title="Tree" className="mt-5">
					<SessionTree />
				</SidebarSection>
			</div>

			{/* Footer */}
			<div className="border-t border-pi-border p-2">
				<button
					className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					onClick={onOpenSettings}
				>
					<Settings className="h-3.5 w-3.5 transition-smooth" />
					Settings
					<span className="ml-auto font-mono text-3xs text-pi-text-faint">⌘,</span>
				</button>
			</div>
		</>
	);
}

interface SidebarRailProps {
	projectName: string;
	onOpenPicker: () => void;
	onOpenSettings: () => void;
	onExpand: () => void;
	onPickProject: (path: string) => void;
	/** A background session is blocked on a permission prompt / dialog. */
	needsBackgroundInput: boolean;
	/** A background turn finished since its session was last visited. */
	hasBackgroundFinished: boolean;
	onFocusBackground: () => void;
}

function SidebarRail({
	projectName,
	onOpenPicker,
	onOpenSettings,
	onExpand,
	onPickProject,
	needsBackgroundInput,
	hasBackgroundFinished,
	onFocusBackground,
}: SidebarRailProps) {
	const [hovered, setHovered] = useState(false);
	return (
		<div
			className="relative flex shrink-0"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<aside className="flex w-12 flex-col items-center gap-1 border-r border-pi-border bg-pi-surface py-2">
				<button
					onClick={onExpand}
					className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent transition-hover hover:brightness-105"

					aria-label="Pin sidebar open"
				>
<BrandMark className="h-6 w-6" />
				</button>
				<RailIcon icon={FolderGit2} label="Projects" onClick={onExpand} />
				<RailIcon icon={Plus} label="New / open project" onClick={onOpenPicker} />
				<RailIcon icon={MessageSquare} label="Session tree — pin sidebar" onClick={onExpand} />
				<div className="flex-1" />
				<BackgroundAttentionOrb
					needsInput={needsBackgroundInput}
					finished={hasBackgroundFinished}
					onClick={onFocusBackground}
				/>
				<RailIcon icon={Settings} label="Settings" onClick={onOpenSettings} />
			</aside>

			{hovered && (
				<aside className="absolute left-12 top-0 z-30 flex h-full w-64 flex-col border-r border-pi-border bg-pi-surface shadow-card">
					<SidebarContent
						projectName={projectName}
						onPickProject={onPickProject}
						onOpenPicker={onOpenPicker}
						onOpenSettings={onOpenSettings}
						onCollapse={onExpand}
					/>
				</aside>
			)}
		</div>
	);
}

function RailIcon({
	icon: IconCmp,
	label,
	onClick,
}: {
	icon: typeof FolderGit2;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none" aria-label={label}
		>
			<IconCmp className="h-4 w-4" />
		</button>
	);
}

/**
 * Notification orb in the sidebar rail — lights up when a background session
 * needs the user: a turn is blocked on a permission prompt / dialog (amber,
 * pulsing) or a background turn finished since the session was last visited
 * (green). Clicking jumps to the most urgent background session.
 */
function BackgroundAttentionOrb({
	needsInput,
	finished,
	onClick,
}: {
	needsInput: boolean;
	finished: boolean;
	onClick: () => void;
}) {
	if (!needsInput && !finished) return null;
	const urgent = needsInput;
	return (
		<button
			onClick={onClick}
			className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
			aria-label={urgent ? "A background session needs your input" : "A background turn finished"}
			title={urgent ? "A background session needs your input" : "A background turn finished"}
		>
			<Bell className={`h-4 w-4 ${urgent ? "text-pi-warning" : ""}`} />
			<span
				className={`absolute right-1 top-1 h-2 w-2 rounded-full ${
					urgent ? "animate-pulse bg-pi-warning" : "bg-pi-success"
				}`}
				aria-hidden
			/>
		</button>
	);
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

function ResizableRightSidebar({
	open,
	width,
	projectPath,
}: {
	open: boolean;
	width: number;
	projectPath: string | null;
}) {
	const { setRightSidebarWidth } = useUiStore();
	const [isResizing, setIsResizing] = useState(false);
	const MIN_WIDTH = 240;
	const MAX_WIDTH = 600;

	const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

	const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		setIsResizing(true);

		const handle = e.currentTarget;
		const pointerId = e.pointerId;
		const startX = e.clientX;
		const startWidth = width;
		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;
		let active = true;

		handle.setPointerCapture?.(pointerId);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		// pointermove outpaces 60fps and each setRightSidebarWidth reflows the
		// shell, so coalesce to one apply per animation frame (commits on cleanup).
		const resize = rafCoalesce((w: number) => setRightSidebarWidth(w));

		const handleMove = (moveEvent: PointerEvent) => {
			if (!active) return;
			const delta = startX - moveEvent.clientX;
			resize.push(clampWidth(startWidth + delta));
		};

		const cleanup = () => {
			if (!active) return;
			active = false;
			resize.finish();
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
			handle.releasePointerCapture?.(pointerId);
			window.removeEventListener("pointermove", handleMove, true);
			window.removeEventListener("pointerup", cleanup, true);
			window.removeEventListener("pointercancel", cleanup, true);
			window.removeEventListener("blur", cleanup);
			handle.removeEventListener("lostpointercapture", cleanup);
			setIsResizing(false);
		};

		window.addEventListener("pointermove", handleMove, true);
		window.addEventListener("pointerup", cleanup, true);
		window.addEventListener("pointercancel", cleanup, true);
		window.addEventListener("blur", cleanup);
		handle.addEventListener("lostpointercapture", cleanup);
	};

	return (
		<aside
			className={`relative shrink-0 border-l border-pi-border bg-pi-surface ${
				open
					? isResizing
						? "opacity-100"
						: "opacity-100 transition-[width,opacity] duration-200"
					: "w-0 overflow-hidden border-l-0 opacity-0 transition-[width,opacity] duration-200"
			}`}
			style={open ? { width } : undefined}
			aria-hidden={!open}
		>
			{open && (
				<>
					<RightSidebar projectPath={projectPath} />
					{/* Resize handle */}
					<div
						className={`absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-pi-accent ${
							isResizing ? "bg-pi-accent" : "bg-transparent"
						}`}
						onPointerDown={handlePointerDown}
						title="Drag to resize"
					/>
				</>
			)}
		</aside>
	);
}

function ChatContainer({ children }: { children: React.ReactNode }) {
	const { leftSidebarOpen, rightSidebarOpen, rightSidebarWidth } = useUiStore();

	// Drawer-aware rhythm. When a drawer is open we keep a compact gutter because
	// the drawer already consumes room; when collapsed we expand the gutter to
	// use the freed margin real estate.
	const leftGutter = leftSidebarOpen ? "1rem" : "2rem";
	const rightGutter = rightSidebarOpen ? "1rem" : "2rem";
	// Slightly increase the right gutter for very wide right panels so content
	// does not sit flush against the drawer.
	const rightDrawerPadding = rightSidebarOpen ? Math.max(0, rightSidebarWidth - 240) * 0.05 : 0;

	// Scale the reading column with available main-column width.
	let maxWidth: string;
	if (leftSidebarOpen && rightSidebarOpen) {
		maxWidth = "42rem"; // max-w-2xl
	} else if (leftSidebarOpen || rightSidebarOpen) {
		maxWidth = "48rem"; // max-w-3xl
	} else {
		maxWidth = "56rem"; // max-w-4xl
	}

	return (
		<div
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
			style={{
				["--chat-gutter" as string]: `clamp(1rem, ${leftGutter}, 2.5rem)`,
				["--chat-gutter-right" as string]: `calc(${rightGutter} + ${rightDrawerPadding}px)`,
				["--chat-max-width" as string]: maxWidth,
			}}
		>
			{children}
		</div>
	);
}

function TrustModal({
	cwd,
	onAccept,
	onDeny,
	onClose,
}: {
	cwd: string;
	onAccept: () => void;
	onDeny: () => void;
	onClose: () => void;
}) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="border-b border-pi-border px-4 py-3">
					<h2 className="text-[13px] font-semibold tracking-tight text-pi-text">Trust project?</h2>
				</div>
				<div className="px-4 py-4 text-xs text-pi-text-secondary">
					<p>
						Allow A-Coder to load settings, resources, and extensions for this project?
					</p>
					<p className="mt-2 font-mono text-2xs text-pi-text-muted">{cwd}</p>
				</div>
				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-4 py-3">
					<button
						onClick={onDeny}
						className="rounded-lg px-3 py-2 text-xs font-medium text-pi-text-secondary transition-hover hover:bg-pi-error-soft hover:text-pi-error"
					>
						Don't trust
					</button>
					<button
						onClick={onAccept}
						className="rounded-lg bg-pi-accent px-3 py-2 text-xs font-medium text-white transition-hover hover:bg-pi-accent-hover"
					>
						Trust project
					</button>
				</div>
			</div>
		</div>
	);
}

function SimpleModal({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: React.ReactNode;
}) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<h2 className="text-[13px] font-semibold tracking-tight text-pi-text">{title}</h2>
					<button
						onClick={onClose}
						className="rounded p-1 text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="px-4 py-4">{children}</div>
			</div>
		</div>
	);
}

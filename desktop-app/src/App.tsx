import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronsUpDown, FolderGit2, MessageSquare, Plus, Settings, Sparkles, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as rpc from "./lib/rpc";
import { installFirstGestureAudioPrime, playCompletionSound } from "./lib/completion-sound";
import { triggerHaptic } from "./lib/haptics";
import { rafCoalesce } from "./lib/raf-coalesce";
import { synthesize, playAudioBlob, type VoiceSettings } from "./lib/voice";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { useSessionStore } from "./stores/session-store";
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
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { ChangelogModal } from "./components/ChangelogModal";
import { ChatBackdrop } from "./components/ChatBackdrop";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { MemoryModal } from "./components/MemoryModal";
import { ModelPicker } from "./components/ModelPicker";
import { OnboardingModal } from "./components/OnboardingModal";
import { ProjectPicker } from "./components/ProjectPicker";
import { RightSidebar } from "./components/RightSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { TodoPanel } from "./components/TodoPanel";
import { SessionActions, Toolbar } from "./components/Toolbar";
import { SessionPicker } from "./components/SessionPicker";
import { SessionTabs } from "./components/SessionTabs";
import { SessionTree } from "./components/SessionTree";
import { SidebarProjects } from "./components/SidebarProjects";
import { StatusBar } from "./components/StatusBar";
import { Titlebar } from "./components/Titlebar";
import { SubagentPanel } from "./components/SubagentPanel";
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
	const [showSubagents, setShowSubagents] = useState(false);
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
	const permissionRequest = uiRequests.find((r) => r.kind === "permission");
	const modalRequest = uiRequests.find((r) => r.kind !== "permission");
	const { cliPath, theme, skin, reopenLastProject, startupModel, cliGlobalSettings } =
		useSettingsStore();
	const { setStatus: setWidgetStatus, setWidget } = useWidgetStore();
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
	const clearTabs = useTabsStore((s) => s.clear);
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const sessionName = useSessionStore((s) => s.sessionName);
	const { setStats } = useStatsStore();
	const { leftSidebarOpen, setLeftSidebarOpen, rightSidebarOpen, rightSidebarWidth } = useUiStore();
	const effectiveCwd = projectPath || FALLBACK_CWD;

	// Apply theme class to the document root.
	useEffect(() => {
		applyNamedTheme(skin, theme);
	}, [skin, theme]);

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

	// Prime the completion-sound AudioContext on the first user gesture so the
	// async agent_end chime isn't muted by WKWebView's autoplay policy.
	useEffect(() => {
		installFirstGestureAudioPrime();
	}, []);

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
				if (stats) {
					setStats(stats);
					if (stats.contextUsage && stats.contextUsage.contextWindow > 0) {
						setContextUsage({
							tokens: stats.contextUsage.tokens ?? null,
							contextWindow: stats.contextUsage.contextWindow,
							percent: stats.contextUsage.percent ?? null,
						});
					}
				}
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
		setContextUsage,
		setStats,
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

				// Sync the full engine state, apply theme, and prompt for trust if needed.
				await syncEngineState();
				applyNamedTheme(skin, (cliGlobalSettings.theme as import("./stores/settings-store").Theme) ?? theme);
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
						case "session_start": {
							// The engine switched to a new or resumed session. Clear local state
							// and re-sync so the UI matches the authoritative session. While we
							// fetch history, ignore live message events so a streaming response
							// cannot race ahead and create an empty duplicate ahead of the
							// authoritative snapshot.
							loadingHistoryRef.current = true;
							resetSession();
							void (async () => {
								try {
									await syncEngineState();
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
									if (!treeLoaded) setTree([], null);
									try {
										const msgsRes = (await rpc.sendCommand({ type: "get_messages" })) as {
											messages: import("@earendil-works/pi-agent-core").AgentMessage[];
										};
										if (msgsRes?.messages) {
											setMessages(msgsRes.messages);
										}
									} catch (e) {
										toast.error(
											"Failed to load messages after session start",
											e instanceof Error ? e.message : String(e),
										);
									}
								} finally {
									loadingHistoryRef.current = false;
								}
							})();
							break;
						}
						case "message_start":
							if (loadingHistoryRef.current) break;
							if (event.message.role === "user") {
								// Avoid double-appending the same user message if the engine echoes it
								// after it was already injected by the composer.
								const messages = useSessionStore.getState().messages;
								const isDuplicateUser = messages.some(
									(m) =>
										m.role === "user" &&
										getUserMessageText(m as import("@earendil-works/pi-ai").UserMessage) ===
											getUserMessageText(event.message as import("@earendil-works/pi-ai").UserMessage),
								);
								if (!isDuplicateUser) {
									appendMessage(event.message);
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
						case "extension_ui_request": {
							const req = event as import("./lib/rpc").ExtensionUiRequestEvent;

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
						const statsRes = (await rpc.sendCommand({ type: "get_session_stats" })) as SessionStats;
						if (statsRes) setStats(statsRes);
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
			cliGlobalSettings.theme,
			theme,
			skin,
			setStatus,
			setCwd,
			setModel,
			setThinkingLevel,
			setPermissionMode,
			setSessionName,
			setTree,
			setStats,
			setIsStreaming,
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
		window.addEventListener("a-coder:open-account", onOpenAccount);
		window.addEventListener("a-coder:open-model-picker", onOpenModel);
		window.addEventListener("a-coder:open-session-picker", onOpenSession);
		window.addEventListener("a-coder:switch-project", onSwitchProject as EventListener);
		window.addEventListener("a-coder:open-resume", onOpenResume);
		window.addEventListener("a-coder:open-subagents", onOpenSubagents);
		window.addEventListener("a-coder:show-hotkeys", onShowHotkeys);
		window.addEventListener("a-coder:show-changelog", onShowChangelog);
		window.addEventListener("a-coder:reload", onReload);
		window.addEventListener("a-coder:quit", onQuit);
		window.addEventListener("a-coder:check-updates", onCheckUpdates);

		return () => {
			window.removeEventListener("a-coder:open-settings", onOpenSettings);
			window.removeEventListener("a-coder:open-account", onOpenAccount);
			window.removeEventListener("a-coder:open-model-picker", onOpenModel);
			window.removeEventListener("a-coder:open-session-picker", onOpenSession);
		window.removeEventListener("a-coder:switch-project", onSwitchProject as EventListener);
		window.removeEventListener("a-coder:open-resume", onOpenResume);
			window.removeEventListener("a-coder:open-subagents", onOpenSubagents);
			window.removeEventListener("a-coder:show-hotkeys", onShowHotkeys);
			window.removeEventListener("a-coder:show-changelog", onShowChangelog);
			window.removeEventListener("a-coder:reload", onReload);
			window.removeEventListener("a-coder:quit", onQuit);
			window.removeEventListener("a-coder:check-updates", onCheckUpdates);
		};
	}, [setAvailableCommands]);

	const handleReconnect = useCallback(async () => {
		unlistenRef.current?.();
		unlistenRef.current = null;
		await rpc.disconnect().catch(() => {});
		await connectEngine(effectiveCwd, { continueSession: true });
	}, [connectEngine, effectiveCwd]);

	// Switch to a different project: update the store, drop the engine + open
	// session tabs (tabs are per-project), and reconnect against the new cwd.
	const switchProject = useCallback(
		async (path: string) => {
			setProjectPath(path);
			unlistenRef.current?.();
			unlistenRef.current = null;
			clearTabs();
			await rpc.disconnect().catch(() => {});
			await connectEngine(path, { continueSession: true });
		},
		[setProjectPath, clearTabs, connectEngine],
	);
	switchProjectRef.current = switchProject;

	// Keep the session tab strip in sync with the active session: open/update a
	// tab whenever the engine reports a session file (covers connect, resume,
	// new session, fork, and renames).
	useEffect(() => {
		if (sessionFile) openTab(sessionFile, sessionName ?? "Untitled session");
	}, [sessionFile, sessionName, openTab]);

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

	if (!bootReady) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-pi-bg text-pi-text">
				<div className="flex flex-col items-center gap-3">
					<div className="size-7 animate-spin rounded-full border-2 border-pi-border border-t-pi-text/70" />
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
						try {
							await rpc.switchSession(sessionPath);
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
					<div className="space-y-2 text-[12px] text-pi-text-secondary">
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
				<span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
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
					<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent">
						<Sparkles className="h-3.5 w-3.5" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[13px] font-semibold tracking-tight">
							A-Coder
						</div>
						<div className="flex items-center gap-1 truncate text-[11px] text-pi-text-muted">
							<FolderGit2 className="h-3 w-3 shrink-0 transition-smooth" />
							<span className="truncate">{projectName}</span>
						</div>
					</div>
					<ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-pi-text-faint transition-smooth group-hover:text-pi-text-muted" />
				</button>
				{onCollapse && (
					<button
						onClick={onCollapse}
						className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-pi-text-faint transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						title="Collapse sidebar"
						aria-label="Collapse sidebar"
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
					className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12px] text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					onClick={onOpenSettings}
				>
					<Settings className="h-3.5 w-3.5 transition-smooth" />
					Settings
					<span className="ml-auto font-mono text-[10px] text-pi-text-faint">⌘,</span>
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
}

function SidebarRail({
	projectName,
	onOpenPicker,
	onOpenSettings,
	onExpand,
	onPickProject,
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
					className="flex h-8 w-8 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent transition-hover hover:brightness-105"
					title="A-Coder — pin sidebar open"
					aria-label="Pin sidebar open"
				>
					<Sparkles className="h-4 w-4" />
				</button>
				<RailIcon icon={FolderGit2} label="Projects" onClick={onExpand} />
				<RailIcon icon={Plus} label="New / open project" onClick={onOpenPicker} />
				<RailIcon icon={MessageSquare} label="Session tree — pin sidebar" onClick={onExpand} />
				<div className="flex-1" />
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
			className="flex h-8 w-8 items-center justify-center rounded-md text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
			title={label}
			aria-label={label}
		>
			<IconCmp className="h-4 w-4" />
		</button>
	);
}

function getUserMessageText(message: import("@earendil-works/pi-ai").UserMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((c) => (c.type === "text" ? c.text : "")).join("");
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
				<div className="px-4 py-4 text-[12px] text-pi-text-secondary">
					<p>
						Allow A-Coder to load settings, resources, and extensions for this project?
					</p>
					<p className="mt-2 font-mono text-[11px] text-pi-text-muted">{cwd}</p>
				</div>
				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-4 py-3">
					<button
						onClick={onDeny}
						className="rounded-lg px-3 py-2 text-[12px] font-medium text-pi-text-secondary transition-hover hover:bg-pi-error-soft hover:text-pi-error"
					>
						Don't trust
					</button>
					<button
						onClick={onAccept}
						className="rounded-lg bg-pi-accent px-3 py-2 text-[12px] font-medium text-white transition-hover hover:bg-pi-accent-hover"
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

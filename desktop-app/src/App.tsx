import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, ChevronRight, ChevronsUpDown, FolderGit2, GitBranch, MessageSquare, Plus, Settings, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { initDesktopAnalytics } from "./lib/analytics";
import { toggleHud } from "./lib/hud";
import * as rpc from "./lib/rpc";
import { processAgentEvent, mergeUserEchoes } from "./lib/agent-event-pipeline";
import { useVoiceCallStore, voiceCall } from "./lib/voice-call";
import { ESCAPE_PRIORITY, isTopEscapeLayer } from "./lib/escape-layers";
import { hydrateLinkTarget } from "./stores/browser-store";
import { abortRun } from "./lib/session-abort";
import { triggerHaptic } from "./lib/haptics";
import { rafCoalesce } from "./lib/raf-coalesce";
import { pickLoadingVerb } from "./lib/loading-verbs";
import { adoptSwitchResult } from "./lib/adopt-session";
import { runSwitch } from "./lib/session-switch";
import { isAuthoritativeSession, setAuthoritativeSession } from "./lib/session-authority";
import { useRuntimeStatusStore } from "./stores/runtime-status-store";
import { useSessionStore, type QuestionUiRequest } from "./stores/session-store";
import { useSettingsStore } from "./stores/settings-store";
import { useWorkspaceStore } from "./stores/workspace-store";
import { useSessionTreeStore } from "./stores/session-tree-store";
// Bind the desktop browser's event channel at startup: the agent's openPanel
// event must arrive even while the panel is closed, and browser-store is
// otherwise imported only by BrowserPanel (first render, too late).
import "./stores/browser-store";
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
import { MessageList } from "./components/MessageList";
import { MemoryModal } from "./components/MemoryModal";
import { ModelPicker } from "./components/ModelPicker";
import { REPLAY_ONBOARDING_EVENT, isFirstRunSetupComplete, isOnboardingComplete } from "./lib/onboarding";
import { OnboardingModal } from "./components/OnboardingModal";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { ProjectPicker } from "./components/ProjectPicker";
import { RightSidebar } from "./components/RightSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { Tip } from "./components/ui/Tip";
import { TodoPanel } from "./components/TodoPanel";
import { RuntimePanel } from "./components/RuntimePanel";
import { TaskPanel } from "./components/TaskPanel";
import { SessionActions, Toolbar } from "./components/Toolbar";
import { SessionList } from "./components/SessionList";
import { SessionPicker } from "./components/SessionPicker";
import { SessionTabs } from "./components/SessionTabs";
import { SessionTree } from "./components/SessionTree";
import { SidebarProjects } from "./components/SidebarProjects";
import { StatusBar } from "./components/StatusBar";
import { Butterbar } from "./components/Butterbar";
import { Titlebar } from "./components/Titlebar";
import { SubagentPanel } from "./components/SubagentPanel";
import { TeammateViewer } from "./components/TeammateViewer";
import { Toaster } from "./components/Toaster";
import { ConfirmHost } from "./components/ui/ConfirmDialog";
import { UpdateModal } from "./components/UpdateModal";
import { ApprovalModal } from "./components/panels/ApprovalModal";
import { ApprovalCardStack } from "./components/ApprovalCardStack";
import { ConnectingOverlay } from "./components/ConnectingOverlay";
import { useShallow } from "zustand/react/shallow";
import { HISTORY_PAGE_SIZE } from "./lib/history";
import { setCachedSessionMessages } from "./lib/session-cache";

const FALLBACK_CWD = "";

export default function App() {
	const [showProjectPicker, setShowProjectPicker] = useState(false);
	const [showResume, setShowResume] = useState(false);
	const [showModelPicker, setShowModelPicker] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [showFindBar, setShowFindBar] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [showCommandCenter, setShowCommandCenter] = useState(false);
	const [showHome, setShowHome] = useState(false);
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
	const [showFirstRunSetup, setShowFirstRunSetup] = useState(false);

	// Settings > General > Welcome tour re-opens the onboarding overlay.
	useEffect(() => {
		const handler = () => {
			setShowSettings(false);
			setShowOnboarding(true);
		};
		window.addEventListener(REPLAY_ONBOARDING_EVENT, handler);
		return () => window.removeEventListener(REPLAY_ONBOARDING_EVENT, handler);
	}, []);
	const [trustPrompt, setTrustPrompt] = useState<string | null>(null);
	// The project a pending trust decision should resume switching into: the
	// project switch stops at the trust modal and only continues on accept
	// (running both at once failed the first switch every time).
	const pendingProjectRef = useRef<string | null>(null);
	// Gate first connect on the initial-workspace lookup so a `pi --desktop`
	// launch preselects the terminal's folder before the engine boots.
	const [bootReady, setBootReady] = useState(false);
	const unlistenRef = useRef<(() => void) | null>(null);
	const switchProjectRef = useRef<(path: string) => void>(() => {});
	const loadingHistoryRef = useRef(false);
	// User echoes deferred by the history latch during the boot fetch (the
	// pipeline pushes here); drained + merged into the snapshot on arrival.
	const deferredUserEchoesRef = useRef<import("@earendil-works/pi-agent-core").AgentMessage[]>([]);
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
		setHistoryPage,
		setSessionLoading,
		updateQueue,
		resetSession,
		uiRequests,
		resolveUiRequest,
		approvalInlineMounted,
		setActivationId,
	} = useSessionStore(
		useShallow((s) => ({
			status: s.status,
			error: s.error,
			cwd: s.cwd,
			sessionName: s.sessionName,
			sessionId: s.sessionId,
			sessionFile: s.sessionFile,
			model: s.model,
			thinkingLevel: s.thinkingLevel,
			permissionMode: s.permissionMode,
			isStreaming: s.isStreaming,
			isCompacting: s.isCompacting,
			autoCompactionEnabled: s.autoCompactionEnabled,
			steeringMode: s.steeringMode,
			followUpMode: s.followUpMode,
			messageCount: s.messageCount,
			pendingMessageCount: s.pendingMessageCount,
			contextUsage: s.contextUsage,
			steering: s.steering,
			followUp: s.followUp,
			streamingVerb: s.streamingVerb,
			sessionLoading: s.sessionLoading,
			availableCommands: s.availableCommands,
			questionRequest: s.questionRequest,
			uiRequests: s.uiRequests,
			approvalInlineMounted: s.approvalInlineMounted,
			setStatus: s.setStatus,
			setCwd: s.setCwd,
			setModel: s.setModel,
			setThinkingLevel: s.setThinkingLevel,
			setPermissionMode: s.setPermissionMode,
			setSessionName: s.setSessionName,
			setSessionId: s.setSessionId,
			setSessionFile: s.setSessionFile,
			setActivationId: s.setActivationId,
			setIsStreaming: s.setIsStreaming,
			setIsCompacting: s.setIsCompacting,
			setAutoCompactionEnabled: s.setAutoCompactionEnabled,
			setSteeringMode: s.setSteeringMode,
			setFollowUpMode: s.setFollowUpMode,
			setStreamingVerb: s.setStreamingVerb,
			setMessageCount: s.setMessageCount,
			setPendingMessageCount: s.setPendingMessageCount,
			setContextUsage: s.setContextUsage,
			setAvailableCommands: s.setAvailableCommands,
			appendMessage: s.appendMessage,
			setMessages: s.setMessages,
			setHistoryPage: s.setHistoryPage,
			setSessionLoading: s.setSessionLoading,
			updateQueue: s.updateQueue,
			resetSession: s.resetSession,
			resolveUiRequest: s.resolveUiRequest,
		})),
	);
	// Tool approvals (kind === "permission") render as an inline bar in the
	// transcript (with a floating fallback above the composer when that row is
	// scrolled out of view). Everything else (select/input/editor and generic
	// extension confirms) still uses the modal.
	// Session-scoped routing (Phase 2): requests for other sessions stay queued
	// until that session is active; the runtime-status orb already signals them.
	// NOTE: sessionFile must be declared BEFORE requestIsForCurrentSession — the
	// predicates below call it during this same render, and a use-before-
	// declaration here threw a TDZ ReferenceError the moment the first ui
	// request arrived, unmounting the whole tree (black window).
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const requestIsForCurrentSession = (r: { sessionFile?: string }) =>
		!r.sessionFile || r.sessionFile === sessionFile;
	// Confirm-style requests (permission or generic extension confirms) render
	// inline in the transcript; full-screen modal backdrops black out on this
	// system's WKWebView (backdrop-filter compositing), so they must never be
	// used for approvals. select/input/editor keep the modal (richer input UI).
	const permissionRequests = uiRequests.filter(
		(request) =>
			(request.kind === "permission" || request.method === "confirm") &&
			requestIsForCurrentSession(request),
	);
	const engineReady = useSessionStore((s) => Boolean(s.sessionFile || s.sessionId));
	const trayWorking = useSessionStore((s) => s.isStreaming);
	const trayNeedsInput = permissionRequests.length > 0;
	useEffect(() => {
		void rpc
			.setTrayStatus(trayNeedsInput ? "needs-input" : trayWorking ? "working" : "idle")
			.catch(() => {});
	}, [trayWorking, trayNeedsInput]);

	useEffect(() => {
		let dispose: (() => void) | undefined;
		void listen<string>("tray-action", (event) => {
			if (event.payload === "new-session") {
				void rpc.sendCommand({ type: "new_session" });
			} else if (event.payload === "toggle-hud") {
				void toggleHud();
			}
		})
			.then((unlisten) => {
				dispose = unlisten;
			})
			.catch(() => {});
		return () => dispose?.();
	}, []);

	const modalRequest = uiRequests.find(
		(r) => r.kind !== "permission" && r.method !== "confirm" && requestIsForCurrentSession(r),
	);
	const { cliPath, theme, skin, reopenLastProject, startupModel, cliGlobalSettings } =
		useSettingsStore();
	const { setStatus: setWidgetStatus, setWidget } = useWidgetStore();
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
	const sessionName = useSessionStore((s) => s.sessionName);
	const cwd = useSessionStore((s) => s.cwd);
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
	const rightSidebarTab = useUiStore((state) => state.rightSidebarTab);
	type SidebarSectionId = "sessions" | "projects" | "tree";
	const [pendingSidebarSection, setPendingSidebarSection] = useState<SidebarSectionId | null>(null);
	const jumpToSidebarSection = (section: SidebarSectionId) => {
		setLeftSidebarOpen(true);
		setPendingSidebarSection(section);
	};
	useEffect(() => {
		if (!pendingSidebarSection) return;
		const frame = requestAnimationFrame(() => {
			const id = `sidebar-${pendingSidebarSection}`;
			window.dispatchEvent(new CustomEvent("a-coder:open-sidebar-section", { detail: { id } }));
			document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
			setPendingSidebarSection(null);
		});
		return () => cancelAnimationFrame(frame);
	}, [pendingSidebarSection]);
	const setRightSidebarTab = useUiStore((state) => state.setRightSidebarTab);
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

	// Opt-in product analytics (gated by `enableAnalytics` in settings.json).
	// Fire-and-forget; no-op when opted out or misconfigured.
	useEffect(() => {
		void initDesktopAnalytics();
	}, []);

	// AudioContext priming is now handled in main.tsx on the first user gesture
	// so completion chimes and haptic click synthesis can fire automatically.

	// Reusable: pull the authoritative engine state into the session store.
	// Covers model, thinking, permission, compaction, queue modes, counts, and
	// session identity. Also derives a context-usage estimate from stats.
	const syncEngineState = useCallback(async () => {
		try {
			// One activation round trip (state + stats). Fall back to the two
			// separate reads on an engine that predates `get_session_snapshot`.
			const snapshot = await Promise.race([
				rpc.getSessionSnapshot(),
				new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
			]);
			let s: rpc.EngineSessionState | undefined;
			let stats: import("./stores/stats-store").SessionStats | undefined;
			if (snapshot) {
				s = snapshot.state;
				stats = snapshot.stats as unknown as import("./stores/stats-store").SessionStats;
			} else {
				s = (await rpc.sendCommand({ type: "get_state" })) as rpc.EngineSessionState;
				try {
					stats = (await rpc.sendCommand({ type: "get_session_stats" })) as import("./stores/stats-store").SessionStats;
				} catch {
					// stats are best-effort
				}
			}
			if (s?.model) setModel(s.model as never);
			if (s?.thinkingLevel) setThinkingLevel(s.thinkingLevel);
			if (s?.permissionMode) setPermissionMode(s.permissionMode);
			// Always apply the name, including clearing it: switching to an unnamed
			// session must not inherit the previous session's name (the tab strip
			// derives its labels from this field). The authority marker records
			// which session the applied name is authoritative for, so the tab-sync
			// effect below never relabels a tab with a name belonging to a
			// different session.
			setSessionName(s?.sessionName ?? null);
			setAuthoritativeSession(s?.sessionFile ?? null);
			setActivationId(s?.activationId ?? 0);
			if (s?.sessionId) setSessionId(s.sessionId);
			setSessionFile(s?.sessionFile ?? null);
			if (s?.cwd) setCwd(s.cwd);
			setIsCompacting(s?.isCompacting ?? false);
			setAutoCompactionEnabled(s?.autoCompactionEnabled ?? true);
			if (s?.steeringMode) setSteeringMode(s.steeringMode);
			if (s?.followUpMode) setFollowUpMode(s.followUpMode);
			if (typeof s?.messageCount === "number") setMessageCount(s.messageCount);
			if (typeof s?.pendingMessageCount === "number")
				setPendingMessageCount(s.pendingMessageCount);
			// The engine computes contextUsage from the active model's real
			// context window (Ollama discovers it from /api/show).
			if (stats) applySessionStats(stats);
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
		setActivationId,
		setCwd,
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

				// Register the event pipeline BEFORE the state fetches: events that
				// arrive during history load are latched by loadingHistoryRef, but
				// registering late silently drops anything sent in the boot window —
				// typically the user's first message after opening the app (its echo
				// never renders, and the reply lands without it).
				loadingHistoryRef.current = true;
				const unlistenEarly = await rpc.onRpcEvent((event) => {
					processAgentEvent(event, {
						loadingHistoryRef,
						sessionStartGenerationRef,
						parkedQuestionsRef: parkedQuestionsRef.current,
						deferredUserEchoesRef,
						syncEngineState,
					});
				});
				unlistenRef.current?.();
				unlistenRef.current = unlistenEarly;
				// Flush frames the engine emitted during spawn (engine_info, initial
				// registry/office snapshots) now that a listener exists.
				await rpc.markRpcReady().catch(() => 0);

				// Opt into compact deltas + coalesced batches when the engine
				// supports them; older engines keep contract-1 full events.
				try {
					// Bound the wait: an older engine ignores unknown commands and
					// would otherwise hold boot for the full 60s RPC timeout.
					await Promise.race([
						rpc.clientInfo(["delta", "batch", "tool-progress", "attachments"]),
						new Promise<void>((resolve) => setTimeout(resolve, 500)),
					]);
				} catch {
					// Legacy engine: keep contract-1 full events.
				}

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

				// Load session tree (flat transfer; the store builds the structure).
				try {
					const treeRes = await rpc.getTree(true);
					if (treeRes?.nodes) useSessionTreeStore.getState().setFlatTree(treeRes.nodes, treeRes.leafId);
					else if (treeRes?.tree) setTree(treeRes.tree, treeRes.leafId);
				} catch (e) {
					toast.error("Failed to load session tree", e instanceof Error ? e.message : String(e));
				}

				// Load the active session's messages. When launched with --continue
				// (project switch / reconnect) this is the resumed session's history;
				// on a fresh launch it's empty. The initial session_start event is
				// not forwarded to subscribers, so we fetch the history ourselves.
				loadingHistoryRef.current = true;
				deferredUserEchoesRef.current = [];
				// Resumed sessions may take a moment to load history — show the
				// loading state instead of flashing the new-conversation EmptyState.
				if (options?.continueSession) setSessionLoading(true);
				let fetchedMessages: import("@earendil-works/pi-agent-core").AgentMessage[] | undefined;
				let fetchedPage: rpc.GetMessagesResult | undefined;
				try {
					const msgsRes = await rpc.getMessages({ limit: HISTORY_PAGE_SIZE });
					if (msgsRes?.messages) {
						fetchedMessages = msgsRes.messages;
						fetchedPage = msgsRes;
					}
				} catch (e) {
					toast.error("Failed to load session history", e instanceof Error ? e.message : String(e));
				} finally {
					// Latch off FIRST, then drain: user echoes deferred during the
					// flight (a first send inside the boot window) merge into the
					// snapshot here — the single setMessages, so nothing appended
					// live in between can be wiped and nothing is left stranded.
					loadingHistoryRef.current = false;
					const deferred = deferredUserEchoesRef.current;
					deferredUserEchoesRef.current = [];
					if (fetchedMessages || deferred.length > 0) {
						const snapshot = fetchedMessages ? mergeUserEchoes(fetchedMessages, deferred) : deferred;
						setHistoryPage(
							snapshot,
							fetchedPage?.total ?? snapshot.length,
							fetchedPage?.start ?? 0,
						);
						const bootSessionFile = useSessionStore.getState().sessionFile;
						if (bootSessionFile) setCachedSessionMessages(bootSessionFile, snapshot);
					}
					setSessionLoading(false);
				}

				// Load available slash commands.
				try {
					const cmdsRes = await rpc.getCommands();
					setAvailableCommands(cmdsRes.commands ?? []);
				} catch (e) {
					toast.error("Failed to load slash commands", e instanceof Error ? e.message : String(e));
				}

				// Stats are pushed as session_stats at turn/compaction boundaries.
				// Keep a slow fallback for engines that predate the push.
				const statsInterval = setInterval(async () => {
					try {
						const statsRes = (await rpc.sendCommand({ type: "get_session_stats" })) as SessionStats & {
							contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
						};
						if (statsRes) applySessionStats(statsRes);
					} catch (e) {
						console.error("Failed to refresh stats", e);
					}
				}, 30_000);
				unlistenRef.current = () => {
					unlistenEarly();
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
			setSessionLoading,
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

	// Listen for the native engine process exiting. Without this the window
	// keeps rendering a dead session (sends time out silently). Surface the
	// BootFailureCard with a Retry affordance instead.
	useEffect(() => {
		let unlisten: (() => void) | null = null;
		rpc.onCliExited(() => {
			useSessionStore.getState().setStatus(
				"error",
				"The engine process exited unexpectedly. Retry restarts it and reloads the conversation.",
			);
			useSessionStore.getState().setIsStreaming(false);
		}).then((fn) => {
			unlisten = fn;
		});
		// The CLI engine is newer than this desktop build (bootstrap keeps it
		// instead of downgrading); make the skew visible.
		rpc.onEngineVersionSkew(({ cli, desktop }) => {
			toast.warning(
				"Engine newer than this app",
				`The installed CLI (v${cli}) is newer than A-Coder Desktop (v${desktop}). Most features work; update the app when convenient.`,
			);
		}).then((fn) => {
			const previous = unlisten;
			unlisten = () => {
				fn();
				previous?.();
			};
		});
		return () => {
			unlisten?.();
		};
	}, []);

	// WebKitGTK WebProcess crash on Linux: the Rust shell logs the termination
	// reason and reloads the webview in place. Nothing to restore here — the
	// reload reconnects on boot.
	useEffect(() => {
		let unlisten: (() => void) | null = null;
		rpc.onWebProcessCrashed(() => {
			console.warn("[a-coder] webview process crashed; shell is reloading");
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
			const onReopenClosedTab = () => {
			const tab = useClosedTabsStore.getState().take();
			if (tab) {
				void runSwitch(tab.sessionId).catch(() => {});
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

		window.addEventListener("a-coder:open-settings", onOpenSettings);
		window.addEventListener("a-coder:find-in-page", onOpenFindBar);
		window.addEventListener("a-coder:command-palette", onOpenCommandPalette);
		window.addEventListener("a-coder:open-home", onOpenHome);
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

		return () => {
			window.removeEventListener("a-coder:open-settings", onOpenSettings);
			window.removeEventListener("a-coder:find-in-page", onOpenFindBar);
			window.removeEventListener("a-coder:command-palette", onOpenCommandPalette);
		window.removeEventListener("a-coder:open-home", onOpenHome);
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

	// Escape stops an in-flight run (mirrors the CLI's Esc interrupt). Only acts
	// at base priority: approvals, palette, find bar, pickers, menus, and voice
	// calls own Esc first, via escape-layer priorities and their own handlers.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.repeat) return;
			if (e.defaultPrevented) return; // a higher layer already handled Esc
			if (!isTopEscapeLayer(ESCAPE_PRIORITY.engineStop)) return;
			if (!useSessionStore.getState().isStreaming) return;
			if (useSessionStore.getState().uiRequests.length > 0) return; // approval Esc = deny
			if (useVoiceCallStore.getState().active) return; // Esc = hang up
			e.preventDefault();
			e.stopPropagation();
			void abortRun();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, []);

	// Voice call keybindings: Escape ends the call, Space barges an in-progress
	// reply. Capture-phase so they outrank dialogs sitting underneath the overlay.
	const voiceCallActive = useVoiceCallStore((s) => s.active);
	useEffect(() => {
		if (!voiceCallActive) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				void voiceCall.stop();
				return;
			}
			if (e.code === "Space") {
				const phase = useVoiceCallStore.getState().phase;
				if (phase !== "speaking") return; // typing/listening untouched
				// Don't eat spaces meant for text fields.
				const target = e.target as HTMLElement | null;
				if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				voiceCall.interrupt();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [voiceCallActive]);

	// A starting call moves the right rail to the voice panel, wherever the
	// composer button that started it lives. Ending a call leaves the panel up.
	const isVoiceCallActive = useVoiceCallStore((s) => s.active);
	useEffect(() => {
		if (!isVoiceCallActive) return;
		useUiStore.getState().setRightSidebarTab("voice");
	}, [isVoiceCallActive]);

	// Hydrate the link-target preference once at boot (browser.card syncs it
	// live after that).
	useEffect(() => {
		void hydrateLinkTarget();
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
		void runSwitch(target)
			.then((result) => adoptSwitchResult(result))
			.catch((e) =>
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
	// Session headers and dialogs spell the same folder differently often
	// enough (real paths, casing) that compares must be normalization-tolerant.
	const normalizeCwdLike = (a: string | undefined, b: string) =>
		(a ?? "").replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
	const switchProject = useCallback(
		async (path: string) => {
			// Canonicalize once and use the resolved path everywhere: the folder
			// picker returns real paths, while session headers and recent lists
			// carry whatever spelling was used when the project was first opened.
			// Strict compares on those strings missed the resume filter and made
			// every other project switch fall back to a blank new session.
			const target = await rpc.canonicalizePath(path).catch(() => undefined);
			if (!target) {
				toast.error("Cannot open project", `${path} no longer exists.`);
				return;
			}
			const current = projectPath.replace(/\/+$/, "");
			if (current && current.toLowerCase() === target.toLowerCase()) return;
			try {
				const trusted = await rpc.getProjectTrust(target);
				if (!trusted) {
					// Stop at the trust modal; the switch continues on accept.
					pendingProjectRef.current = target;
					setTrustPrompt(target);
					return;
				}
				const res = await rpc.listSessions();
				const latest = (res.sessions ?? [])
					.filter((s) => normalizeCwdLike(s.cwd, target))
					.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())[0];
				if (latest) {
					pushCurrentToClosedTabs();
					const result = await runSwitch(latest.path);
					adoptSwitchResult(result);
					if (result.reattached && result.snapshot?.running) {
						const store = useSessionStore.getState();
						if (!store.isStreaming) {
							store.setIsStreaming(true);
							store.setStreamingVerb(pickLoadingVerb());
						}
					}
				} else {
					useWorkspaceStore.getState().setCurrent(target);
					await rpc.newSession(undefined, target);
				}
			} catch (e) {
				toast.error("Failed to switch project", e instanceof Error ? e.message : String(e));
			}
		},
		[projectPath, pushCurrentToClosedTabs],
	);
	switchProjectRef.current = switchProject;

	// Keep the session tab strip in sync with the active session: ensure a tab
	// exists whenever the engine reports a session file (connect, resume, new
	// session, fork), and relabel it only once the name is authoritative for
	// that session. The optimistic switch path sets activePath first — before
	// get_state returns — so without this gate the effect would rename the
	// freshly activated tab with the PREVIOUS session's stale name.
	useEffect(() => {
		if (!sessionFile) return;
		if (isAuthoritativeSession(sessionFile)) {
			openTab(sessionFile, sessionName ?? "Untitled session");
			return;
		}
		// Name not authoritative yet (the switch response adoption or the
		// session_start sync is still in flight, or the event was lost): open the
		// tab unlabeled and pull the authoritative identity. get_state reflects
		// the engine's CURRENT session, so this can never apply another
		// session's name.
		openTab(sessionFile);
		void syncEngineState();
	}, [sessionFile, sessionName, openTab, syncEngineState]);

	// Keep the workspace indicator in sync with the ACTIVE SESSION's workspace:
	// switching conversations across projects is a session switch, and the
	// session's own cwd is the truth for "where does this session run".
	useEffect(() => {
		const dir = cwd?.replace(/\/+$/, "");
		if (dir && dir !== projectPath) {
			setProjectPath(dir);
		}
	}, [cwd, projectPath, setProjectPath]);

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

	const handleTrustAccept = async () => {
		if (!trustPrompt) return;
		const resuming = pendingProjectRef.current;
		pendingProjectRef.current = null;
		try {
			await rpc.setProjectTrust(trustPrompt, true);
			toast.success("Project trusted", trustPrompt);
		} catch (e) {
			toast.error("Failed to trust project", e instanceof Error ? e.message : String(e));
		} finally {
			setTrustPrompt(null);
		}
		// The switch stopped at the trust modal - continue it now that the
		// project is trusted (this is what made a first switch "not work").
		if (resuming) switchProjectRef.current?.(resuming);
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
			{
				id: "toggle-browser-panel",
				label: rightSidebarOpen && rightSidebarTab === "browser" ? "Close browser panel" : "Open browser panel",
				group: "view",
				action: () => {
					if (rightSidebarOpen && rightSidebarTab === "browser") {
						setRightSidebarOpen(false);
					} else {
						setRightSidebarTab("browser");
						setRightSidebarOpen(true);
					}
				},
			},
		],
		[leftSidebarOpen, rightSidebarOpen, setLeftSidebarOpen, setRightSidebarOpen, rightSidebarTab, setRightSidebarTab],
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
						onJump={jumpToSidebarSection}
						needsBackgroundInput={needsBackgroundInput}
						hasBackgroundFinished={hasBackgroundFinished}
						onFocusBackground={focusBackgroundSession}
					/>
				)}

				{/* ================== Main column ================== */}
				<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<SessionTabs />
					<header className="flex h-9 shrink-0 items-center justify-between border-b border-pi-border bg-pi-bg/60 px-3 backdrop-blur">
						<Toolbar
							onShowMemory={() => setShowMemory(true)}
							onToggleBrowser={() => {
								if (rightSidebarOpen && rightSidebarTab === "browser") {
									setRightSidebarOpen(false);
								} else {
									setRightSidebarTab("browser");
									setRightSidebarOpen(true);
								}
							}}
							browserOpen={rightSidebarOpen && rightSidebarTab === "browser"}
						/>
					</header>

					<ChatContainer>
						<ChatBackdrop />
						<MessageList />
						<TodoPanel />
						<TaskPanel />
						<RuntimePanel />
						{permissionRequests.length > 0 &&
							(!approvalInlineMounted || permissionRequests.length > 1) && (
								<ApprovalCardStack requests={permissionRequests} />
							)}
						<Composer />
					</ChatContainer>
					<Butterbar />
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
			<ConfirmHost />

			{/* ================== Modals ================== */}
			{showOnboarding && (
				<OnboardingModal
					onComplete={(path) => {
						if (path) setProjectPath(path);
						setShowOnboarding(false);
						if (!isFirstRunSetupComplete()) setShowFirstRunSetup(true);
					}}
				/>
			)}

			{showFirstRunSetup && !showOnboarding && engineReady && !trustPrompt && (
				<FirstRunSetup
					onClose={() => setShowFirstRunSetup(false)}
					onOpenSettings={() => setShowSettings(true)}
				/>
			)}

			{showResume && (
				<SessionPicker
					onClose={() => setShowResume(false)}
					onResume={async (sessionPath) => {
						setShowResume(false);
						pushCurrentToClosedTabs();
						try {
							const result = await runSwitch(sessionPath);
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
						await runSwitch(sessionId);
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
	id,
	title,
	children,
	className = "",
}: {
	id?: string;
	title: string;
	children: React.ReactNode;
	className?: string;
}) {
	const storageKey = id ? `a-coder:sidebar-section:${id}` : null;
	const [open, setOpen] = useState(() => {
		if (!storageKey) return true;
		try {
			return globalThis.localStorage.getItem(storageKey) !== "collapsed";
		} catch {
			return true;
		}
	});

	const setSectionOpen = (next: boolean) => {
		setOpen(next);
		if (!storageKey) return;
		try {
			globalThis.localStorage.setItem(storageKey, next ? "open" : "collapsed");
		} catch {
			/* storage unavailable — the section still collapses for this run */
		}
	};

	const toggle = () => setSectionOpen(!open);

	useEffect(() => {
		if (!id) return;
		const onOpen = (event: Event) => {
			const detail = (event as CustomEvent<{ id?: string }>).detail;
			if (detail?.id === id) setSectionOpen(true);
		};
		window.addEventListener("a-coder:open-sidebar-section", onOpen);
		return () => window.removeEventListener("a-coder:open-sidebar-section", onOpen);
	}, [id, storageKey]);

	return (
		<div id={id} className={`scroll-mt-3 ${className}`}>
			<button
				type="button"
				onClick={toggle}
				aria-expanded={open}
				className="mb-1.5 flex w-full items-center gap-1 rounded px-2.5 py-0.5 text-left transition-hover hover:bg-pi-surface-raised/60 focus-visible:shadow-focus focus-visible:outline-none"
			>
				<span className="text-3xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
					{title}
				</span>
				{open ? (
					<ChevronDown className="ml-auto h-3 w-3 shrink-0 text-pi-text-faint opacity-60" />
				) : (
					<ChevronRight className="ml-auto h-3 w-3 shrink-0 text-pi-text-faint opacity-60" />
				)}
			</button>
			{open && children}
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
				<SidebarSection id="sidebar-sessions" title="Sessions">
					<SessionList />
				</SidebarSection>
				<SidebarSection id="sidebar-projects" title="Projects" className="mt-4">
					<SidebarProjects onSelect={onPickProject} onAdd={onOpenPicker} />
				</SidebarSection>
				<SidebarSection id="sidebar-current" title="Current session" className="mt-4">
					<SessionActions />
				</SidebarSection>
				<SidebarSection id="sidebar-tree" title="Tree" className="mt-4">
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
	onJump: (section: "sessions" | "projects" | "tree") => void;
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
	onJump,
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
				<div className="my-1 h-px w-5 bg-pi-border" />
				<RailIcon icon={MessageSquare} label="Sessions" onClick={() => onJump("sessions")} />
				<RailIcon icon={FolderGit2} label="Projects" onClick={() => onJump("projects")} />
				<RailIcon icon={GitBranch} label="Session tree" onClick={() => onJump("tree")} />
				<RailIcon icon={Plus} label="New / open project" onClick={onOpenPicker} />
				<div className="flex-1" />
				<BackgroundAttentionOrb
					needsInput={needsBackgroundInput}
					finished={hasBackgroundFinished}
					onClick={onFocusBackground}
				/>
				<div className="my-1 h-px w-5 bg-pi-border" />
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
		<Tip content={label} placement="row">
			<button
				onClick={onClick}
				className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
				aria-label={label}
			>
				<IconCmp className="h-4 w-4" />
			</button>
		</Tip>
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
	// Wide enough that the rail (44px) still leaves the panels usable, e.g.
	// Git diff lines at their smallest.
	const MIN_WIDTH = 280;
	/** Wide enough to comfortably view rendered HTML artifacts. */
	const MAX_WIDTH = 960;

	// Never let the rail squeeze the chat/composer below readable width.
	const clampWidth = (w: number) => {
		const viewportMax = Math.max(MIN_WIDTH, window.innerWidth - 480);
		return Math.min(MAX_WIDTH, viewportMax, Math.max(MIN_WIDTH, w));
	};

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
					onDoubleClick={() => {
						triggerHaptic("selection");
						setRightSidebarWidth(320);
					}}
					title="Drag to resize · double-click to reset"
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
			// Hermes-parity paint/layout containment on the chat bounds: gives the
			// transcript + approval surfaces their own compositing boundary, which
			// the WKWebView layer tree needs to stay stable while tool rows and
			// approval cards mount.
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden [contain:layout_paint]"
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
			className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4"
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
			className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4"
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
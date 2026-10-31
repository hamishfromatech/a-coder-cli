import { create } from "zustand";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Api, Model } from "@earendil-works/pi-ai";
import type { MessageDeliveryMode } from "../lib/settings.types";
import { pickLoadingVerb } from "../lib/loading-verbs";
import { useActivityStore } from "./activity-store";

export type PermissionMode = "ask" | "allow" | "read-only" | "auto";

export type UiRequestMethod = "confirm" | "select" | "input" | "editor";

export interface UiRequest {
	id: string;
	method: UiRequestMethod;
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	/** "permission" marks a built-in tool-approval prompt. The desktop renders
	 * these as an inline approval bar instead of a modal. */
	kind?: "permission";
	toolName?: string;
	/** Present on run_workflow permission prompts: workflow name + declared phases. */
	workflow?: { name: string; phases: string[] };
	/** The session this request belongs to (Phase 2 session-scoped routing).
	 * Requests for other sessions stay queued until that session is active. */
	sessionFile?: string;
	resolve: (response: { confirmed?: boolean; value?: string; cancelled?: true }) => void;
}

export type AnyModel = Model<Api>;

/** Pending ask_user_question request (extension_ui_request method "question").
 *  Rendered inline on the pending tool-call row (hermes-style question card);
 *  null when no question is open for the active session. */
export interface QuestionUiRequest {
	id: string;
	questions: import("../lib/rpc").UserQuestion[];
}

export interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface SessionState {
	status: "idle" | "connecting" | "connected" | "error";
	error: string | null;
	cwd: string | null;
	sessionName: string | null;
	sessionId: string | null;
	sessionFile: string | null;
	/** Engine session activation id; frames from earlier activations are stale. */
	activationId: number;
	model: AnyModel | null;
	thinkingLevel: string | null;
	permissionMode: PermissionMode;
	/** Engine plan mode: mutating tools require approval until the agent exits. */
	planMode: boolean;
	isStreaming: boolean;
	/** True once the user requests an abort, until the next agent_start. Lets the
	 *  agent_end handler tell a user-cancelled turn end apart from a natural one
	 *  (so we don't chime on an abort). */
	abortRequested: boolean;
	isCompacting: boolean;
	autoCompactionEnabled: boolean;
	steeringMode: MessageDeliveryMode;
	followUpMode: MessageDeliveryMode;
	messageCount: number;
	pendingMessageCount: number;
	contextUsage: ContextUsage | null;
	messages: AgentMessage[];
	/** In-flight assistant message. Kept out of `messages` so the committed
	 *  transcript stays immutable and its array identity stable during a turn. */
	streamingMessage: AssistantMessage | null;
	/** Index of the first loaded message in the engine's context array. */
	messagesStart: number;
	/** Total context messages at the last history fetch. */
	messagesTotal: number;
	hasMoreOlder: boolean;
	loadingOlder: boolean;
	steering: string[];
	followUp: string[];
	/** Live snapshot of in-process background sub-agents (from subagents_update events). */
	subAgents: import("../lib/rpc").SubAgentRecord[];
	setSubAgents: (agents: import("../lib/rpc").SubAgentRecord[]) => void;
	/** Live snapshot of background bash processes (from background_processes_update events). */
	backgroundProcesses: import("../lib/rpc").BackgroundProcessRecord[];
	setBackgroundProcesses: (processes: import("../lib/rpc").BackgroundProcessRecord[]) => void;
	/** Live snapshot of workflow runs (from workflows_update events). */
	workflowRuns: import("../lib/rpc").WorkflowRunSummary[];
	setWorkflowRuns: (runs: import("../lib/rpc").WorkflowRunSummary[]) => void;
	streamingVerb: string;
	/** True while a session switch / resume is loading its history — the chat
	 *  area shows a loading state instead of the new-conversation EmptyState. */
	sessionLoading: boolean;
	setSessionLoading: (loading: boolean) => void;
	/** Commands returned by `rpc.getCommands()` — extension/skill/prompt slash commands. */
	availableCommands: Array<{
		name: string;
		description?: string;
		source: "extension" | "prompt" | "skill";
		sourceInfo: unknown;
	}>;
	setAvailableCommands: (
		commands: SessionState["availableCommands"],
	) => void;
	setStatus: (status: SessionState["status"], error?: string | null) => void;
	setCwd: (cwd: string) => void;
	setSessionName: (name: string | null) => void;
	setSessionId: (id: string | null) => void;
	setSessionFile: (file: string | null) => void;
	setActivationId: (id: number) => void;
	setModel: (model: AnyModel | null) => void;
	setThinkingLevel: (level: string | null) => void;
	setPermissionMode: (mode: PermissionMode) => void;
	setPlanMode: (planMode: boolean) => void;
	setIsStreaming: (isStreaming: boolean) => void;
	setAbortRequested: (abortRequested: boolean) => void;
	setIsCompacting: (isCompacting: boolean) => void;
	setAutoCompactionEnabled: (enabled: boolean) => void;
	setSteeringMode: (mode: MessageDeliveryMode) => void;
	setFollowUpMode: (mode: MessageDeliveryMode) => void;
	setStreamingVerb: (verb: string) => void;
	setMessageCount: (n: number) => void;
	setPendingMessageCount: (n: number) => void;
	setContextUsage: (usage: ContextUsage | null) => void;
	appendMessage: (message: AgentMessage) => void;
	setStreamingMessage: (message: AssistantMessage | null) => void;
	commitAssistantMessage: (message: AssistantMessage) => void;
	setMessages: (messages: AgentMessage[]) => void;
	setHistoryPage: (messages: AgentMessage[], total: number, start: number) => void;
	prependHistoryPage: (messages: AgentMessage[], start: number, total?: number) => void;
	setLoadingOlder: (loading: boolean) => void;
	updateQueue: (steering: string[], followUp: string[]) => void;
	resetSession: () => void;

	// Pending extension UI requests (permission prompts, selects, inputs, editor)
	uiRequests: UiRequest[];
	addUiRequest: (request: Omit<UiRequest, "resolve">) => Promise<{ confirmed?: boolean; value?: string; cancelled?: true }>;
	resolveUiRequest: (id: string, response: { confirmed?: boolean; value?: string; cancelled?: true }) => void;

	/** Active ask_user_question request for the currently-shown session. The
	 *  inline AskUserQuestionCard on the pending tool row reads and resolves it. */
	questionRequest: QuestionUiRequest | null;
	setQuestionRequest: (request: QuestionUiRequest | null) => void;

	// Inline approval anchor visibility. The inline tool-approval bar (rendered
	// under the pending tool row) sets this true while it is on screen, so the
	// floating fallback above the composer only appears when the inline bar is
	// scrolled out of view.
	approvalInlineMounted: boolean;
	setApprovalInlineMounted: (mounted: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
	status: "idle",
	error: null,
	cwd: null,
	sessionName: null,
	sessionId: null,
	sessionFile: null,
	activationId: 0,
	model: null,
	thinkingLevel: null,
	permissionMode: "allow",
	/** Engine plan mode: mutating tools require approval until the agent exits. */
	planMode: false,
	isStreaming: false,
	abortRequested: false,
	isCompacting: false,
	autoCompactionEnabled: true,
	steeringMode: "one-at-a-time",
	followUpMode: "one-at-a-time",
	messageCount: 0,
	pendingMessageCount: 0,
	contextUsage: null,
	messages: [],
	streamingMessage: null,
	messagesStart: 0,
	messagesTotal: 0,
	hasMoreOlder: false,
	loadingOlder: false,
	steering: [],
	followUp: [],
	subAgents: [],
	setSubAgents: (subAgents) => set({ subAgents }),
	backgroundProcesses: [],
	setBackgroundProcesses: (backgroundProcesses) => set({ backgroundProcesses }),
	workflowRuns: [],
	setWorkflowRuns: (workflowRuns) => set({ workflowRuns }),
	streamingVerb: pickLoadingVerb(),
	sessionLoading: false,
	availableCommands: [],
	setAvailableCommands: (availableCommands) => set({ availableCommands }),
	setSessionLoading: (sessionLoading) => set({ sessionLoading }),
	setStatus: (status, error = null) => set({ status, error: status === "error" ? error : null }),
	setCwd: (cwd) => set({ cwd }),
	setSessionName: (sessionName) => set({ sessionName }),
	setSessionId: (sessionId) => set({ sessionId }),
	setSessionFile: (sessionFile) => set({ sessionFile }),
	setActivationId: (activationId) => set({ activationId }),
	setModel: (model) => set({ model }),
	setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),
	setPermissionMode: (permissionMode) => set({ permissionMode }),
	setPlanMode: (planMode) => set({ planMode }),
	setIsStreaming: (isStreaming) => set({ isStreaming }),
	setAbortRequested: (abortRequested) => set({ abortRequested }),
	setIsCompacting: (isCompacting) => set({ isCompacting }),
	setAutoCompactionEnabled: (autoCompactionEnabled) => set({ autoCompactionEnabled }),
	setSteeringMode: (steeringMode) => set({ steeringMode }),
	setFollowUpMode: (followUpMode) => set({ followUpMode }),
	setStreamingVerb: (streamingVerb) => set({ streamingVerb }),
	setMessageCount: (messageCount) => set({ messageCount }),
	setPendingMessageCount: (pendingMessageCount) => set({ pendingMessageCount }),
	setContextUsage: (contextUsage) => set({ contextUsage }),
	appendMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
	setStreamingMessage: (streamingMessage) => set({ streamingMessage }),
	commitAssistantMessage: (message) =>
		set((state) => {
			const last = state.messages[state.messages.length - 1];
			if (last?.role === "assistant" && last.timestamp === message.timestamp) {
				return {
					messages: [...state.messages.slice(0, -1), message],
					streamingMessage: null,
				};
			}
			return { messages: [...state.messages, message], streamingMessage: null };
		}),
	setMessages: (messages) => set({ messages }),
	setHistoryPage: (messages, total, start) =>
		set({ messages, messagesTotal: total, messagesStart: start, hasMoreOlder: start > 0 }),
	prependHistoryPage: (messages, start, total) =>
		set((state) => ({
			messages: [...messages, ...state.messages],
			messagesStart: start,
			messagesTotal: total ?? state.messagesTotal,
			hasMoreOlder: start > 0,
		})),
	setLoadingOlder: (loadingOlder) => set({ loadingOlder }),
	updateQueue: (steering, followUp) => set({ steering, followUp }),
	resetSession: () =>
		set({
			messages: [],
			streamingMessage: null,
			messagesStart: 0,
			messagesTotal: 0,
			hasMoreOlder: false,
			loadingOlder: false,
			steering: [],
			followUp: [],
			subAgents: [],
			backgroundProcesses: [],
			planMode: false,
			workflowRuns: [],
			streamingVerb: pickLoadingVerb(),
			sessionLoading: false,
			sessionName: null,
			sessionId: null,
			sessionFile: null,
			messageCount: 0,
			pendingMessageCount: 0,
			contextUsage: null,
			isStreaming: false,
			abortRequested: false,
			isCompacting: false,
			error: null,
			questionRequest: null,
		}),
	uiRequests: [],
	approvalInlineMounted: false,
	setApprovalInlineMounted: (approvalInlineMounted) => set({ approvalInlineMounted }),
	addUiRequest: (request) =>
		new Promise((resolve) => {
			set((state) => ({
				uiRequests: [...state.uiRequests, { ...request, resolve }],
			}));
		}),
	resolveUiRequest: (id, response) =>
		set((state) => {
			const request = state.uiRequests.find((r) => r.id === id);
			if (!request) return state;
			request.resolve(response);
			useActivityStore.getState().resolve(`approval:request:${id}`);
			return { uiRequests: state.uiRequests.filter((r) => r.id !== id) };
		}),
	questionRequest: null,
	setQuestionRequest: (questionRequest) => set({ questionRequest }),
}));
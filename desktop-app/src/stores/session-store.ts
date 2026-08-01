import { create } from "zustand";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Api, Model } from "@earendil-works/pi-ai";
import type { MessageDeliveryMode } from "../lib/settings.types";

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
	resolve: (response: { confirmed?: boolean; value?: string; cancelled?: true }) => void;
}

export type AnyModel = Model<Api>;

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
	model: AnyModel | null;
	thinkingLevel: string | null;
	permissionMode: PermissionMode;
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
	steering: string[];
	followUp: string[];
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
	setModel: (model: AnyModel | null) => void;
	setThinkingLevel: (level: string | null) => void;
	setPermissionMode: (mode: PermissionMode) => void;
	setIsStreaming: (isStreaming: boolean) => void;
	setAbortRequested: (abortRequested: boolean) => void;
	setIsCompacting: (isCompacting: boolean) => void;
	setAutoCompactionEnabled: (enabled: boolean) => void;
	setSteeringMode: (mode: MessageDeliveryMode) => void;
	setFollowUpMode: (mode: MessageDeliveryMode) => void;
	setMessageCount: (n: number) => void;
	setPendingMessageCount: (n: number) => void;
	setContextUsage: (usage: ContextUsage | null) => void;
	appendMessage: (message: AgentMessage) => void;
	setMessages: (messages: AgentMessage[]) => void;
	updateLastAssistantMessage: (message: AssistantMessage) => void;
	updateQueue: (steering: string[], followUp: string[]) => void;
	resetSession: () => void;

	// Pending extension UI requests (permission prompts, selects, inputs, editor)
	uiRequests: UiRequest[];
	addUiRequest: (request: Omit<UiRequest, "resolve">) => Promise<{ confirmed?: boolean; value?: string; cancelled?: true }>;
	resolveUiRequest: (id: string, response: { confirmed?: boolean; value?: string; cancelled?: true }) => void;

	// Inline approval anchor visibility. The inline tool-approval bar (rendered
	// under the pending tool row) sets this true while it is on screen, so the
	// floating fallback above the composer only appears when the inline bar is
	// scrolled out of view.
	approvalInlineVisible: boolean;
	setApprovalInlineVisible: (visible: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
	status: "idle",
	error: null,
	cwd: null,
	sessionName: null,
	sessionId: null,
	sessionFile: null,
	model: null,
	thinkingLevel: null,
	permissionMode: "allow",
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
	steering: [],
	followUp: [],
	availableCommands: [],
	setAvailableCommands: (availableCommands) => set({ availableCommands }),
	setStatus: (status, error = null) => set({ status, error: status === "error" ? error : null }),
	setCwd: (cwd) => set({ cwd }),
	setSessionName: (sessionName) => set({ sessionName }),
	setSessionId: (sessionId) => set({ sessionId }),
	setSessionFile: (sessionFile) => set({ sessionFile }),
	setModel: (model) => set({ model }),
	setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),
	setPermissionMode: (permissionMode) => set({ permissionMode }),
	setIsStreaming: (isStreaming) => set({ isStreaming }),
	setAbortRequested: (abortRequested) => set({ abortRequested }),
	setIsCompacting: (isCompacting) => set({ isCompacting }),
	setAutoCompactionEnabled: (autoCompactionEnabled) => set({ autoCompactionEnabled }),
	setSteeringMode: (steeringMode) => set({ steeringMode }),
	setFollowUpMode: (followUpMode) => set({ followUpMode }),
	setMessageCount: (messageCount) => set({ messageCount }),
	setPendingMessageCount: (pendingMessageCount) => set({ pendingMessageCount }),
	setContextUsage: (contextUsage) => set({ contextUsage }),
	appendMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
	setMessages: (messages) => set({ messages }),
	updateLastAssistantMessage: (message) => {
		set((state) => {
			if (state.messages.length === 0) return state;
			const last = state.messages[state.messages.length - 1];
			if (last.role !== "assistant") return state;
			const updated = { ...last, content: message.content };
			return {
				messages: [...state.messages.slice(0, -1), updated as AgentMessage],
			};
		});
	},
	updateQueue: (steering, followUp) => set({ steering, followUp }),
	resetSession: () =>
		set({
			messages: [],
			steering: [],
			followUp: [],
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
		}),
	uiRequests: [],
	approvalInlineVisible: false,
	setApprovalInlineVisible: (approvalInlineVisible) => set({ approvalInlineVisible }),
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
			return { uiRequests: state.uiRequests.filter((r) => r.id !== id) };
		}),
}));
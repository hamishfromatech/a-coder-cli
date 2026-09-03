/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { SessionStats } from "../../core/agent-session.ts";
import type { RuntimeSessionStatus } from "../../core/agent-session-runtime.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type {
	Coworker,
	Errand,
	ErrandSchedule,
	Face,
	OfficeActivityEvent,
	OfficeHuddlePayload,
	OfficeSnapshot,
} from "../../core/office/types.ts";
import type { SessionEntry, SessionTreeNode } from "../../core/session-manager.ts";
import type { PermissionMode } from "../../core/settings-manager.ts";
import type { SourceInfo } from "../../core/source-info.ts";

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand =
	// Prompting
	| {
			id?: string;
			type: "prompt";
			message: string;
			images?: ImageContent[];
			streamingBehavior?: "steer" | "followUp";
			/** Target a background (detached) session by file path. */
			sessionPath?: string;
	  }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[]; sessionPath?: string }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[]; sessionPath?: string }
	| { id?: string; type: "abort"; sessionPath?: string }
	| { id?: string; type: "new_session"; parentSession?: string; cwd?: string }
	| { id?: string; type: "clear_conversation" }

	// State
	| { id?: string; type: "get_state" }

	// Model
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }
	| { id?: string; type: "refresh_models" }

	// Thinking
	| { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
	| { id?: string; type: "cycle_thinking_level" }

	// Permission mode
	| { id?: string; type: "set_permission_mode"; mode: PermissionMode }
	| { id?: string; type: "get_permission_mode" }

	// Plan mode
	| { id?: string; type: "set_plan_mode"; enabled: boolean }
	| { id?: string; type: "get_plan_mode" }

	// Auth
	| { id?: string; type: "reload_auth" }
	| { id?: string; type: "oauth_login"; providerId: string }

	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }

	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }
	| { id?: string; type: "set_compaction_auto_continue"; enabled: boolean }

	// Retry
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }

	// Bash
	| { id?: string; type: "bash"; command: string; excludeFromContext?: boolean }
	| { id?: string; type: "abort_bash" }

	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "export_jsonl"; outputPath?: string }
	| { id?: string; type: "import_jsonl"; inputPath: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "fork"; entryId: string }
	| { id?: string; type: "clone" }
	| { id?: string; type: "get_fork_messages" }
	| { id?: string; type: "get_entries"; since?: string }
	| { id?: string; type: "get_tree" }
	| { id?: string; type: "list_sessions" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }
	| { id?: string; type: "set_entry_label"; entryId: string; label: string | undefined }

	// Messages
	| { id?: string; type: "get_messages" }

	// File history
	| { id?: string; type: "rewind"; steps?: number }

	// Runtime registry (background sessions)
	| { id?: string; type: "get_sessions_status" }
	| { id?: string; type: "abort_session"; sessionPath: string }

	// Composio apps gallery
	| { id?: string; type: "composio_list_apps" }
	| { id?: string; type: "composio_connect_app"; slug: string }
	| { id?: string; type: "composio_disconnect_app"; connectedAccountId: string }

	// Your Office (coworkers, huddles, errands)
	| { id?: string; type: "office_list" }
	| { id?: string; type: "office_coworker_save"; coworker: OfficeRpcCoworkerInput }
	| { id?: string; type: "office_coworker_delete"; coworkerId: string }
	| { id?: string; type: "office_huddle_save"; huddle: OfficeRpcHuddleInput }
	| { id?: string; type: "office_huddle_delete"; huddleId: string }
	| { id?: string; type: "office_send"; huddleId: string; text: string; images?: OfficeRpcAttachment[] }
	| { id?: string; type: "office_huddle_get"; huddleId: string }
	| { id?: string; type: "office_stop"; huddleId: string }
	| { id?: string; type: "office_respond"; requestId: string; choice: string | null }
	| { id?: string; type: "office_errand_save"; errand: OfficeRpcErrandInput }
	| { id?: string; type: "office_errand_delete"; errandId: string }
	| { id?: string; type: "office_errand_run"; errandId: string }

	// Commands (available for invocation via prompt)
	| { id?: string; type: "get_commands" };

/** Coworker create/update payload (id set = update). */
export interface OfficeRpcCoworkerInput {
	id?: string;
	name: string;
	title?: string;
	description?: string;
	/** Custom soul text (regenerates the composed soul when set). */
	soul?: string;
	/** Set on update to keep the stored soul instead of recomposing. */
	keepSoul?: boolean;
	face?: Partial<Face>;
	model?: string;
	autonomy?: Coworker["autonomy"];
}

/** Huddle create/update payload (id set = update). */
export interface OfficeRpcHuddleInput {
	id?: string;
	name: string;
	members: string[];
}

/** Attachment riding an office_send (data URL form). */
export interface OfficeRpcAttachment {
	name: string;
	kind: "image" | "file";
	/** Data URL. */
	dataUrl: string;
}

/** Errand create/update payload (id set = update; partial fields). */
export interface OfficeRpcErrandInput {
	id?: string;
	coworkerId: string;
	name: string;
	prompt: string;
	schedule: ErrandSchedule;
	continuity: boolean;
	delivery: Errand["delivery"];
	huddleId?: string;
	enabled?: boolean;
}

// ============================================================================
// RPC Slash Command (for get_commands response)
// ============================================================================

/** A command available for invocation via prompt */
export interface RpcSlashCommand {
	/** Command name (without leading slash) */
	name: string;
	/** Human-readable description */
	description?: string;
	/** What kind of command this is */
	source: "extension" | "prompt" | "skill";
	/** Source metadata for the owning resource */
	sourceInfo: SourceInfo;
}

/** Serializable session summary for the session quick-switcher (dates as ISO strings). */
export interface RpcSessionInfo {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
}

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
	model?: Model<any>;
	thinkingLevel: ThinkingLevel;
	permissionMode: PermissionMode;
	planMode: boolean;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	compactionAutoContinue: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

// ============================================================================
// RPC Responses (stdout)
// ============================================================================

// Success responses with data
export type RpcResponse =
	// Prompting (async - events follow)
	| { id?: string; type: "response"; command: "prompt"; success: true }
	| { id?: string; type: "response"; command: "steer"; success: true }
	| { id?: string; type: "response"; command: "follow_up"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| { id?: string; type: "response"; command: "new_session"; success: true; data: { cancelled: boolean } }

	// State
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }

	// Model
	| {
			id?: string;
			type: "response";
			command: "set_model";
			success: true;
			data: Model<any>;
	  }
	| {
			id?: string;
			type: "response";
			command: "cycle_model";
			success: true;
			data: { model: Model<any>; thinkingLevel: ThinkingLevel; isScoped: boolean } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_models";
			success: true;
			data: { models: Model<any>[] };
	  }
	| { id?: string; type: "response"; command: "refresh_models"; success: true }

	// Thinking
	| { id?: string; type: "response"; command: "set_thinking_level"; success: true }
	| {
			id?: string;
			type: "response";
			command: "cycle_thinking_level";
			success: true;
			data: { level: ThinkingLevel } | null;
	  }

	// Permission mode
	| { id?: string; type: "response"; command: "set_permission_mode"; success: true }
	| {
			id?: string;
			type: "response";
			command: "get_permission_mode";
			success: true;
			data: { mode: PermissionMode };
	  }

	// Auth
	| { id?: string; type: "response"; command: "reload_auth"; success: true }

	// Queue modes
	| { id?: string; type: "response"; command: "set_steering_mode"; success: true }
	| { id?: string; type: "response"; command: "set_follow_up_mode"; success: true }

	// Compaction
	| { id?: string; type: "response"; command: "compact"; success: true; data: CompactionResult }
	| { id?: string; type: "response"; command: "set_auto_compaction"; success: true }
	| { id?: string; type: "response"; command: "set_compaction_auto_continue"; success: true }

	// Retry
	| { id?: string; type: "response"; command: "set_auto_retry"; success: true }
	| { id?: string; type: "response"; command: "abort_retry"; success: true }

	// Bash
	| { id?: string; type: "response"; command: "bash"; success: true; data: BashResult }
	| { id?: string; type: "response"; command: "abort_bash"; success: true }

	// Session
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: SessionStats }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "export_jsonl"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "import_jsonl"; success: true; data: { cancelled: boolean } }
	| {
			id?: string;
			type: "response";
			command: "switch_session";
			success: true;
			data: {
				cancelled: boolean;
				reattached?: boolean;
				snapshot?: { running: boolean; needsInput: boolean; pendingMessageCount: number };
			};
	  }
	| { id?: string; type: "response"; command: "fork"; success: true; data: { text: string; cancelled: boolean } }
	| { id?: string; type: "response"; command: "clone"; success: true; data: { cancelled: boolean } }
	| {
			id?: string;
			type: "response";
			command: "get_fork_messages";
			success: true;
			data: { messages: Array<{ entryId: string; text: string }> };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_entries";
			success: true;
			data: { entries: SessionEntry[]; leafId: string | null };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_tree";
			success: true;
			data: { tree: SessionTreeNode[]; leafId: string | null };
	  }
	| {
			id?: string;
			type: "response";
			command: "list_sessions";
			success: true;
			data: { sessions: RpcSessionInfo[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_last_assistant_text";
			success: true;
			data: { text: string | null };
	  }
	| { id?: string; type: "response"; command: "set_session_name"; success: true }
	| { id?: string; type: "response"; command: "set_entry_label"; success: true }

	// Runtime registry (background sessions)
	| {
			id?: string;
			type: "response";
			command: "get_sessions_status";
			success: true;
			data: { sessions: RuntimeSessionStatus[] };
	  }
	| { id?: string; type: "response"; command: "abort_session"; success: true; data: { found: boolean } }

	// Messages
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: AgentMessage[] } }

	// Commands
	| {
			id?: string;
			type: "response";
			command: "get_commands";
			success: true;
			data: { commands: RpcSlashCommand[] };
	  }

	// Your Office
	| { id?: string; type: "response"; command: "office_list"; success: true; data: OfficeSnapshot }
	| { id?: string; type: "response"; command: "office_coworker_save"; success: true; data: { coworker: Coworker } }
	| { id?: string; type: "response"; command: "office_coworker_delete"; success: true }
	| { id?: string; type: "response"; command: "office_huddle_save"; success: true; data: { huddleId: string } }
	| { id?: string; type: "response"; command: "office_huddle_delete"; success: true }
	| {
			id?: string;
			type: "response";
			command: "office_send";
			success: true;
			data: { huddleId: string; messageId: string };
	  }
	| { id?: string; type: "response"; command: "office_huddle_get"; success: true; data: OfficeHuddlePayload | null }
	| { id?: string; type: "response"; command: "office_stop"; success: true }
	| { id?: string; type: "response"; command: "office_respond"; success: true; data: { handled: boolean } }
	| { id?: string; type: "response"; command: "office_errand_save"; success: true; data: { errand: Errand } }
	| { id?: string; type: "response"; command: "office_errand_delete"; success: true }
	| { id?: string; type: "response"; command: "office_errand_run"; success: true }

	// Error response (any command can fail)
	| { id?: string; type: "response"; command: string; success: false; error: string };

// ============================================================================
// Extension UI Events (stdout)
// ============================================================================

/** Emitted when an extension needs user input */
export type RpcExtensionUIRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| {
			type: "extension_ui_request";
			id: string;
			method: "question";
			title: string;
			questions: RpcUserQuestion[];
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "confirm";
			title: string;
			message: string;
			timeout?: number;
			/** "permission" marks a built-in tool-approval prompt (vs a generic extension
			 * confirm). Desktop clients use it to render an inline approval bar instead
			 * of a modal. `toolName` names the tool awaiting approval. */
			kind?: "permission";
			toolName?: string;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "editor";
			title: string;
			prefill?: string;
			sessionFile?: string;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setStatus";
			statusKey: string;
			statusText: string | undefined;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines: string[] | undefined;
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

// ============================================================================
// Extension UI Commands (stdin)
// ============================================================================

/** Response to an extension UI request */
export type RpcExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; answers: Record<string, string> }
	| { type: "extension_ui_response"; id: string; cancelled: true };

/** Structured multiple-choice question (ask_user_question tool). */
export interface RpcUserQuestion {
	question: string;
	header: string;
	options: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
}

// ============================================================================
// Runtime registry events (stdout)
// ============================================================================

/** Emitted whenever the runtime registry changes: a session detaches (switched
 *  away mid-turn), a background turn starts/ends, or a background runtime is
 *  reaped. Push a snapshot via the `get_sessions_status` response shape. */
export interface RpcSessionsUpdateEvent {
	type: "sessions_update";
	sessions: RuntimeSessionStatus[];
}

/** Your Office roster changed (coworkers, statuses, huddle summaries, errands,
 *  pending prompts). Pushed on every office mutation and turn boundary. */
export interface RpcOfficeUpdateEvent {
	type: "office_update";
	snapshot: OfficeSnapshot;
}

/** A huddle's log changed (new messages, running state). */
export interface RpcOfficeHuddleEvent {
	type: "office_huddle";
	payload: OfficeHuddlePayload;
}

/** Live coworker activity (turn lifecycle, tool calls, completed speech). */
export interface RpcOfficeActivityEvent {
	type: "office_activity";
	activity: OfficeActivityEvent;
}

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];

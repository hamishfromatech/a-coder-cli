/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { LlamaCppStatus, SessionStats } from "../../core/agent-session.ts";
import type { RuntimeSessionStatus } from "../../core/agent-session-runtime.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type {
	CronCatchUpPolicy,
	CronConcurrencyPolicy,
	CronJob,
	CronJobRevision,
	CronRun,
	CronSchedule,
	CronSnapshot,
	CronVariable,
} from "../../core/cron/types.ts";
import type { InProcessSubAgentRecord } from "../../core/extensions/types.ts";
import type { McpServerState } from "../../core/mcp/status-store.ts";
import type {
	Coworker,
	CoworkerDetails,
	Errand,
	ErrandSchedule,
	Face,
	OfficeActivityEvent,
	OfficeHuddleDelta,
	OfficeHuddlePayload,
	OfficeSearchHit,
	OfficeSnapshot,
} from "../../core/office/types.ts";
import type { SessionEntry, SessionTreeNode } from "../../core/session-manager.ts";
import type {
	AutoContinueSettings,
	PermissionMode,
	ResolvedAutoContinueSettings,
} from "../../core/settings-manager.ts";
import type { SourceInfo } from "../../core/source-info.ts";

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand =
	// Protocol negotiation (sent once after connect; defaults to contract 1)
	| {
			id?: string;
			type: "client_info";
			contract?: number;
			capabilities?: RpcCapability[];
	  }

	// Prompting
	| {
			id?: string;
			type: "prompt";
			message: string;
			images?: ImageContent[];
			streamingBehavior?: "steer" | "followUp";
			/** Target a background (detached) session by file path. */
			sessionPath?: string;
			/** Voice-call turn: bind `voiceTurnModel` for this turn only. */
			voiceTurn?: boolean;
	  }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[]; sessionPath?: string }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[]; sessionPath?: string }
	| { id?: string; type: "abort"; sessionPath?: string }
	| { id?: string; type: "clear_queue"; sessionPath?: string }
	| { id?: string; type: "queue_remove"; kind: "steering" | "followUp"; index: number; sessionPath?: string }
	| { id?: string; type: "stop_workflow_run"; runId: string }
	| { id?: string; type: "kill_subagent"; subagentId: string }
	| { id?: string; type: "rerun_subagent"; subagentId: string }
	| { id?: string; type: "remove_subagent"; subagentId: string }
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
	| { id?: string; type: "set_system_prompt_addendum"; addendum: string | null }

	// Permission mode
	| { id?: string; type: "set_permission_mode"; mode: PermissionMode }
	| { id?: string; type: "get_permission_mode" }

	// Session allow rules (e.g. the desktop approval card's "Always allow")
	| { id?: string; type: "add_session_allow_rules"; rules: string[] }

	// Plan mode
	| { id?: string; type: "set_plan_mode"; enabled: boolean }
	| { id?: string; type: "get_plan_mode" }

	// Auth
	| { id?: string; type: "reload_auth" }
	| { id?: string; type: "oauth_login"; providerId: string }

	// MCP
	| { id?: string; type: "mcp_status" }
	| { id?: string; type: "mcp_reconnect"; name?: string }

	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }

	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }
	| { id?: string; type: "set_compaction_auto_continue"; enabled: boolean }

	// Decision models / smart auto-continue
	| { id?: string; type: "get_decision_models" }
	| { id?: string; type: "get_llama_cpp_status" }
	| { id?: string; type: "get_auto_continue_settings" }
	| { id?: string; type: "set_auto_continue_settings"; settings: AutoContinueSettings }
	| { id?: string; type: "set_cron_model"; model?: string }

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
	| { id?: string; type: "switch_session"; sessionPath: string; cwd?: string }
	| { id?: string; type: "fork"; entryId: string }
	| { id?: string; type: "clone" }
	| { id?: string; type: "get_fork_messages" }
	| { id?: string; type: "get_entries"; since?: string }
	| { id?: string; type: "get_tree"; flat?: boolean }
	| { id?: string; type: "list_sessions"; limit?: number; cwd?: string }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string; sessionPath?: string }
	| { id?: string; type: "rename_session"; sessionPath: string; name: string }
	| { id?: string; type: "delete_session"; sessionPath: string }
	| { id?: string; type: "set_entry_label"; entryId: string; label: string | undefined }

	// Messages (paginated when limit/before is supplied; full otherwise)
	| {
			id?: string;
			type: "get_messages";
			limit?: number;
			before?: number;
			/** Read a detached (background) runtime instead of the active session. */
			sessionPath?: string;
	  }
	| { id?: string; type: "get_attachment"; attachmentId: string }
	| {
			id?: string;
			type: "get_transcript_page";
			limit?: number;
			before?: number;
			sessionPath?: string;
	  }

	// Combined state + stats for session activation
	| { id?: string; type: "get_session_snapshot" }

	// File history
	| { id?: string; type: "rewind"; steps?: number }

	// Runtime registry (background sessions)
	| { id?: string; type: "get_sessions_status" }
	| { id?: string; type: "abort_session"; sessionPath: string }
	| { id?: string; type: "subscribe_session"; sessionPath: string }
	| { id?: string; type: "unsubscribe_session"; sessionPath: string }

	// Your Office (coworkers, huddles, errands)
	| { id?: string; type: "office_list" }
	| { id?: string; type: "office_coworker_details"; coworkerId: string }
	| { id?: string; type: "office_coworker_save"; coworker: OfficeRpcCoworkerInput }
	| { id?: string; type: "office_coworker_delete"; coworkerId: string }
	| { id?: string; type: "office_huddle_save"; huddle: OfficeRpcHuddleInput }
	| { id?: string; type: "office_huddle_delete"; huddleId: string }
	| { id?: string; type: "office_send"; huddleId: string; text: string; images?: OfficeRpcAttachment[] }
	| { id?: string; type: "office_huddle_get"; huddleId: string }
	| { id?: string; type: "office_message_delete"; huddleId: string; messageId: string }
	| { id?: string; type: "office_search"; query: string; limit?: number }
	| { id?: string; type: "office_stop"; huddleId: string }
	| { id?: string; type: "office_respond"; requestId: string; choice: string | null }
	| { id?: string; type: "office_errand_save"; errand: OfficeRpcErrandInput }
	| { id?: string; type: "office_errand_delete"; errandId: string }
	| { id?: string; type: "office_errand_run"; errandId: string }

	// Cron (scheduled tasks for the main agent)
	| { id?: string; type: "cron_list" }
	| { id?: string; type: "cron_create"; job: CronRpcJobInput }
	| { id?: string; type: "cron_update"; jobId: string; patch: CronRpcJobPatch }
	| { id?: string; type: "cron_delete"; jobId: string }
	| { id?: string; type: "cron_run_now"; jobId: string; variables?: Record<string, string> }
	| { id?: string; type: "cron_runs"; jobId?: string; limit?: number }
	| { id?: string; type: "cron_revisions"; jobId: string }
	| { id?: string; type: "cron_restore_revision"; jobId: string; revisionId: string }

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
	/** TTS voice id for huddle calls; clears when omitted. */
	voice?: string;
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
	/** Last assistant model id, when available. */
	model?: string;
	/** Summed provider-reported usage. */
	totalTokens?: number;
	totalCost?: number;
}

/** Incremental tree change for contract-2 clients. */
export interface RpcTreeDeltaEvent {
	type: "tree_delta";
	version?: number;
	leafId?: string | null;
	added?: RpcSessionTreeFlatNode[];
	updated?: RpcSessionTreeFlatNode[];
	removed?: string[];
}

/** One entry in the full transcript view (pre-compaction history included). */
export interface RpcTranscriptEntry {
	id: string;
	parentId: string | null;
	type: string;
	timestamp: string;
	message?: AgentMessage;
	summary?: string;
	fromId?: string;
	firstKeptEntryId?: string;
	tokensBefore?: number;
	customType?: string;
	content?: unknown;
	display?: boolean;
}

/** Flat session-tree node (message bodies omitted). */
export interface RpcSessionTreeFlatNode {
	id: string;
	parentId: string | null;
	type: string;
	messageRole?: string;
	timestamp?: string;
	label?: string;
	labelTimestamp?: string;
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
	/** Workspace the session runs in (clients sync their project indicator to it). */
	cwd?: string;
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	/** Monotonic id for the current engine session activation. Events carry
	 *  the same value so a client can discard frames from a prior activation. */
	activationId?: number;
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
	// Protocol negotiation
	| {
			id?: string;
			type: "response";
			command: "client_info";
			success: true;
			data: { contract: number; capabilities: RpcCapability[] };
	  }

	// Prompting (async - events follow)
	| { id?: string; type: "response"; command: "prompt"; success: true }
	| { id?: string; type: "response"; command: "steer"; success: true }
	| { id?: string; type: "response"; command: "follow_up"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| {
			id?: string;
			type: "response";
			command: "clear_queue";
			success: true;
			data: { steering: string[]; followUp: string[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "queue_remove";
			success: true;
			data: { removed: boolean };
	  }
	| {
			id?: string;
			type: "response";
			command: "new_session";
			success: true;
			data: { cancelled: boolean; activationId?: number };
	  }

	// State
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }
	| {
			id?: string;
			type: "response";
			command: "get_decision_models";
			success: true;
			data: {
				models: Array<{
					provider: string;
					id: string;
					name: string;
					input: ("text" | "image")[];
					contextWindow: number;
				}>;
				autoContinue: ResolvedAutoContinueSettings;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "get_auto_continue_settings";
			success: true;
			data: ResolvedAutoContinueSettings;
	  }
	| { id?: string; type: "response"; command: "set_auto_continue_settings"; success: true }

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
	| {
			id?: string;
			type: "response";
			command: "get_llama_cpp_status";
			success: true;
			data: LlamaCppStatus;
	  }

	// Thinking
	| { id?: string; type: "response"; command: "set_thinking_level"; success: true }
	| { id?: string; type: "response"; command: "set_system_prompt_addendum"; success: true }
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
	| { id?: string; type: "response"; command: "add_session_allow_rules"; success: true }

	// Auth
	| { id?: string; type: "response"; command: "reload_auth"; success: true }
	| {
			id?: string;
			type: "response";
			command: "mcp_status";
			success: true;
			data: { servers: McpServerState[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "mcp_reconnect";
			success: true;
			data: { ok: boolean; error?: string; deferred: boolean; name?: string };
	  }

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
				activationId?: number;
				sessionFile?: string;
				sessionId?: string;
				sessionName?: string;
				cwd?: string;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "fork";
			success: true;
			data: { text: string; cancelled: boolean; activationId?: number };
	  }
	| {
			id?: string;
			type: "response";
			command: "clone";
			success: true;
			data: { cancelled: boolean; activationId?: number };
	  }
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
			data: {
				tree?: SessionTreeNode[];
				nodes?: RpcSessionTreeFlatNode[];
				leafId: string | null;
				version?: number;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "list_sessions";
			success: true;
			data: { sessions: RpcSessionInfo[]; total: number };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_last_assistant_text";
			success: true;
			data: { text: string | null };
	  }
	| { id?: string; type: "response"; command: "set_session_name"; success: true }
	| { id?: string; type: "response"; command: "rename_session"; success: true }
	| { id?: string; type: "response"; command: "delete_session"; success: true; data: { trashPath: string } }
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
	| {
			id?: string;
			type: "response";
			command: "subscribe_session";
			success: true;
			data: {
				subscribed: boolean;
				sessionFile?: string;
				sessionId?: string;
				activationId?: number;
				active?: boolean;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "unsubscribe_session";
			success: true;
			data: { unsubscribed: boolean };
	  }

	// Sub-agents (running-tasks viewer / desktop manager)
	| {
			id?: string;
			type: "response";
			command: "kill_subagent";
			success: true;
			data: { subagent: InProcessSubAgentRecord };
	  }
	| { id?: string; type: "response"; command: "rerun_subagent"; success: true; data: { id: string } }
	| {
			id?: string;
			type: "response";
			command: "remove_subagent";
			success: true;
			data: { removed: boolean };
	  }

	// Messages
	| {
			id?: string;
			type: "response";
			command: "get_messages";
			success: true;
			data: {
				messages: AgentMessage[];
				total?: number;
				start?: number;
				end?: number;
				hasMore?: boolean;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "get_attachment";
			success: true;
			data: { id: string; mimeType: string; bytes: number; data: string };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_transcript_page";
			success: true;
			data: {
				entries: RpcTranscriptEntry[];
				total: number;
				start: number;
				end: number;
				hasMore: boolean;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "get_session_snapshot";
			success: true;
			data: { state: RpcSessionState; stats: SessionStats };
	  }

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
	| {
			id?: string;
			type: "response";
			command: "office_coworker_details";
			success: true;
			data: CoworkerDetails;
	  }
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
	| { id?: string; type: "response"; command: "office_search"; success: true; data: OfficeSearchHit[] }
	| {
			id?: string;
			type: "response";
			command: "office_message_delete";
			success: true;
			data: { removed: boolean };
	  }
	| { id?: string; type: "response"; command: "office_stop"; success: true }
	| { id?: string; type: "response"; command: "office_respond"; success: true; data: { handled: boolean } }
	| { id?: string; type: "response"; command: "office_errand_save"; success: true; data: { errand: Errand } }
	| { id?: string; type: "response"; command: "office_errand_delete"; success: true }
	| { id?: string; type: "response"; command: "office_errand_run"; success: true }

	// Cron
	| { id?: string; type: "response"; command: "cron_list"; success: true; data: CronSnapshot }
	| { id?: string; type: "response"; command: "cron_create"; success: true; data: { job: CronJob } }
	| { id?: string; type: "response"; command: "cron_update"; success: true; data: { job: CronJob } }
	| { id?: string; type: "response"; command: "cron_delete"; success: true }
	| { id?: string; type: "response"; command: "cron_run_now"; success: true }
	| {
			id?: string;
			type: "response";
			command: "cron_runs";
			success: true;
			data: { runs: CronRun[]; jobId?: string | null };
	  }
	| { id?: string; type: "response"; command: "cron_revisions"; success: true; data: { revisions: CronJobRevision[] } }
	| { id?: string; type: "response"; command: "cron_restore_revision"; success: true; data: { job: CronJob } }

	// Error response (any command can fail). `error` stays the human-readable
	// message for older clients; code/retryable/details are additive.
	| {
			id?: string;
			type: "response";
			command: string;
			success: false;
			error: string;
			code?: string;
			retryable?: boolean;
			details?: Record<string, unknown>;
	  };

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
			 * of a modal. `toolName` names the tool awaiting approval. For run_workflow
			 * prompts, `workflow` carries the workflow name and declared phases so the
			 * desktop can render a workflow-specific approval card. */
			kind?: "permission";
			toolName?: string;
			workflow?: { name: string; phases: string[] };
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

/**
 * Engine protocol contract version. Bump when the RPC event/command vocabulary
 * changes incompatibly; embedded clients compare it against the range they
 * support when the engine_info event arrives. Clients that predate this field
 * ignore the event and treat the engine as contract 1.
 */
export const RPC_CONTRACT = 1;

/** Optional protocol features a client can opt into. All are additive; a
 *  client that sends none keeps the contract-1 event stream. */
export type RpcCapability =
	/** Compact `message_delta` streaming instead of full `message_update` snapshots. */
	| "delta"
	/** Coalesce events into `event_batch` frames at ~30Hz. */
	| "batch"
	/** Live `tool_execution_*` progress events (not emitted by default). */
	| "tool-progress"
	/** History pages replace inline image data with `attachment` refs. */
	| "attachments";

/** First event on the stdout stream: identifies the engine and its protocol
 *  contract so clients can detect engine/client skew early. */
export interface RpcEngineInfoEvent {
	type: "engine_info";
	version: string;
	contract: number;
	/** Features this engine can serve; pair with `client_info` to negotiate. */
	capabilities?: RpcCapability[];
}

/** Emitted whenever the runtime registry changes: a session detaches (switched
 *  away mid-turn), a background turn starts/ends, or a background runtime is
 *  reaped. Push a snapshot via the `get_sessions_status` response shape. */
export interface RpcSessionsUpdateEvent {
	type: "sessions_update";
	sessions: RuntimeSessionStatus[];
}

/** Compact streaming delta (contract 2). Only text/thinking content is
 *  streamed this way; tool-call blocks arrive as a `message_snapshot` at
 *  `toolcall_end` and the authoritative full message arrives at `message_end`. */
export interface RpcMessageDeltaEvent {
	type: "message_delta";
	sessionId: string;
	sessionFile?: string;
	activationId?: number;
	messageId: string;
	contentIndex: number;
	kind: "text" | "thinking";
	delta: string;
}

/** Full partial assistant message, sent at block boundaries (tool-call end)
 *  for contract-2 clients so they can resync without per-token snapshots. */
export interface RpcMessageSnapshotEvent {
	type: "message_snapshot";
	sessionId: string;
	sessionFile?: string;
	activationId?: number;
	messageId: string;
	message: unknown;
}

/** Tool call started (contract 2 with `tool-progress`). */
export interface RpcToolStartEvent {
	type: "tool_start";
	toolCallId: string;
	toolName: string;
	args?: unknown;
}

/** Incremental tool output (contract 2 with `tool-progress`). The client
 *  appends `delta` unless `reset` is true, in which case it replaces the
 *  stream (the producer's window shifted). */
export interface RpcToolDeltaEvent {
	type: "tool_delta";
	toolCallId: string;
	toolName: string;
	stream: "stdout" | "stderr";
	delta: string;
	reset?: boolean;
}

/** Live progress for a running tool call (contract 2 with `tool-progress`).
 *  MCP servers emit this through `notifications/progress`; the UI shows the
 *  percent/message beside the running row and never mutates the transcript. */
export interface RpcToolProgressEvent {
	type: "tool_progress";
	toolCallId: string;
	toolName: string;
	progress: number;
	total?: number;
	percent?: number;
	message?: string;
}

/** Tool call finished; the authoritative result still arrives as a
 *  `toolResult` message. */
export interface RpcToolEndEvent {
	type: "tool_end";
	toolCallId: string;
	toolName: string;
	isError: boolean;
}

/** Compact `agent_end` summary for contract-2 clients (the full run messages
 *  are already on the transcript). */
export interface RpcAgentEndSummary {
	messageCount: number;
	lastAssistantText: string;
	stopReason?: string;
	usage?: unknown;
}

/** Coalesced event frame (contract 2). Events inside are already sequenced. */
export interface RpcEventBatch {
	type: "event_batch";
	seq: number;
	events: Array<Record<string, unknown>>;
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

/** Appended messages + live drive state for a huddle. Clients that have not
 *  loaded the room yet should ignore this and fetch `office_huddle_get`. */
export interface RpcOfficeHuddleDeltaEvent {
	type: "office_huddle_delta";
	delta: OfficeHuddleDelta;
}

/** Live coworker activity (turn lifecycle, tool calls, completed speech). */
export interface RpcOfficeActivityEvent {
	type: "office_activity";
	activity: OfficeActivityEvent;
}

/** Cron jobs changed (created, updated, edited, fired). Pushed on every mutation. */
export interface RpcCronUpdateEvent {
	type: "cron_update";
	jobs: CronJob[];
}

/** A stored session was created, renamed, updated, or deleted. */
export interface RpcSessionChangedEvent {
	type: "session_changed";
	event: "created" | "updated" | "deleted";
	sessionPath: string;
	name?: string;
}

/** Session statistics changed (turn end, compaction). Pushed so clients do not
 *  need a polling timer. */
export interface RpcSessionStatsEvent {
	type: "session_stats";
	stats: SessionStats;
}

/** A cron run started or finished — the activity inbox consumes these. */
export interface RpcCronRunEvent {
	type: "cron_run";
	event: "started" | "finished";
	run: CronRun;
}

/** Cron job create payload. */
export interface CronRpcJobInput {
	name: string;
	prompt: string;
	schedule: CronSchedule;
	enabled?: boolean;
	/** Project scope; defaults to the engine's cwd. */
	cwd?: string;
	concurrencyPolicy?: CronConcurrencyPolicy;
	catchUpPolicy?: CronCatchUpPolicy;
	variables?: CronVariable[];
	isolated?: boolean;
}

/** Cron job update patch. */
export type CronRpcJobPatch = Partial<
	Pick<
		CronJob,
		"name" | "prompt" | "schedule" | "enabled" | "concurrencyPolicy" | "catchUpPolicy" | "variables" | "isolated"
	>
>;

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];

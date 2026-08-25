import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { PermissionMode } from "../stores/session-store";

// Events emitted by the engine include standard AgentEvents plus extension UI requests and queue updates.
export interface SessionStartEvent {
	type: "session_start";
		reason: "startup" | "reload" | "new" | "resume" | "fork" | "clear";
	previousSessionFile?: string;
}

/** The engine renamed the active session. Emitted by the CLI's AgentSession. */
export interface SessionInfoChangedEvent {
	type: "session_info_changed";
	name: string | undefined;
}

export type RpcEvent =
	| AgentEvent
	| SessionStartEvent
	| SessionInfoChangedEvent
	| ExtensionUiRequestEvent
	| QueueUpdateEvent
	| SubagentsUpdateEvent
	| AutoRetryStartEvent
	| AutoRetryEndEvent
	| CompactionEndEvent;

/** The engine re-emits agent_end with a retry hint after a retryable failure. */
export interface AgentEndWillRetry {
	type: "agent_end";
	messages: unknown[];
	willRetry: boolean;
}

export interface AutoRetryStartEvent {
	type: "auto_retry_start";
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	errorMessage: string;
}

export interface AutoRetryEndEvent {
	type: "auto_retry_end";
	success: boolean;
	attempt: number;
	finalError?: string;
}

export interface CompactionEndEvent {
	type: "compaction_end";
	reason: "manual" | "threshold" | "overflow";
	result?: {
		summary: string;
		firstKeptEntryId: string;
		tokensBefore: number;
		estimatedTokensAfter: number;
		details?: unknown;
	};
	aborted: boolean;
	willRetry: boolean;
	errorMessage?: string;
}

export interface QueueUpdateEvent {
	type: "queue_update";
	steering: string[];
	followUp: string[];
}

/** Live snapshot of the in-process sub-agent store (background sub-agents + Agent Teams teammates). */
export type SubAgentTimelineEvent =
	| { type: "tool_use_start"; toolName: string }
	| { type: "tool_use_done"; toolName: string; isError?: boolean }
	| { type: "text"; text: string }
	| { type: "turn_complete"; turnCount: number }
	| { type: "completed"; finalText: string; toolUseCount: number; turnCount: number }
	| { type: "aborted" };

export interface SubagentsUpdateEvent {
	type: "subagents_update";
	agents: SubAgentRecord[];
}

export interface SubAgentRecord {
	id: string;
	agentType: string;
	status: "running" | "completed" | "failed" | "killed";
	createdAt: number;
	startedAt: number;
	updatedAt: number;
	/** The task/prompt the sub-agent was spawned with (its goal). */
	goal?: string;
	/** The model id the sub-agent is running with. */
	model?: string;
	finalText?: string;
	toolUseCount: number;
	turnCount: number;
	totalTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	lastToolName?: string;
	worktreePath?: string;
	worktreeBranch?: string;
	teammateName?: string;
	outputFile?: string;
	error?: string;
	/** Ordered progress events (live transcript tail for the viewer). */
	timeline?: SubAgentTimelineEvent[];
}

export type ExtensionUiRequestEvent =
	| {
			type: "extension_ui_request";
			id: string;
			method: "select";
			title: string;
			options: string[];
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "question";
			title: string;
			questions: UserQuestion[];
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "confirm";
			title: string;
			message: string;
			timeout?: number;
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
			statusText?: string;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines?: string[];
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setTitle";
			title: string;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "set_editor_text";
			text: string;
	  };

export type ExtensionUiResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; answers: Record<string, string> }
	| { type: "extension_ui_response"; id: string; cancelled: true };

/** Structured multiple-choice question (ask_user_question tool). */
export interface UserQuestion {
	question: string;
	header: string;
	options: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
}

export type AgentRole = "user" | "assistant" | "system" | "tool";

export interface SessionTreeNode {
	entry: {
		id: string;
		type: string;
		parentId: string | null;
		message?: { role: AgentRole };
		label?: string;
	};
	children: SessionTreeNode[];
	label?: string;
}

export async function connect(args: {
	cwd: string;
	cliPath?: string;
	provider?: string;
	model?: string;
	continueSession?: boolean;
}): Promise<void> {
	await invoke("connect", {
		args: {
			cwd: args.cwd,
			cli_path: args.cliPath,
			provider: args.provider,
			model: args.model,
			continue_session: args.continueSession,
		},
	});
}

export async function disconnect(): Promise<void> {
	await invoke("disconnect");
}

export async function sendCommand(command: unknown): Promise<unknown> {
	return await invoke("send_command", { command });
}

export async function sendUiResponse(response: ExtensionUiResponse): Promise<void> {
	await invoke("send_ui_response", { response });
}

// ============================================================================
// Typed engine command surface (mirrors packages/coding-agent/src/modes/rpc/rpc-types.ts)
// ============================================================================

import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";

export type { ThinkingLevel };

export type MessageDeliveryMode = "one-at-a-time" | "all";

export interface BashResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	cancelled?: boolean;
}

export interface SessionStats {
	tokens?: number;
	cost?: number;
	durationMs?: number;
	messageCount?: number;
	[key: string]: unknown;
}

export interface CompactionResult {
	summary?: string;
	tokensBefore?: number;
	tokensAfter?: number;
	cancelled?: boolean;
}

export interface ForkMessagesResult {
	messages: Array<{ entryId: string; text: string }>;
}

export interface GetEntriesResult {
	entries: Array<{
		id: string;
		type: string;
		parentId: string | null;
		message?: { role: AgentRole };
		label?: string;
	}>;
	leafId: string | null;
}

export interface SwitchSessionResult {
	cancelled: boolean;
}

export interface NewSessionResult {
	cancelled: boolean;
}

export interface ForkResult {
	text: string;
	cancelled: boolean;
}

export interface CloneResult {
	cancelled: boolean;
}

export interface ExportHtmlResult {
	path: string;
}

export interface LastAssistantTextResult {
	text: string | null;
}

export interface SetModelResult {
	provider: string;
	id: string;
	name?: string;
	api?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	input?: string[];
	cost?: Record<string, number>;
}

export interface CycleModelResult {
	model: SetModelResult;
	thinkingLevel: ThinkingLevel;
	isScoped: boolean;
}

export interface GetMessagesResult {
	messages: AgentMessage[];
}

export interface RpcSlashCommand {
	/** Command name (without leading slash) */
	name: string;
	/** Human-readable description */
	description?: string;
	/** What kind of command this is */
	source: "extension" | "prompt" | "skill";
	/** Source metadata for the owning resource */
	sourceInfo: {
		type: string;
		path?: string;
		package?: string;
		[key: string]: unknown;
	};
}

export interface GetCommandsResult {
	commands: RpcSlashCommand[];
}

// ---- prompting ----
export const prompt = (message: string, images?: ImageContent[]) =>
	sendCommand({ type: "prompt", message, images });
export const steer = (message: string, images?: ImageContent[]) =>
	sendCommand({ type: "steer", message, images });
export const followUp = (message: string, images?: ImageContent[]) =>
	sendCommand({ type: "follow_up", message, images });
export const abort = () => sendCommand({ type: "abort" });
export const newSession = (parentSession?: string) =>
	sendCommand({ type: "new_session", parentSession });
export const clearConversation = () =>
	sendCommand({ type: "clear_conversation" }) as Promise<{ cancelled: boolean }>;

// ---- state / model ----
export const getState = () => sendCommand({ type: "get_state" });
export const setModel = (provider: string, modelId: string) =>
	sendCommand({ type: "set_model", provider, modelId });
export const cycleModel = () => sendCommand({ type: "cycle_model" });
export const getAvailableModels = () =>
	sendCommand({ type: "get_available_models" }) as Promise<{ models: Model<any>[] }>;
export const refreshModels = () => sendCommand({ type: "refresh_models" });

// ---- thinking ----
export const setThinkingLevel = (level: ThinkingLevel) =>
	sendCommand({ type: "set_thinking_level", level });
export const cycleThinkingLevel = () => sendCommand({ type: "cycle_thinking_level" });

// ---- permission mode ----
export const getPermissionMode = () =>
	sendCommand({ type: "get_permission_mode" }) as Promise<{ mode: PermissionMode }>;
export const setPermissionMode = (mode: PermissionMode) =>
	sendCommand({ type: "set_permission_mode", mode });

// ---- auth ----
export const reloadAuth = () => sendCommand({ type: "reload_auth" });

// ---- queue modes ----
export const setSteeringMode = (mode: MessageDeliveryMode) =>
	sendCommand({ type: "set_steering_mode", mode });
export const setFollowUpMode = (mode: MessageDeliveryMode) =>
	sendCommand({ type: "set_follow_up_mode", mode });

// ---- compaction ----
export const compact = (customInstructions?: string) =>
	sendCommand({ type: "compact", customInstructions });
export const setAutoCompaction = (enabled: boolean) =>
	sendCommand({ type: "set_auto_compaction", enabled });

// ---- retry ----
export const setAutoRetry = (enabled: boolean) =>
	sendCommand({ type: "set_auto_retry", enabled });
export const abortRetry = () => sendCommand({ type: "abort_retry" });

// ---- bash ----
export const bash = (command: string, excludeFromContext = false) =>
	sendCommand({ type: "bash", command, excludeFromContext });
export const abortBash = () => sendCommand({ type: "abort_bash" });

// ---- session ----
export const getSessionStats = () => sendCommand({ type: "get_session_stats" }) as Promise<SessionStats>;
export const exportHtml = (outputPath?: string) =>
	sendCommand({ type: "export_html", outputPath }) as Promise<ExportHtmlResult>;
export const switchSession = (sessionPath: string) =>
	sendCommand({ type: "switch_session", sessionPath }) as Promise<SwitchSessionResult>;
export const fork = (entryId: string) =>
	sendCommand({ type: "fork", entryId }) as Promise<ForkResult>;
export const clone = () => sendCommand({ type: "clone" }) as Promise<CloneResult>;
export const getForkMessages = () =>
	sendCommand({ type: "get_fork_messages" }) as Promise<ForkMessagesResult>;
export const getEntries = (since?: string) =>
	sendCommand({ type: "get_entries", since }) as Promise<GetEntriesResult>;
export const getTree = () => sendCommand({ type: "get_tree" });

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

export const listSessions = () =>
	sendCommand({ type: "list_sessions" }) as Promise<{ sessions: RpcSessionInfo[] }>;
export const getLastAssistantText = () =>
	sendCommand({ type: "get_last_assistant_text" }) as Promise<LastAssistantTextResult>;
export const setSessionName = (name: string) =>
	sendCommand({ type: "set_session_name", name });
export const setEntryLabel = (entryId: string, label: string | undefined) =>
	sendCommand({ type: "set_entry_label", entryId, label }) as Promise<void>;

// ---- messages ----
export const getMessages = () =>
	sendCommand({ type: "get_messages" }) as Promise<GetMessagesResult>;

// ---- file history / rewind ----
export interface RewindResult {
	steps: number;
	filesChanged: string[];
	insertions: number;
	deletions: number;
}
export const rewind = (steps?: number) =>
	sendCommand({ type: "rewind", steps }) as Promise<RewindResult>;

// ---- session import/export (jsonl) ----
export const exportJsonl = (outputPath?: string) =>
	sendCommand({ type: "export_jsonl", outputPath }) as Promise<ExportHtmlResult>;
export const importJsonl = (inputPath: string) =>
	sendCommand({ type: "import_jsonl", inputPath }) as Promise<SwitchSessionResult>;

// ---- commands (slash-command discovery) ----
export const getCommands = () =>
	sendCommand({ type: "get_commands" }) as Promise<GetCommandsResult>;

export async function onRpcEvent(handler: (event: RpcEvent) => void): Promise<UnlistenFn> {
	return await listen<unknown>("rpc://event", (payload) => {
		handler(payload.payload as RpcEvent);
	});
}

export async function onMenuAction(handler: (action: string) => void): Promise<UnlistenFn> {
	return await listen<unknown>("menu://action", (payload) => {
		handler(String(payload.payload));
	});
}

// ============================================================================
// Git / filesystem utilities exposed by the Tauri shell.
// ============================================================================

export interface DirEntry {
	path: string;
	name: string;
	is_dir: boolean;
	children: DirEntry[];
}

export async function listDirectory(
	cwd: string,
	maxDepth = 8,
): Promise<DirEntry[]> {
	return await invoke<DirEntry[]>("list_directory", { cwd, maxDepth });
}

export async function readFileBase64(
	path: string,
): Promise<{ content: string; mimeType: string }> {
	const res = await invoke<{ content: string; mime_type: string }>("read_file_base64", {
		path,
	});
	return { content: res.content, mimeType: res.mime_type };
}

export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface GitFileChange {
	path: string;
	status: GitFileStatus;
	staged: boolean;
}

export interface GitBranch {
	name: string;
	ahead: number;
	behind: number;
}

export interface GitStatus {
	branch: GitBranch | null;
	staged: GitFileChange[];
	unstaged: GitFileChange[];
	untracked: GitFileChange[];
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
	return await invoke<GitStatus>("git_status", { cwd });
}

export async function gitDiff(
	cwd: string,
	path: string,
	staged = false,
): Promise<string> {
	return await invoke<string>("git_diff", { cwd, path, staged });
}

export async function readTextFile(path: string): Promise<string> {
	return await invoke<string>("read_text_file", { path });
}

/** Workspace preselected by the `pi --desktop` CLI launcher (A_CODER_DESKTOP_WORKSPACE). */
export async function getInitialWorkspace(): Promise<string | null> {
	return await invoke<string | null>("get_initial_workspace");
}

export async function listFiles(
	cwd: string,
	extension: string,
	maxResults = 200,
	maxDepth = 5,
): Promise<string[]> {
	return await invoke<string[]>("list_files", {
		cwd,
		extension,
		maxResults,
		maxDepth,
	});
}

// ============================================================================
// Settings file I/O (Tauri commands)
// ============================================================================

export interface SettingsPaths {
	global: string;
	project?: string;
	auth: string;
	models: string;
	agentDir: string;
}

export async function getSettingsPaths(cwd?: string): Promise<SettingsPaths> {
	return await invoke("get_settings_paths", { args: { cwd } });
}

export interface ReadFileArgs {
	scope: string;
	cwd?: string;
}

export async function readSettingsFile(args: ReadFileArgs): Promise<Record<string, unknown>> {
	const raw = await invoke("read_settings_file", {
		args: { scope: args.scope, cwd: args.cwd },
	});
	return (raw as Record<string, unknown>) ?? {};
}

export interface WriteFileArgs {
	scope: string;
	cwd?: string;
	value: Record<string, unknown>;
}

export async function writeSettingsFile(args: WriteFileArgs): Promise<void> {
	await invoke("write_settings_file", {
		args: { scope: args.scope, cwd: args.cwd, value: args.value },
	});
}

export async function readAuthFile(): Promise<Record<string, unknown>> {
	const raw = await invoke("read_auth_file");
	return (raw as Record<string, unknown>) ?? {};
}

// Subagents: read the persisted subagent state file managed by a-coder-cli.
export interface SubagentRecord {
	id: string;
	config: {
		id: string;
		task: string;
		provider?: string;
		model?: string;
		timeoutMs?: number;
		detached?: boolean;
	};
	status: "pending" | "running" | "completed" | "failed" | "killed";
	createdAt: string;
	updatedAt: string;
	lastOutput?: string;
	error?: string;
	exitCode?: number | null;
	sessionPath?: string;
}

export interface SubagentsFile {
	agents?: SubagentRecord[];
}

export async function readSubagentsFile(): Promise<SubagentRecord[]> {
	const raw = (await invoke("read_subagents_file")) as SubagentsFile | null;
	return raw?.agents ?? [];
}

// Agent Teams: read the on-disk team state (team.json + per-member unread
// inbox counts), managed by the same a-coder-cli team-file module.
export interface TeamMember {
	agentId: string;
	name: string;
	agentType?: string;
	model?: string;
	joinedAt: number;
	isActive: boolean;
	worktreePath?: string;
	worktreeBranch?: string;
	gitRoot?: string;
	unread?: number;
}

export interface TeamFile {
	name: string;
	description?: string;
	createdAt: number;
	leadAgentId: string;
	members: TeamMember[];
}

export async function readTeams(): Promise<TeamFile[]> {
	const raw = (await invoke("read_teams")) as TeamFile[] | null;
	return raw ?? [];
}

// Project trust markers persisted by the desktop.
export async function getProjectTrust(cwd: string): Promise<boolean> {
	return await invoke<boolean>("get_project_trust", { args: { cwd } });
}

export async function setProjectTrust(cwd: string, trusted: boolean): Promise<void> {
	await invoke("set_project_trust", { args: { cwd }, trusted });
}

// Share a session JSONL file as a GitHub gist via the `gh` CLI (Tauri shell command).
export interface ShareGistResult {
	url: string;
}

export async function shareSessionGist(path: string, publicGist = false): Promise<ShareGistResult> {
	return await invoke<ShareGistResult>("share_session_gist", { args: { path, public: publicGist } });
}

export interface WriteAuthArgs {
	value: Record<string, unknown>;
}

export async function writeAuthFile(args: WriteAuthArgs): Promise<void> {
	await invoke("write_auth_file", { value: args.value });
}

// ============================================================================
// models.json I/O — custom OpenAI-compatible providers and models.
// ============================================================================

export async function readModelsFile(): Promise<Record<string, unknown>> {
	const raw = await invoke("read_models_file");
	return (raw as Record<string, unknown>) ?? {};
}

export interface WriteModelsArgs {
	value: Record<string, unknown>;
}

export async function writeModelsFile(args: WriteModelsArgs): Promise<void> {
	await invoke("write_models_file", { value: args.value });
}

export async function readKeybindingsFile(): Promise<Record<string, unknown>> {
	const raw = await invoke("read_keybindings_file");
	return (raw as Record<string, unknown>) ?? {};
}

export interface WriteKeybindingsArgs {
	value: Record<string, unknown>;
}

export async function writeKeybindingsFile(args: WriteKeybindingsArgs): Promise<void> {
	await invoke("write_keybindings_file", { value: args.value });
}

export async function openInEditor(path: string): Promise<void> {
	await invoke("open_file_in_editor", { path });
}

export async function revealInFileManager(path: string): Promise<void> {
	await invoke("reveal_in_file_manager", { path });
}

export interface MemoryContent {
	content: string;
}

export async function getMemory(): Promise<MemoryContent> {
	return await invoke<MemoryContent>("get_memory");
}

export interface SetMemoryArgs {
	content: string;
}

export async function setMemory(args: SetMemoryArgs): Promise<void> {
	await invoke("set_memory", { args });
}

// ============================================================================
// Resource / skill management (drives a-coder-cli resources subcommand)
// ============================================================================

export interface PathMetadata {
	source: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface ResolvedResource {
	path: string;
	enabled: boolean;
	metadata: PathMetadata;
}

export interface ResolvedPaths {
	extensions: ResolvedResource[];
	skills: ResolvedResource[];
	prompts: ResolvedResource[];
	themes: ResolvedResource[];
}

export interface ConfiguredPackage {
	source: string;
	scope: "user" | "project";
	filtered: boolean;
	installedPath?: string;
}

export interface ResourceToggleArgs {
	resourceType: "extensions" | "skills" | "prompts" | "themes";
	path: string;
	enabled: boolean;
	scope: "user" | "project";
	origin: "top-level" | "package";
	source?: string;
	baseDir?: string;
	cwd?: string;
}

export async function resolveResources(cwd?: string): Promise<ResolvedPaths> {
	const raw = (await invoke("resolve_resources", { args: { cwd } })) as {
		success?: boolean;
		data?: ResolvedPaths;
		error?: string;
	};
	if (raw?.success === false || raw?.error) {
		throw new Error(raw.error ?? "resolve_resources failed");
	}
	return raw?.data ?? { extensions: [], skills: [], prompts: [], themes: [] };
}

export async function listPackages(cwd?: string): Promise<ConfiguredPackage[]> {
	const raw = (await invoke("list_packages", { args: { cwd } })) as {
		success?: boolean;
		data?: ConfiguredPackage[];
		error?: string;
	};
	if (raw?.success === false || raw?.error) {
		throw new Error(raw.error ?? "list_packages failed");
	}
	return raw?.data ?? [];
}

export async function installPackage(source: string, local = false, cwd?: string): Promise<void> {
	const raw = (await invoke("install_package", {
		args: { source, local, cwd },
	})) as { success?: boolean; error?: string };
	if (raw?.success === false || raw?.error) {
		throw new Error(raw.error ?? "install_package failed");
	}
}

export async function removePackage(source: string, local = false, cwd?: string): Promise<void> {
	const raw = (await invoke("remove_package", {
		args: { source, local, cwd },
	})) as { success?: boolean; error?: string };
	if (raw?.success === false || raw?.error) {
		throw new Error(raw.error ?? "remove_package failed");
	}
}

export async function updatePackage(source?: string, cwd?: string): Promise<void> {
	const raw = (await invoke("update_package", {
		args: { source, cwd },
	})) as { success?: boolean; error?: string };
	if (raw?.success === false || raw?.error) {
		throw new Error(raw.error ?? "update_package failed");
	}
}

export async function toggleResource(args: ResourceToggleArgs): Promise<void> {
	const raw = (await invoke("toggle_resource", {
		args: {
			resource_type: args.resourceType,
			path: args.path,
			enabled: args.enabled,
			scope: args.scope,
			origin: args.origin,
			source: args.source,
			base_dir: args.baseDir,
			cwd: args.cwd,
		},
	})) as { success?: boolean; error?: string };
	if (raw?.success === false || raw?.error) {
		throw new Error(raw.error ?? "toggle_resource failed");
	}
}

// Legacy wrappers for runtime engine controls removed; the typed wrappers at the top
// of the file (`rpc.setThinkingLevel`, `rpc.cycleThinkingLevel`, etc.) supersede them.

export type TaskStatus = "queued" | "running" | "finishing" | "done" | "error" | "stopped";

export interface TaskUsage {
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	turns: number;
	toolCalls: number;
	toolErrors: number;
}

export interface CommitSummary {
	hash: string;
	subject: string;
	date: string;
}

/** Structural subset of the git diff summary, so report building stays testable without spawning git. */
export interface GitDiffSummaryLike {
	commits: CommitSummary[];
	diffStat: string;
	changedFiles: string[];
}

export interface CloudTask {
	id: string;
	createdAt: string;
	updatedAt: string;
	/** Where the repo came from: a git URL or a local path. */
	repoSource: string;
	/** Absolute path of the checked-out workspace for this task. */
	workspacePath: string;
	/** Branch the task started from. */
	baseBranch: string;
	/** SHA the task branch was created from. */
	baseSha: string;
	branch: string;
	prompt: string;
	provider?: string;
	model?: string;
	timeoutMinutes: number;
	push: boolean;
	status: TaskStatus;
	error?: string;
	orchestratorInstanceId?: string;
	sessionId?: string;
	sessionFile?: string;
	commits: CommitSummary[];
	diffStat?: string;
	changedFiles: string[];
	pushedToRemote?: boolean;
	reportMarkdown?: string;
	usage: TaskUsage;
	warnings: string[];
	startedAt?: string;
	finishedAt?: string;
}

export interface SpawnTaskOptions {
	repo: string;
	prompt: string;
	baseBranch?: string;
	provider?: string;
	model?: string;
	timeoutMinutes?: number;
	push?: boolean;
}

// ============================================================================
// IPC protocol (unix socket, JSONL)
// ============================================================================

export interface SpawnTaskRequest {
	type: "spawn_task";
	repo: string;
	prompt: string;
	baseBranch?: string;
	provider?: string;
	model?: string;
	timeoutMinutes?: number;
	push?: boolean;
}

export interface ListTasksRequest {
	type: "list_tasks";
}

export interface GetTaskRequest {
	type: "get_task";
	taskId: string;
}

export interface StopTaskRequest {
	type: "stop_task";
	taskId: string;
}

export interface PingRequest {
	type: "ping";
}

export interface CloudRequestMap {
	spawn_task: SpawnTaskRequest;
	list_tasks: ListTasksRequest;
	get_task: GetTaskRequest;
	stop_task: StopTaskRequest;
	ping: PingRequest;
}

export type CloudRequest = CloudRequestMap[keyof CloudRequestMap];

export interface TaskResponseBase {
	ok: boolean;
	error?: string;
}

export interface SpawnTaskResponse extends TaskResponseBase {
	type: "spawn_task_result";
	taskId?: string;
}

export interface ListTasksResponse extends TaskResponseBase {
	type: "list_tasks_result";
	tasks?: CloudTask[];
}

export interface GetTaskResponse extends TaskResponseBase {
	type: "get_task_result";
	task?: CloudTask;
}

export interface StopTaskResponse extends TaskResponseBase {
	type: "stop_task_result";
	taskId?: string;
}

export interface PingResponse extends TaskResponseBase {
	type: "pong";
	version?: string;
}

export interface CloudErrorResponse {
	type: "error";
	ok: false;
	error: string;
}

export type CloudResponse =
	| SpawnTaskResponse
	| ListTasksResponse
	| GetTaskResponse
	| StopTaskResponse
	| PingResponse
	| CloudErrorResponse;

export function encodeMessage(
	message: CloudRequest | CloudResponse | { type: "extension_ui_response"; id: string; cancelled: true },
): string {
	return `${JSON.stringify(message)}\n`;
}

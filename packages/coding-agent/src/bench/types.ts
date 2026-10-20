/**
 * A-Coder Bench shared types.
 *
 * A bench task is a directory under `bench/tasks/<task-id>/` containing:
 *   task.json  - instruction, timeout, tags
 *   repo/      - the workspace the agent sees (copied fresh per run)
 *   grade.mjs  - hidden grader, run with cwd = the run's repo copy
 */

export interface BenchTask {
	id: string;
	title: string;
	instruction: string;
	tags: string[];
	timeoutSeconds: number;
	grader: string;
}

export interface BenchUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface BenchRunStats {
	toolCalls: number;
	toolErrors: number;
	editFailures: number;
	turns: number;
	usage: BenchUsage;
	finalText: string;
}

export interface BenchRunResult {
	runId: string;
	timestamp: string;
	model: string;
	endpoint?: string;
	taskId: string;
	taskTags: string[];
	runIndex: number;
	pass: boolean;
	timedOut: boolean;
	/** The hidden grader exceeded GRADER_TIMEOUT_MS. */
	graderTimedOut?: boolean;
	agentExitCode: number | null;
	graderExitCode: number | null;
	gradeDetail: unknown;
	durationMs: number;
	stats: BenchRunStats;
	error?: string;
}

/** How to re-exec this CLI for a bench child run. */
export interface BenchChildCommand {
	command: string;
	baseArgs: string[];
}

export interface RunTaskOptions {
	/** Directory containing tasks/, runs/, results.jsonl. */
	benchDir: string;
	task: BenchTask;
	provider: string;
	modelId: string;
	runIndex: number;
	endpoint?: string;
	apiKey: string;
	api: string;
	child: BenchChildCommand;
}

export interface BenchQueueJob {
	task: BenchTask;
	runIndex: number;
}

export interface BenchQueueOptions {
	benchDir: string;
	jobs: BenchQueueJob[];
	concurrency?: number;
	provider: string;
	modelId: string;
	endpoint?: string;
	apiKey: string;
	api: string;
	child: BenchChildCommand;
	onStart?: (job: BenchQueueJob, index: number) => void;
	onResult?: (job: BenchQueueJob, result: BenchRunResult, index: number) => void;
}

export interface SpawnOutcome {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
}

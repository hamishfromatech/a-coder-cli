import type { CloudTask, GitDiffSummaryLike } from "./types.ts";

export interface ReportPayload {
	json: Record<string, unknown>;
	markdown: string;
}

function formatDuration(ms: number): string {
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.round((ms % 60000) / 1000);
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds}s`;
}

const STATUS_LABELS: Record<string, string> = {
	done: "Completed",
	error: "Failed",
	stopped: "Stopped",
	queued: "Queued",
	running: "Running",
	finishing: "Finishing up",
};

function statusLine(task: CloudTask): string {
	if (task.status === "error" && task.error) {
		return `**${STATUS_LABELS[task.status] ?? task.status}** — ${task.error}`;
	}
	return `**${STATUS_LABELS[task.status] ?? task.status}**`;
}

/**
 * Build the machine (JSON) and human (Markdown) reports for a task. The
 * agent-authored report.md inside the repo is the narrative; this is the
 * structured companion the CLI prints.
 */
export function buildReport(task: CloudTask, diff: GitDiffSummaryLike): ReportPayload {
	const usage = task.usage;
	const durationMs =
		task.startedAt && task.finishedAt ? Date.parse(task.finishedAt) - Date.parse(task.startedAt) : undefined;

	const json: Record<string, unknown> = {
		taskId: task.id,
		status: task.status,
		error: task.error,
		repoSource: task.repoSource,
		baseBranch: task.baseBranch,
		baseSha: task.baseSha,
		branch: task.branch,
		workspacePath: task.workspacePath,
		prompt: task.prompt,
		model: task.model,
		provider: task.provider,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		durationMs: durationMs,
		pushedToRemote: task.pushedToRemote,
		commits: diff.commits,
		diffStat: diff.diffStat,
		changedFiles: diff.changedFiles,
		usage: usage,
		warnings: task.warnings,
		sessionFile: task.sessionFile,
	};

	const lines: string[] = [];
	lines.push(`# A-Coder Cloud report — task ${task.id}`);
	lines.push("");
	lines.push(`- **Repo:** ${task.repoSource}`);
	lines.push(`- **Branch:** \`${task.branch}\` (from \`${task.baseBranch}\` @ ${task.baseSha.slice(0, 8)})`);
	lines.push(`- **Workspace:** \`${task.workspacePath}\``);
	lines.push(`- **Status:** ${statusLine(task)}`);
	if (durationMs !== undefined) {
		lines.push(`- **Duration:** ${formatDuration(durationMs)}`);
	}
	if (task.pushedToRemote) {
		lines.push(`- **Pushed:** origin/${task.branch}`);
	}
	lines.push("");
	lines.push("## Task");
	lines.push("");
	lines.push(task.prompt);
	lines.push("");

	if (diff.commits.length > 0) {
		lines.push("## Commits");
		lines.push("");
		for (const commit of diff.commits) {
			lines.push(`- ${commit.hash.slice(0, 8)} ${commit.subject}`);
		}
		lines.push("");
	}

	if (diff.diffStat.length > 0) {
		lines.push("## Changes");
		lines.push("");
		lines.push("```");
		lines.push(diff.diffStat);
		lines.push("```");
		lines.push("");
	}

	if (usage.turns > 0) {
		lines.push("## Agent activity");
		lines.push("");
		lines.push(`- ${usage.turns} turn(s), ${usage.toolCalls} tool call(s), ${usage.toolErrors} tool error(s)`);
		lines.push(
			`- Tokens: ${usage.totalTokens.toLocaleString("en-US")} total (${usage.inputTokens.toLocaleString("en-US")} in, ${usage.outputTokens.toLocaleString("en-US")} out)`,
		);
		lines.push("");
	}

	if (task.warnings.length > 0) {
		lines.push("## Warnings");
		lines.push("");
		for (const warning of task.warnings) {
			lines.push(`- ${warning}`);
		}
		lines.push("");
	}

	lines.push("## Continue the work");
	lines.push("");
	lines.push("```bash");
	lines.push("# Inspect the work (the branch lives in the task workspace clone)");
	lines.push(`cd ${task.workspacePath} && git log ${task.baseBranch}..${task.branch}`);
	lines.push("");
	lines.push("# Resume the exact agent session (continuity)");
	lines.push(`cd ${task.workspacePath} && a-coder --resume`);
	lines.push("");
	lines.push("# Merge the work into your base branch");
	lines.push(`cd ${task.workspacePath} && git checkout ${task.baseBranch} && git merge --no-ff ${task.branch}`);
	lines.push("```");
	lines.push("");

	return { json, markdown: lines.join("\n") };
}

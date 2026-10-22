/**
 * Post-run triage for scheduled tasks.
 *
 * A System One model answers four typed questions about a finished run:
 * what happened, whether the user should be told, whether another attempt is
 * warranted, and whether the recurring job should be paused. It never writes
 * prose and never changes the schedule; the service records the recommendation
 * for the CLI and desktop to show.
 */

import type {
	DecisionAnswerChoice,
	DecisionAnswerNoul,
	DecisionQuestion,
	DecisionResult,
	DecisionsApi,
	DecisionsModel,
} from "@earendil-works/pi-ai";
import type { DecisionsModels } from "@earendil-works/pi-ai/compat";
import { describeSchedule } from "../office/errands.ts";
import type { CronJob, CronRun, CronTriageAction, CronTriageDecision, CronTriageOutcome } from "./types.ts";

export interface CronTriageInput {
	job: CronJob;
	run: CronRun;
	/** Earlier runs, newest first, excluding the current run. */
	priorRuns: CronRun[];
	/** Abort signal from the host, when one is available. */
	signal?: AbortSignal;
}

const MAX_TASK_CHARS = 2_000;
const MAX_SUMMARY_CHARS = 3_500;
const MAX_ERROR_CHARS = 1_000;
const MAX_RECENT_RUNS = 5;
const NOTIFY_THRESHOLD = 0.5;
const RETRY_THRESHOLD = 0.65;
const PAUSE_THRESHOLD = 0.7;

function clip(value: string | undefined, max: number): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.length > max ? `${trimmed.slice(0, max)}\n[truncated]` : trimmed;
}

function serializeState(input: CronTriageInput): string {
	const { job, run, priorRuns } = input;
	const recent = priorRuns.slice(0, MAX_RECENT_RUNS).map((prior) => ({
		status: prior.status,
		trigger: prior.trigger,
		startedAt: prior.startedAt,
		finishedAt: prior.finishedAt,
		...(prior.triage
			? { triageOutcome: prior.triage.outcome, recommendedAction: prior.triage.recommendedAction }
			: {}),
		...(prior.error ? { error: clip(prior.error, MAX_ERROR_CHARS) } : {}),
		...(prior.summary ? { summary: clip(prior.summary, 800) } : {}),
	}));
	const consecutiveFailures = countLeading(
		priorRuns,
		(prior) => prior.status === "error" || prior.status === "timeout",
	);
	const consecutiveNoWork = countLeading(priorRuns, (prior) => prior.triage?.outcome === "no_work");

	return JSON.stringify({
		job: {
			name: job.name,
			task: clip(job.prompt, MAX_TASK_CHARS),
			schedule: describeSchedule(job.schedule),
			enabled: job.enabled,
			cwd: job.cwd,
			lastStatus: job.lastStatus,
			...(job.lastError ? { lastError: clip(job.lastError, MAX_ERROR_CHARS) } : {}),
		},
		run: {
			status: run.status,
			trigger: run.trigger,
			delivery: run.delivery,
			durationMs: run.finishedAt && run.startedAt ? run.finishedAt - run.startedAt : undefined,
			...(run.error ? { error: clip(run.error, MAX_ERROR_CHARS) } : {}),
			...(run.summary ? { summary: clip(run.summary, MAX_SUMMARY_CHARS) } : {}),
		},
		history: {
			consecutiveFailures,
			consecutiveNoWork,
			recent,
		},
	});
}

function countLeading(runs: CronRun[], predicate: (run: CronRun) => boolean): number {
	let count = 0;
	for (const run of runs) {
		if (!predicate(run)) break;
		count++;
	}
	return count;
}

export function buildCronTriageQuestions(): Record<string, DecisionQuestion> {
	return {
		outcome: {
			type: "choice",
			instructions:
				"What happened in this scheduled run? Judge the final status and the assistant's summary, not just the exit code.",
			criteria: {
				ok: "The task completed and produced a useful result.",
				no_work: "The task completed, but there was nothing to do or nothing changed.",
				needs_user:
					"The task could not proceed without a user decision, missing information, credentials, or approval.",
				failed: "The task failed, timed out, or produced an unusable result.",
			},
		},
		notify: {
			type: "noul",
			instructions: "Should the user be notified about this run's result now?",
			criteria: {
				false: "The result is routine, unchanged, or not actionable; stay quiet.",
				true: "The user needs to see this result, error, or decision.",
			},
		},
		retry: {
			type: "noul",
			instructions: "Is another attempt likely to succeed without asking the user, and is it worth doing?",
			criteria: {
				false: "Another attempt would repeat the same failure or is unnecessary.",
				true: "The failure looks transient and another attempt has a realistic chance.",
			},
		},
		pause: {
			type: "noul",
			instructions: "Should this recurring task be paused because it is failing repeatedly or no longer useful?",
			criteria: {
				false: "Keep the schedule as it is.",
				true: "Pause or disable the schedule until the user reviews it.",
			},
		},
	};
}

function choiceAnswer(result: DecisionResult, name: string): DecisionAnswerChoice | undefined {
	const answer = result.answers[name];
	return answer?.type === "choice" ? answer : undefined;
}

function noulAnswer(result: DecisionResult, name: string): DecisionAnswerNoul | undefined {
	const answer = result.answers[name];
	return answer?.type === "noul" ? answer : undefined;
}

function probability(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function pickAction(input: {
	outcome: CronTriageOutcome;
	run: CronRun;
	notify: number;
	retry: number;
	pause: number;
}): CronTriageAction {
	const failed = input.run.status === "error" || input.run.status === "timeout" || input.outcome === "failed";
	if (input.pause >= PAUSE_THRESHOLD && (failed || input.outcome === "no_work")) return "pause";
	if (failed && input.retry >= RETRY_THRESHOLD) return "retry";
	if (input.outcome === "needs_user" || input.notify >= NOTIFY_THRESHOLD) return "notify";
	return "quiet";
}

function errorDecision(error: string, model?: string, latencyMs?: number): CronTriageDecision {
	return {
		outcome: "unavailable",
		recommendedAction: "quiet",
		notify: 0,
		retry: 0,
		pause: 0,
		...(model ? { model } : {}),
		...(latencyMs !== undefined ? { latencyMs } : {}),
		error: clip(error, 600) ?? "decision model failed",
	};
}

/**
 * Ask one System One model to classify a finished run. Failures are returned
 * as an `unavailable` decision so hosts can show that triage did not run.
 */
export async function decideCronRunTriage(
	models: DecisionsModels,
	model: DecisionsModel<DecisionsApi>,
	input: CronTriageInput,
): Promise<CronTriageDecision> {
	const result: DecisionResult = await models
		.postDecisions(
			model,
			{ state: serializeState(input), questions: buildCronTriageQuestions() },
			{ ...(input.signal ? { signal: input.signal } : {}) },
		)
		.catch(
			(error: unknown): DecisionResult => ({
				stopReason: "error",
				errorMessage: error instanceof Error ? error.message : String(error),
				answers: {},
				model: model.id,
				api: model.api,
				provider: model.provider,
				timestamp: Date.now(),
			}),
		);

	if (result.stopReason !== "stop") {
		return errorDecision(
			result.errorMessage ?? "decision model failed",
			result.servedModel ?? result.model,
			result.durationMs,
		);
	}

	const outcomeAnswer = choiceAnswer(result, "outcome");
	if (!outcomeAnswer) return errorDecision("decision model returned no outcome", result.model, result.durationMs);
	const outcomeChoices: CronTriageOutcome[] = ["ok", "no_work", "needs_user", "failed"];
	const outcome = outcomeChoices.includes(outcomeAnswer.choice as CronTriageOutcome)
		? (outcomeAnswer.choice as CronTriageOutcome)
		: "failed";
	const notify = probability(noulAnswer(result, "notify")?.noul);
	const retry = probability(noulAnswer(result, "retry")?.noul);
	const pause = probability(noulAnswer(result, "pause")?.noul);
	const recommendedAction = pickAction({ outcome, run: input.run, notify, retry, pause });
	const probabilities: Record<string, number> = {
		...(outcomeAnswer.probabilities ?? {}),
		notify,
		retry,
		pause,
	};

	const servedModel = result.servedModel ?? result.model;

	return {
		outcome,
		recommendedAction,
		notify,
		retry,
		pause,
		probabilities,
		...(servedModel ? { model: servedModel } : {}),
		...(result.durationMs !== undefined ? { latencyMs: result.durationMs } : {}),
	};
}

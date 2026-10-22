/**
 * Post-run cron triage — System One questions, safe action thresholds, and
 * the state summary sent to the decision model.
 */

import type { DecisionResult, DecisionsApi, DecisionsModel } from "@earendil-works/pi-ai";
import type { DecisionsModels } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";
import { decideCronRunTriage } from "../src/core/cron/triage.ts";
import type { CronJob, CronRun } from "../src/core/cron/types.ts";

const MODEL = {
	id: "clef-flash",
	provider: "ollama",
	api: "systemone",
	name: "Clef Flash",
	input: ["text"],
	contextWindow: 65536,
} as unknown as DecisionsModel<DecisionsApi>;

function makeJob(overrides?: Partial<CronJob>): CronJob {
	return {
		id: "cron_a",
		name: "CI triage",
		prompt: "Review the overnight CI failures",
		schedule: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" },
		enabled: true,
		cwd: "/proj",
		createdAt: 1,
		...overrides,
	};
}

function makeRun(overrides?: Partial<CronRun>): CronRun {
	return {
		id: "run_a",
		jobId: "cron_a",
		jobName: "CI triage",
		trigger: "schedule",
		delivery: "session",
		startedAt: 1_000,
		finishedAt: 2_500,
		status: "ok",
		summary: "Everything is green.",
		...overrides,
	};
}

function answers(input?: { outcome?: string; notify?: number; retry?: number; pause?: number }): DecisionResult {
	return {
		api: "systemone",
		provider: "ollama",
		model: "clef-flash",
		servedModel: "clef-flash",
		durationMs: 180,
		stopReason: "stop",
		timestamp: 1,
		answers: {
			outcome: {
				type: "choice",
				choice: input?.outcome ?? "ok",
				probabilities: { [input?.outcome ?? "ok"]: 0.9 },
			},
			notify: { type: "noul", noul: input?.notify ?? 0.2 },
			retry: { type: "noul", noul: input?.retry ?? 0.1 },
			pause: { type: "noul", noul: input?.pause ?? 0.1 },
		},
	};
}

function models(result: DecisionResult): { models: DecisionsModels; post: ReturnType<typeof vi.fn> } {
	const post = vi.fn(async () => result);
	return { models: { postDecisions: post } as unknown as DecisionsModels, post };
}

describe("cron triage", () => {
	it("stays quiet when a successful run produced a routine result", async () => {
		const { models: decisions, post } = models(answers());
		const decision = await decideCronRunTriage(decisions, MODEL, {
			job: makeJob(),
			run: makeRun(),
			priorRuns: [],
		});
		expect(decision).toMatchObject({
			outcome: "ok",
			recommendedAction: "quiet",
			notify: 0.2,
			retry: 0.1,
			pause: 0.1,
			model: "clef-flash",
			latencyMs: 180,
		});
		expect(post).toHaveBeenCalledTimes(1);
		const state = JSON.parse(post.mock.calls[0]?.[1]?.state as string) as {
			job: { task: string; schedule: string };
			run: { status: string; summary: string };
			history: { consecutiveFailures: number };
		};
		expect(state.job.task).toContain("overnight CI");
		expect(state.job.schedule).toBe("weekly on weekdays at 09:00");
		expect(state.run.summary).toBe("Everything is green.");
		expect(state.history.consecutiveFailures).toBe(0);
	});

	it("notifies when the result is actionable", async () => {
		const { models: decisions } = models(answers({ outcome: "needs_user", notify: 0.8 }));
		const decision = await decideCronRunTriage(decisions, MODEL, {
			job: makeJob(),
			run: makeRun({ status: "ok" }),
			priorRuns: [],
		});
		expect(decision.outcome).toBe("needs_user");
		expect(decision.recommendedAction).toBe("notify");
		expect(decision.notify).toBe(0.8);
	});

	it("recommends retry for transient failures and pause for repeated ones", async () => {
		const retry = await decideCronRunTriage(
			models(answers({ outcome: "failed", retry: 0.9, pause: 0.2 })).models,
			MODEL,
			{ job: makeJob(), run: makeRun({ status: "error" }), priorRuns: [] },
		);
		expect(retry.recommendedAction).toBe("retry");

		const pause = await decideCronRunTriage(
			models(answers({ outcome: "failed", retry: 0.3, pause: 0.85 })).models,
			MODEL,
			{
				job: makeJob(),
				run: makeRun({ status: "timeout" }),
				priorRuns: [makeRun({ id: "run_prev", status: "error" }), makeRun({ id: "run_prev2", status: "timeout" })],
			},
		);
		expect(pause.recommendedAction).toBe("pause");
		expect(pause.probabilities?.pause).toBe(0.85);

		const stale = await decideCronRunTriage(
			models(answers({ outcome: "no_work", retry: 0.1, pause: 0.8 })).models,
			MODEL,
			{ job: makeJob(), run: makeRun({ status: "ok" }), priorRuns: [] },
		);
		expect(stale.recommendedAction).toBe("pause");
	});

	it("includes consecutive failures in the state", async () => {
		const { models: decisions, post } = models(answers());
		await decideCronRunTriage(decisions, MODEL, {
			job: makeJob({ lastStatus: "error" }),
			run: makeRun({ status: "error" }),
			priorRuns: [makeRun({ id: "run_prev", status: "error" }), makeRun({ id: "run_prev2", status: "error" })],
		});
		const state = JSON.parse(post.mock.calls[0]?.[1]?.state as string) as {
			history: { consecutiveFailures: number };
		};
		expect(state.history.consecutiveFailures).toBe(2);
	});

	it("returns an unavailable decision when the model fails", async () => {
		const post = vi.fn(async () => ({
			api: "systemone",
			provider: "ollama",
			model: "clef-flash",
			stopReason: "error" as const,
			errorMessage: "server offline",
			answers: {},
			timestamp: 1,
		}));
		const decision = await decideCronRunTriage({ postDecisions: post } as unknown as DecisionsModels, MODEL, {
			job: makeJob(),
			run: makeRun(),
			priorRuns: [],
		});
		expect(decision.outcome).toBe("unavailable");
		expect(decision.recommendedAction).toBe("quiet");
		expect(decision.error).toContain("offline");
	});
});

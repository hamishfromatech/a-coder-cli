/**
 * Decision-model policy for continuation checkpoints.
 *
 * Decision models are non-generative: this module only asks whether the agent
 * should continue, ask the user, or stop. The main model still does the work.
 *
 * Two kinds of evidence feed the policy:
 * - local deterministic features (error/repeat streaks, plan state, context
 *   pressure, decision history) that gate hard when the state is decisive;
 * - the decision model's typed answers (`next`, `progress`, `completion`),
 *   which only get a vote when the local state is ambiguous.
 */

import type {
	DecisionAnswerChoice,
	DecisionAnswerNoul,
	DecisionAnswerScore,
	DecisionQuestion,
	DecisionResult,
	DecisionsApi,
	DecisionsModel,
} from "@earendil-works/pi-ai";
import type { DecisionsModels } from "@earendil-works/pi-ai/compat";
import type { ResolvedAutoContinueSettings } from "./settings-manager.ts";

export type AutoContinueCheckpoint = "length" | "compaction" | "agent_end" | "tool_pause";
export type AutoContinueAction = "continue" | "ask_user" | "stop";

/** One recorded auto-continue decision, oldest first, for trajectory judgment. */
export interface AutoContinueHistoryEntry {
	checkpoint: AutoContinueCheckpoint;
	action: AutoContinueAction;
	/** Continue probability this checkpoint recorded. */
	continueP: number;
	/** Decision-model progress verdict (0..1) at this checkpoint. */
	progress: number;
	/** Decision-model completion estimate (0..1) at this checkpoint, when answered. */
	completion?: number;
}

export interface AutoContinueState {
	checkpoint: AutoContinueCheckpoint;
	/** Latest user request, truncated. */
	goal: string;
	/** Final assistant text, truncated. */
	lastAssistant: string;
	/** Compact recent message summaries. */
	recent: string[];
	/** Continuations that reported no progress, for this prompt. */
	consecutive: number;
	stopReason?: string;
	/** Name of the most recent tool result, when the last turn used a tool. */
	lastTool?: string;
	/** True when the assistant stopped with no visible text immediately after a tool result. */
	emptyAfterTool?: boolean;
	context?: { used: number; window: number };
	/** Trailing consecutive errored tool results. */
	errorStreak?: number;
	/** Trailing identical tool calls (tool name + arguments). */
	repeatStreak?: number;
	/** Latest todo/task-list snapshot, when the agent maintains a plan. */
	plan?: { total: number; done: number };
	/** Subjects of open (pending/in_progress) plan items, capped. Makes
	 * "stopped with work outstanding" visible to the judge, including WHAT
	 * still is open (parked backlog vs abandoned mid-task work). */
	openPlanItems?: string[];
	/** Text of the next open plan item, when one exists. */
	nextPlanItem?: string;
	/** Headless run (scheduled task): nobody is there to answer. */
	unattended?: boolean;
	/** Earlier auto-continue decisions this prompt, oldest first. */
	history?: AutoContinueHistoryEntry[];
}

export interface AutoContinueDecision {
	action: AutoContinueAction;
	checkpoint: AutoContinueCheckpoint;
	/** Raw choice probabilities keyed by option name. */
	probabilities: Record<string, number>;
	/** Probability that the last few turns made progress. */
	progress: number;
	/** Decision-model completion estimate (0..1), when the completion question was answered. */
	completion?: number;
	/** True when effective progress (noul or completion trajectory) clears the threshold. */
	progressed?: boolean;
	/** Model-reported distribution concentration (not accuracy). */
	confidence?: number;
	model?: string;
	latencyMs: number;
	reason: string;
}

const MAX_STRING = 6000;
const MAX_RECENT = 8;
const MAX_RECENT_CHARS = 500;
const MAX_HISTORY = 6;
export const MAX_HISTORY_IN_STATE = 3;
/** Stop when the context is this full and no compaction is already queued. */
const CONTEXT_PRESSURE_STOP = 0.85;
/** Trailing errored tool results beyond which the run is stuck. */
const ERROR_STREAK_STOP = 3;
/** Trailing identical tool calls beyond which the run is looped. */
const REPEAT_STREAK_STOP = 4;
const DONE_PROBABILITY = 0.55;
/** When the plan itself says everything is done, a weaker done vote is enough. */
const DONE_PROBABILITY_WITH_COMPLETE_PLAN = 0.45;
/** When the plan still has open items, a done vote must clear a higher bar —
 * an agent that abandons the task graph mid-run should not get an easy stop. */
const DONE_PROBABILITY_WITH_OPEN_PLAN = 0.7;
const ASK_PROBABILITY = 0.35;
/** Continuations whose completion score does not rise, after which we stop. */
const TRAJECTORY_STALL_MOVES = 2;

const COMPLETION_CRITERIA = [
	"None of the request is satisfied; nothing of substance changed since the start.",
	"Only a token piece of the request is satisfied.",
	"Roughly a third of the request is satisfied.",
	"About half of the request is satisfied.",
	"Most of the request is satisfied; some pieces remain.",
	"Almost everything is done; only final touches remain.",
	"The request is fully satisfied, including any final summary to the user.",
] as const;
/** Number of completion answer choices minus one (score answers index 0..N-1). */
const COMPLETION_SCORE_MAX = COMPLETION_CRITERIA.length - 1;
/** A completion rise smaller than half a legend level counts as flat. */
const MIN_COMPLETION_RISE = 1 / COMPLETION_SCORE_MAX / 2;

const CONTINUE_CRITERIA = {
	done: "The user's request is complete, or stopping is clearly better than another turn.",
	ask_user: "Unfinished, but blocked on a user decision, missing information, credentials, or approval.",
	blocked: "An error or repeated failure prevents progress without user intervention.",
	continue: "Clearly unfinished work remains, and another turn can make progress without the user.",
} as const;

export function buildAutoContinueQuestions(checkpoint?: AutoContinueCheckpoint): Record<string, DecisionQuestion> {
	const instructions =
		checkpoint === "tool_pause"
			? "The agent stopped with no final response immediately after a tool result. Should it continue working without user input?"
			: "Should the coding agent continue working without user input? The state may include the agent's task list: open items this request created or depends on are a strong continue signal; long-lived parked backlog the request did not ask for is not.";
	return {
		next: {
			type: "choice",
			instructions,
			criteria: CONTINUE_CRITERIA,
		},
		progress: {
			type: "noul",
			instructions: "Have the last few turns produced new information, file changes, or a working next step?",
			criteria: {
				false: "No meaningful progress; another turn would repeat or spin.",
				true: "Progress was made and a concrete next step exists.",
			},
		},
		completion: {
			type: "score",
			instructions:
				"How complete is the user's request as stated in the goal, given the state so far? Judge the request itself, not the effort spent.",
			criteria: [...COMPLETION_CRITERIA],
		},
	};
}

function clip(value: string | undefined, max = MAX_STRING): string {
	if (!value) return "";
	return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value;
}

function serializeState(state: AutoContinueState): string {
	return JSON.stringify({
		checkpoint: state.checkpoint,
		stopReason: state.stopReason,
		goal: clip(state.goal),
		lastAssistant: clip(state.lastAssistant),
		recent: state.recent.slice(-MAX_RECENT).map((line) => clip(line, MAX_RECENT_CHARS)),
		lastTool: state.lastTool,
		emptyAfterTool: state.emptyAfterTool,
		context: state.context,
		errorStreak: state.errorStreak,
		repeatStreak: state.repeatStreak,
		plan: state.plan,
		openPlanItems: state.openPlanItems?.map((item) => item.slice(0, 120)).slice(0, 6),
		nextPlanItem: state.nextPlanItem ? clip(state.nextPlanItem, 300) : undefined,
		unattended: state.unattended,
		history: state.history?.slice(-MAX_HISTORY_IN_STATE),
	});
}

function choiceAnswer(result: DecisionResult): DecisionAnswerChoice | undefined {
	const answer = result.answers.next;
	return answer?.type === "choice" ? answer : undefined;
}

function noulAnswer(result: DecisionResult): DecisionAnswerNoul | undefined {
	const answer = result.answers.progress;
	return answer?.type === "noul" ? answer : undefined;
}

function scoreAnswer(result: DecisionResult): DecisionAnswerScore | undefined {
	const answer = result.answers.completion;
	return answer?.type === "score" ? answer : undefined;
}

function probability(answer: DecisionAnswerChoice, option: string): number {
	const value = answer.probabilities?.[option];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stop(state: AutoContinueState, reason: string, model?: string, latencyMs = 0): AutoContinueDecision {
	return {
		action: "stop",
		checkpoint: state.checkpoint,
		probabilities: {},
		progress: 0,
		model,
		latencyMs,
		reason,
	};
}

/** Most recent recorded continuation, if any. */
function lastContinueEntry(history: AutoContinueHistoryEntry[] | undefined): AutoContinueHistoryEntry | undefined {
	return history?.filter((entry) => entry.action === "continue").at(-1);
}

/**
 * Normalized completion rise against the previous recorded continuation: > 0
 * only when the score meaningfully moved up (at least half a legend level).
 */
function completionRise(history: AutoContinueHistoryEntry[] | undefined, completion: number | undefined): number {
	const prior = lastContinueEntry(history);
	if (completion === undefined || prior?.completion === undefined) return 0;
	const delta = completion - prior.completion;
	return delta >= MIN_COMPLETION_RISE ? delta : 0;
}

/**
 * Progress evidence for this checkpoint: the decision model's progress noul,
 * or a rising completion score on the continuation trajectory.
 */
function hasProgressEvidence(
	progress: number,
	history: AutoContinueHistoryEntry[] | undefined,
	completion: number | undefined,
	settings: ResolvedAutoContinueSettings,
): boolean {
	return progress >= settings.minProgressProbability || completionRise(history, completion) > 0;
}

/**
 * True when the completion score has not risen across the recent trajectory,
 * i.e. continuations are no longer moving the request toward done.
 */
function trajectoryStalled(history: AutoContinueHistoryEntry[] | undefined, completion: number | undefined): boolean {
	if (completion === undefined) return false;
	const scores = (history ?? []).filter((entry) => entry.action === "continue" && entry.completion !== undefined);
	if (scores.length === 0) return false;
	const seq = [...scores.map((entry) => entry.completion as number), completion];
	let flatMoves = 0;
	for (let i = seq.length - 1; i > 0; i--) {
		if (seq[i] > seq[i - 1]) break;
		flatMoves++;
	}
	return flatMoves >= TRAJECTORY_STALL_MOVES;
}

function contextPressured(context: { used: number; window: number } | undefined): boolean {
	return context !== undefined && context.window > 0 && context.used / context.window >= CONTEXT_PRESSURE_STOP;
}

/**
 * Local, model-independent stop guards for the auto-continue state. Returns a
 * stop reason when the deterministic evidence already decides the run must
 * not continue, or undefined when the state is ambiguous.
 */
export function localAutoContinueStop(
	state: AutoContinueState,
	settings: ResolvedAutoContinueSettings,
): string | undefined {
	if (state.consecutive >= settings.maxConsecutive) {
		return `smart continuation limit reached (${settings.maxConsecutive})`;
	}
	const errorStreak = state.errorStreak ?? 0;
	if (errorStreak >= ERROR_STREAK_STOP) {
		return `tool error streak reached (${errorStreak})`;
	}
	const repeatStreak = state.repeatStreak ?? 0;
	if (repeatStreak >= REPEAT_STREAK_STOP) {
		return `repeated identical tool calls (${repeatStreak})`;
	}
	if (contextPressured(state.context)) {
		const context = state.context as { used: number; window: number };
		return `context near window (${Math.round((context.used / context.window) * 100)}%)`;
	}
	return undefined;
}

export interface AutoContinueChoiceInput {
	probabilities: Record<string, number>;
	progress: number;
	consecutive: number;
	settings: ResolvedAutoContinueSettings;
	/** A blank assistant turn after a tool result is not a valid completion. */
	emptyAfterTool?: boolean;
	/** Decision-model completion estimate for this checkpoint (0..1). */
	completion?: number;
	/** Earlier auto-continue decisions this prompt, oldest first. */
	history?: AutoContinueHistoryEntry[];
	context?: { used: number; window: number };
	plan?: { total: number; done: number };
	unattended?: boolean;
	errorStreak?: number;
	repeatStreak?: number;
}

export function chooseAutoContinueAction(input: AutoContinueChoiceInput): AutoContinueAction {
	const { probabilities, consecutive, settings, emptyAfterTool, completion, history } = input;
	const continueP = probabilities.continue ?? 0;
	const askP = probabilities.ask_user ?? 0;
	const doneP = probabilities.done ?? 0;
	const blockedP = probabilities.blocked ?? 0;

	// Local hard guards dominate the model's lean.
	if (consecutive >= settings.maxConsecutive) return "stop";
	if ((input.errorStreak ?? 0) >= ERROR_STREAK_STOP) return "stop";
	if ((input.repeatStreak ?? 0) >= REPEAT_STREAK_STOP) return "stop";
	if (contextPressured(input.context)) return "stop";
	if (trajectoryStalled(history, completion)) return "stop";

	if (blockedP >= 0.5) return "stop";
	// An empty assistant turn after a tool result is a dropped completion, not
	// a valid "done" signal. Let the model veto for a block or a user question,
	// but otherwise continue once when the last tool made progress.
	const progressEvidence = hasProgressEvidence(input.progress, history, completion, settings);
	if (emptyAfterTool && progressEvidence && askP < 0.5) return "continue";
	// When the plan itself reports everything done, a weaker done vote suffices.
	const plan = input.plan;
	if (
		plan &&
		plan.total > 0 &&
		plan.done >= plan.total &&
		doneP >= DONE_PROBABILITY_WITH_COMPLETE_PLAN &&
		doneP >= continueP
	) {
		return "stop";
	}
	// Open plan items demand more conviction to stop: an agent abandoning the
	// task graph mid-run must not get an easy stop on a mere done lean.
	const openPlan = plan !== undefined && plan.total > 0 && plan.done < plan.total;
	const doneBar = openPlan ? DONE_PROBABILITY_WITH_OPEN_PLAN : DONE_PROBABILITY;
	if (doneP >= doneBar && doneP >= continueP) return "stop";
	// Hysteresis: average the continue lean with the previous checkpoint so a
	// single jittery score near the threshold cannot flip the action.
	const prior = lastContinueEntry(history);
	const continueLean = prior ? (continueP + prior.continueP) / 2 : continueP;
	if (
		continueLean >= settings.minContinueProbability &&
		progressEvidence &&
		continueP >= askP &&
		continueP >= doneP &&
		continueP >= blockedP
	) {
		return "continue";
	}
	if (input.unattended) {
		// Nobody is there to answer; the model says it is blocked on the user,
		// so waiting is not an option. Stop with the reason for the run log.
		return "stop";
	}
	if (askP >= ASK_PROBABILITY || (continueP >= ASK_PROBABILITY && progressEvidence)) {
		return "ask_user";
	}
	if (!progressEvidence) return "stop";
	return "ask_user";
}

/**
 * Ask the decision model whether to continue. Returns undefined when the
 * policy is off, the model is unavailable, or the request fails; callers then
 * keep their existing deterministic behavior.
 */
export async function decideAutoContinue(
	models: DecisionsModels,
	model: DecisionsModel<DecisionsApi>,
	state: AutoContinueState,
	settings: ResolvedAutoContinueSettings,
	signal?: AbortSignal,
): Promise<AutoContinueDecision | undefined> {
	if (settings.mode === "off") return undefined;

	// Deterministic local guards run first: the model call is skipped entirely
	// when the state is already decisive.
	const localStop = localAutoContinueStop(state, settings);
	if (localStop) return stop(state, localStop, model.id);

	const result = await models.postDecisions(
		model,
		{ state: serializeState(state), questions: buildAutoContinueQuestions(state.checkpoint) },
		{ ...(signal ? { signal } : {}) },
	);
	if (result.stopReason !== "stop") return undefined;

	const choice = choiceAnswer(result);
	const progress = noulAnswer(result);
	if (!choice) return undefined;

	const probabilities = choice.probabilities ?? {};
	const continueP = probability(choice, "continue");
	const progressP = progress?.noul ?? 0;
	const score = scoreAnswer(result);
	const completion =
		typeof score?.score === "number" && Number.isFinite(score.score)
			? Math.min(1, Math.max(0, score.score / COMPLETION_SCORE_MAX))
			: undefined;
	const history = state.history ?? [];
	const action = chooseAutoContinueAction({
		probabilities,
		progress: progressP,
		consecutive: state.consecutive,
		settings,
		emptyAfterTool: state.emptyAfterTool,
		completion,
		history,
		...(state.context ? { context: state.context } : {}),
		...(state.plan ? { plan: state.plan } : {}),
		...(state.unattended ? { unattended: true } : {}),
		...(state.errorStreak ? { errorStreak: state.errorStreak } : {}),
		...(state.repeatStreak ? { repeatStreak: state.repeatStreak } : {}),
	});
	const modelId = result.servedModel ?? result.model;
	const latencyMs = result.durationMs ?? 0;
	const summary = `next=${choice.choice} p=${continueP.toFixed(2)} progress=${progressP.toFixed(2)}${
		completion !== undefined ? ` completion=${completion.toFixed(2)}` : ""
	}`;

	return {
		action,
		checkpoint: state.checkpoint,
		probabilities,
		progress: progressP,
		...(completion !== undefined ? { completion } : {}),
		progressed: hasProgressEvidence(progressP, history, completion, settings),
		...(typeof choice.confidence === "number" ? { confidence: choice.confidence } : {}),
		model: modelId,
		latencyMs,
		reason: summary,
	};
}

/** Append a decision to the trajectory history, bounded. */
export function recordAutoContinueDecision(history: AutoContinueHistoryEntry[], decision: AutoContinueDecision): void {
	history.push({
		checkpoint: decision.checkpoint,
		action: decision.action,
		continueP: decision.probabilities.continue ?? 0,
		progress: decision.progress,
		...(decision.completion !== undefined ? { completion: decision.completion } : {}),
	});
	if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

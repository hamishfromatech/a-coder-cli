/**
 * Decision-model policy for continuation checkpoints.
 *
 * Decision models are non-generative: this module only asks whether the agent
 * should continue, ask the user, or stop. The main model still does the work.
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
import type { ResolvedAutoContinueSettings } from "./settings-manager.ts";

export type AutoContinueCheckpoint = "length" | "compaction" | "agent_end" | "tool_pause";
export type AutoContinueAction = "continue" | "ask_user" | "stop";

export interface AutoContinueState {
	checkpoint: AutoContinueCheckpoint;
	/** Latest user request, truncated. */
	goal: string;
	/** Final assistant text, truncated. */
	lastAssistant: string;
	/** Compact recent message summaries. */
	recent: string[];
	/** Smart continuations already used for this prompt. */
	consecutive: number;
	stopReason?: string;
	/** Name of the most recent tool result, when the last turn used a tool. */
	lastTool?: string;
	/** True when the assistant stopped with no visible text immediately after a tool result. */
	emptyAfterTool?: boolean;
	context?: { used: number; window: number };
}

export interface AutoContinueDecision {
	action: AutoContinueAction;
	checkpoint: AutoContinueCheckpoint;
	/** Raw choice probabilities keyed by option name. */
	probabilities: Record<string, number>;
	/** Probability that the last few turns made progress. */
	progress: number;
	/** Model-reported distribution concentration (not accuracy). */
	confidence?: number;
	model?: string;
	latencyMs: number;
	reason: string;
}

const MAX_STRING = 6000;
const MAX_RECENT = 8;
const MAX_RECENT_CHARS = 500;

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
			: "Should the coding agent continue working without user input?";
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

export interface AutoContinueChoiceInput {
	probabilities: Record<string, number>;
	progress: number;
	consecutive: number;
	settings: ResolvedAutoContinueSettings;
	/** A blank assistant turn after a tool result is not a valid completion. */
	emptyAfterTool?: boolean;
}

export function chooseAutoContinueAction(input: AutoContinueChoiceInput): AutoContinueAction {
	const { probabilities, progress, consecutive, settings, emptyAfterTool } = input;
	if (consecutive >= settings.maxConsecutive) return "stop";
	const continueP = probabilities.continue ?? 0;
	const askP = probabilities.ask_user ?? 0;
	const doneP = probabilities.done ?? 0;
	const blockedP = probabilities.blocked ?? 0;

	if (blockedP >= 0.5) return "stop";
	// An empty assistant turn after a tool result is a dropped completion, not
	// a valid "done" signal. Let the model veto for a block or a user question,
	// but otherwise continue once when the last tool made progress.
	if (emptyAfterTool && progress >= settings.minProgressProbability && askP < 0.5) return "continue";
	if (doneP >= 0.55 && doneP >= continueP) return "stop";
	if (
		continueP >= settings.minContinueProbability &&
		progress >= settings.minProgressProbability &&
		continueP >= askP &&
		continueP >= doneP &&
		continueP >= blockedP
	) {
		return "continue";
	}
	if (askP >= 0.35 || (continueP >= 0.35 && progress >= settings.minProgressProbability)) return "ask_user";
	if (progress < settings.minProgressProbability) return "stop";
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
	if (state.consecutive >= settings.maxConsecutive) {
		return stop(state, `smart continuation limit reached (${settings.maxConsecutive})`, model.id);
	}

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
	const modelId = result.servedModel ?? result.model;
	const latencyMs = result.durationMs ?? 0;
	const action = chooseAutoContinueAction({
		probabilities,
		progress: progressP,
		consecutive: state.consecutive,
		settings,
		emptyAfterTool: state.emptyAfterTool,
	});
	const summary = `next=${choice.choice} p=${continueP.toFixed(2)} progress=${progressP.toFixed(2)}`;

	return {
		action,
		checkpoint: state.checkpoint,
		probabilities,
		progress: progressP,
		...(typeof choice.confidence === "number" ? { confidence: choice.confidence } : {}),
		model: modelId,
		latencyMs,
		reason: summary,
	};
}

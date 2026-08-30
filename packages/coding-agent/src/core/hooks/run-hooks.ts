/**
 * Hook runner: reads Claude-Code-compatible hook configs from settings.json
 * files, matches them per event, executes `command`-type hooks, and decodes
 * their verdicts (exit code + JSON stdout protocol).
 *
 * Decision aggregation across hooks for one event:
 *   deny (block)  >  ask  >  approve
 * `additionalContext` strings from all hooks are concatenated in run order.
 */

import { executeHookCommand, type HookExecutionResult } from "./executor.ts";
import { type ReadHooksOptions, readHooksConfig } from "./hook-config-reader.ts";
import type { ClaudeHookEventName } from "./hook-events.ts";

/** Kill switch: set A_CODER_CLI_DISABLE_HOOKS to skip hook execution entirely. */
export function hooksEnabled(): boolean {
	return !process.env.A_CODER_CLI_DISABLE_HOOKS;
}

// ── On-disk config cache (short TTL, keyed by home+cwd) ─────────────────────

interface CacheEntry {
	at: number;
	config: ReturnType<typeof readHooksConfig>;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000;

function cacheKey(options: ReadHooksOptions): string {
	return `${options.home ?? ""}\u0000${options.cwd ?? process.cwd()}`;
}

function readHooksCached(options: ReadHooksOptions): ReturnType<typeof readHooksConfig> {
	const key = cacheKey(options);
	const cached = cache.get(key);
	const now = Date.now();
	if (cached && now - cached.at < CACHE_TTL_MS) {
		return cached.config;
	}
	const config = readHooksConfig(options);
	cache.set(key, { at: now, config });
	return config;
}

// ── Match semantics (Claude Code style) ─────────────────────────────────────

const REGEX_META_CHARS = /[*+?()[{\\^$|.=]/;

/**
 * Matched when the matcher is omitted or "*", matches the key exactly, or
 * contains regex metacharacters in which case it is treated as a regex.
 */
export function matcherApplies(matcher: string | undefined, key: string): boolean {
	if (!matcher || matcher.trim() === "" || matcher === "*") return true;
	if (REGEX_META_CHARS.test(matcher)) {
		try {
			return new RegExp(matcher).test(key);
		} catch {
			return false;
		}
	}
	return matcher === key;
}

// ── Hook JSON output decoding ───────────────────────────────────────────────

export interface HookJsonOutput {
	continue?: boolean;
	stopReason?: string;
	decision?: string;
	reason?: string;
	additionalContext?: string;
	systemMessage?: string;
	hookSpecificOutput?: {
		permissionDecision?: string;
		permissionDecisionReason?: string;
		additionalContext?: string;
	};
}

export interface HookDecision {
	/** Deny the action and feed `reason` to the model. */
	block?: boolean;
	/** Force a user prompt for the action (even in auto/allow modes). */
	ask?: boolean;
	/** Auto-approve the action, skipping the normal permission flow. */
	approve?: boolean;
	/** Human/model-facing reason attached to block/ask/approve. */
	reason?: string;
	/** Context strings to inject near the related message or tool result. */
	additionalContext?: string[];
}

/** Decode one hook's low-level outcome into a decision. */
export function decodeHookResult(result: HookExecutionResult): HookDecision {
	if (result.spawnError) {
		// Process could not run at all — non-blocking failure.
		return {};
	}
	if (result.exitCode === 2) {
		const reason = result.stderr.trim() !== "" ? result.stderr.trim() : "Blocked by hook";
		return { block: true, reason };
	}
	if (result.exitCode !== 0) {
		// Any other non-zero exit: non-blocking hook error.
		return {};
	}
	const trimmed = result.stdout.trim();
	if (!trimmed) return {};

	let parsed: HookJsonOutput;
	try {
		parsed = JSON.parse(trimmed) as HookJsonOutput;
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== "object") return {};

	const hookSpecific = parsed.hookSpecificOutput;
	if (parsed.continue === false) {
		return { block: true, reason: parsed.stopReason || parsed.reason || "Stopped by hook" };
	}
	if (parsed.decision === "block") {
		return { block: true, reason: parsed.reason || parsed.stopReason || "Blocked by hook" };
	}
	if (hookSpecific?.permissionDecision === "deny") {
		return { block: true, reason: hookSpecific.permissionDecisionReason || parsed.reason };
	}
	if (hookSpecific?.permissionDecision === "ask") {
		return { ask: true, reason: hookSpecific.permissionDecisionReason || parsed.reason };
	}
	if (hookSpecific?.permissionDecision === "allow" || parsed.decision === "approve") {
		return { approve: true, reason: hookSpecific?.permissionDecisionReason || parsed.reason };
	}

	const context: string[] = [];
	if (typeof parsed.additionalContext === "string" && parsed.additionalContext.trim() !== "") {
		context.push(parsed.additionalContext);
	}
	if (typeof hookSpecific?.additionalContext === "string" && hookSpecific.additionalContext.trim() !== "") {
		context.push(hookSpecific.additionalContext);
	}
	return context.length > 0 ? { additionalContext: context } : {};
}

// ── Event runner ────────────────────────────────────────────────────────────

export interface RunHooksOptions extends ReadHooksOptions {
	signal?: AbortSignal;
}

export interface HookRunOutcome {
	/** Deny the action (any hook denied). */
	block: boolean;
	/** Force a user prompt (no hook denied, at least one asked). */
	ask: boolean;
	/** Auto-approve (no deny/ask, at least one approved). */
	approve: boolean;
	/** Reason from the highest-priority decision. */
	reason?: string;
	/** Context strings to inject near the related message or tool result. */
	additionalContext: string[];
	/** Non-blocking hook problems (spawn failures, bad exit codes), for logging. */
	errors: string[];
	/** Number of command hooks that ran. */
	ran: number;
}

/**
 * Run all matching `command`-type hooks for one hook event and aggregate the
 * decisions (deny > ask > approve). Prompt/agent hook types are IDE-only and
 * skipped here.
 */
export async function runConfiguredHooks(
	event: ClaudeHookEventName,
	matcherKey: string | undefined,
	input: Record<string, unknown>,
	options: RunHooksOptions = {},
): Promise<HookRunOutcome> {
	const outcome: HookRunOutcome = {
		block: false,
		ask: false,
		approve: false,
		additionalContext: [],
		errors: [],
		ran: 0,
	};
	if (!hooksEnabled()) return outcome;

	const config = readHooksCached(options);
	const matchers = config[event] ?? [];

	for (const matcherEntry of matchers) {
		if (!matcherEntry || typeof matcherEntry !== "object") continue;
		if (!matcherApplies(matcherEntry.matcher, matcherKey ?? "")) continue;
		for (const hook of matcherEntry.hooks ?? []) {
			if (!hook || hook.type !== "command") continue;
			outcome.ran++;
			const result = await executeHookCommand(hook, input, {
				cwd: options.cwd,
				signal: options.signal,
			});
			if (result.spawnError) {
				outcome.errors.push(`hook "${hook.command}" failed to spawn: ${result.spawnError}`);
				continue;
			}
			if (result.exitCode !== 0 && result.exitCode !== 2) {
				const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
				outcome.errors.push(`hook "${hook.command}" failed: ${detail}`);
				continue;
			}
			const decision = decodeHookResult(result);
			if (decision.block) {
				outcome.block = true;
				outcome.ask = false;
				outcome.approve = false;
				outcome.reason = decision.reason;
			} else if (decision.ask && !outcome.block) {
				outcome.ask = true;
				outcome.reason = outcome.reason ?? decision.reason;
			} else if (decision.approve && !outcome.block && !outcome.ask) {
				outcome.approve = true;
				outcome.reason = outcome.reason ?? decision.reason;
			}
			if (decision.additionalContext && decision.additionalContext.length > 0) {
				outcome.additionalContext.push(...decision.additionalContext);
			}
		}
	}
	return outcome;
}

/** Build the JSON payload passed to a hook on stdin. */
export function buildHookInput(
	sessionId: string,
	cwd: string,
	event: ClaudeHookEventName,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		session_id: sessionId,
		cwd,
		hook_event_name: event,
		...extra,
	};
}

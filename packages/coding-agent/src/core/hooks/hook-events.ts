/**
 * Hook event-name compatibility — maps the A-Coder IDE's Claude-Code-compatible
 * hook event names (PascalCase) to a-coder-cli's extension events (snake_case).
 *
 * The IDE stores hooks in settings.json keyed by PascalCase event names:
 *   PreToolUse, PostToolUse, Stop, StopFailure, UserPromptSubmit,
 *   SessionStart, SubagentStart, SubagentStop, PreCompact
 *   (plus A-Coder-native: DiffZoneApply, DiffZoneApply, AutocompleteSuggest,
 *    ContextGather, ModeSwitch — not applicable to the CLI).
 *
 * a-coder-cli fires extension events with snake_case names. This module is the
 * bridge: it translates an IDE hook event name to the corresponding CLI
 * extension event name(s), so a hook config written for the IDE can fire at
 * the right moment in the CLI.
 *
 * Type definitions mirror the IDE's hookServiceTypes.ts so the on-disk format
 * is identical and portable.
 */

/** Claude-Code-compatible hook event names the IDE uses. */
export type ClaudeHookEventName =
	| "PreToolUse"
	| "PostToolUse"
	| "Stop"
	| "StopFailure"
	| "UserPromptSubmit"
	| "SessionStart"
	| "SubagentStart"
	| "SubagentStop"
	| "PreCompact";

/** a-coder-cli extension event names that have a hook analogue. */
export type CliHookEventName =
	| "tool_call"
	| "tool_result"
	| "turn_end"
	| "agent_start"
	| "agent_end"
	| "input"
	| "session_start"
	| "session_before_compact";

/**
 * Map a Claude-Code PascalCase hook event name to the corresponding
 * a-coder-cli extension event name. Returns undefined for events that have
 * no CLI analogue (e.g. IDE-only DiffZoneApply).
 *
 * Mappings:
 *   PreToolUse      → tool_call        (decision gate before a tool runs)
 *   PostToolUse     → tool_result      (after a tool completes)
 *   Stop            → turn_end         (agent turn finished normally)
 *   StopFailure     → agent_end        (agent stopped due to failure)
 *   UserPromptSubmit→ input           (user submitted a prompt)
 *   SessionStart    → session_start    (session began)
 *   SubagentStart   → (no direct CLI event yet — maps to agent_start for now)
 *   SubagentStop    → (no direct CLI event yet — maps to agent_end for now)
 *   PreCompact      → session_before_compact (before context compaction)
 */
export function claudeHookEventToCli(event: ClaudeHookEventName): CliHookEventName | undefined {
	switch (event) {
		case "PreToolUse":
			return "tool_call";
		case "PostToolUse":
			return "tool_result";
		case "Stop":
			return "turn_end";
		case "StopFailure":
			return "agent_end";
		case "UserPromptSubmit":
			return "input";
		case "SessionStart":
			return "session_start";
		case "PreCompact":
			return "session_before_compact";
		case "SubagentStart":
			return "agent_start";
		case "SubagentStop":
			return "agent_end";
		default:
			return undefined;
	}
}

/** The set of Claude-Code-compatible event names the CLI recognizes. */
export const CLAUDE_HOOK_EVENTS: ReadonlySet<ClaudeHookEventName> = new Set([
	"PreToolUse",
	"PostToolUse",
	"Stop",
	"StopFailure",
	"UserPromptSubmit",
	"SessionStart",
	"SubagentStart",
	"SubagentStop",
	"PreCompact",
]);

/** Reverse lookup: CLI event → Claude-Code event name(s). */
export function cliEventToClaudeHook(event: CliHookEventName): ClaudeHookEventName[] {
	const out: ClaudeHookEventName[] = [];
	for (const name of CLAUDE_HOOK_EVENTS) {
		if (claudeHookEventToCli(name) === event) out.push(name);
	}
	return out;
}

// ── On-disk config format (mirrors the IDE's hookServiceTypes.ts) ───────────

export type HookType = "command" | "prompt" | "agent";

export interface HookConfig {
	type: HookType;
	/** command type: shell command (shell form). */
	command?: string;
	/** command type: argument array (no shell tokenization). */
	args?: string[];
	/** command type: extra env vars for the subprocess. */
	env?: Record<string, string>;
	/** prompt/agent type: the prompt text. `$ARGUMENTS` is substituted. */
	prompt?: string;
	/** prompt/agent type: optional model override. */
	model?: string;
	/** Seconds before the hook is cancelled. */
	timeout?: number;
	/** Custom spinner/status message shown while the hook runs. */
	statusMessage?: string;
	/** If true, the hook is removed after its first successful fire (session-scoped only). */
	once?: boolean;
	/** Permission-rule conditional (`"Bash(git *)"`, `"Edit(*.ts)"`). */
	if?: string;
}

export interface HookMatcher {
	/** Match against the event's key (tool name for tool events, etc.). */
	matcher?: string;
	hooks: HookConfig[];
}

/** Hooks config keyed by Claude-Code event name. */
export type HooksConfig = Partial<Record<ClaudeHookEventName, HookMatcher[]>>;

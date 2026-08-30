/**
 * Permission policy engine for the built-in permission mode selector.
 *
 * Modes:
 * - "ask": prompt the user before every tool call (interactive only).
 * - "allow": approve every tool call automatically.
 * - "read-only": deny built-in mutating tools (bash, edit, write).
 * - "auto": apply policy rules (hardDeny, softDeny, allow) with "$defaults" support.
 */

import type { PermissionMode, PermissionPolicyConfig, PermissionRule } from "./settings-manager.ts";

export type PermissionDecisionResult =
	| { decision: "approve"; matchedDefault?: boolean }
	| { decision: "prompt"; reason?: string }
	| { decision: "deny"; reason: string };

/** Built-in tools that can mutate the filesystem or execute arbitrary code. */
export const DEFAULT_MUTATING_TOOL_NAMES = new Set<string>(["bash", "edit", "write"]);

/**
 * Tools the auto-mode classifier never needs to be invoked for: pure reads,
 * status, or user-interactive surfaces. Anything else (mcp, extension tools,
 * bash/edit/write) goes through the classifier when enabled and static rules
 * matched the default-allow path.
 */
export const AUTO_MODE_SAFE_TOOL_NAMES = new Set<string>([
	"read",
	"ls",
	"grep",
	"find",
	"todo",
	"memory",
	"ask_user_question",
	"plan_mode",
	"skill",
	"task_get",
	"task_list",
	"mcp_list_resources",
]);

/** Sentinel rule that expands to the default mutating tool names. */
export const DEFAULTS_RULE_SENTINEL = "$defaults";

function expandRule(rule: PermissionRule): string[] {
	if (rule === DEFAULTS_RULE_SENTINEL) {
		return [...DEFAULT_MUTATING_TOOL_NAMES];
	}
	return [rule];
}

function ruleMatches(rule: string, toolName: string): boolean {
	if (rule === toolName) {
		return true;
	}
	if (rule.endsWith(":*")) {
		const prefix = rule.slice(0, -1);
		return toolName.startsWith(prefix);
	}
	return false;
}

/** A policy rule optionally scoped to tool arguments: `"Bash(git *)"`. */
export interface ParsedPolicyRule {
	rule: string;
	tool: string;
	/** Glob applied to the tool's primary argument (undefined = match any args). */
	argGlob?: string;
}

/** Split `"Bash(git *)"` into { tool: "bash", argGlob: "git *" }. Returns undefined when malformed. */
export function parsePolicyRule(rule: string): ParsedPolicyRule | undefined {
	const open = rule.indexOf("(");
	if (open === -1 || !rule.endsWith(")")) {
		return undefined;
	}
	const tool = rule.slice(0, open).trim().toLowerCase();
	const argGlob = rule.slice(open + 1, -1).trim();
	if (tool === "" || argGlob === "") {
		return undefined;
	}
	return { rule, tool, argGlob };
}

/** Translate an argument glob (`git *`) into a whole-string regex (case-insensitive). */
function globToRegExp(glob: string): RegExp {
	let pattern = "";
	for (const char of glob) {
		if (char === "*") {
			pattern += ".*";
		} else if (char === "?") {
			pattern += ".";
		} else {
			pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${pattern}$`, "i");
}

/**
 * The value of a tool's input that arg-globs match against: bash matches the
 * command string, file tools match their path argument, everything else falls
 * back to the serialized args.
 */
export function toolCallMatchValue(toolName: string, args: Record<string, unknown> | undefined): string {
	const record = (args ?? {}) as Record<string, unknown>;
	const stringArg = (key: string): string | undefined =>
		typeof record[key] === "string" ? (record[key] as string) : undefined;
	switch (toolName) {
		case "bash": {
			return stringArg("command") ?? "";
		}
		case "edit":
		case "write":
		case "read":
		case "ls": {
			return stringArg("path") ?? stringArg("file_path") ?? "";
		}
		default: {
			return JSON.stringify(record);
		}
	}
}

/** Match a parsed `Tool(glob)` rule against a concrete tool call. */
export function matcherRuleMatches(
	parsed: ParsedPolicyRule,
	toolName: string,
	args: Record<string, unknown> | undefined,
): boolean {
	if (parsed.tool !== toolName) {
		return false;
	}
	if (parsed.argGlob === undefined) {
		// `Tool()` without args behaves like the bare rule.
		return true;
	}
	return globToRegExp(parsed.argGlob).test(toolCallMatchValue(toolName, args));
}

function anyRuleMatches(
	rules: PermissionRule[] | undefined,
	toolName: string,
	args: Record<string, unknown> | undefined,
): boolean {
	if (!rules) {
		return false;
	}
	for (const rule of rules) {
		for (const expanded of expandRule(rule)) {
			if (ruleMatches(expanded, toolName)) {
				return true;
			}
			// Arg-scoped forms (`Bash(git *)`) additionally match on args.
			const parsed = parsePolicyRule(expanded);
			if (parsed && matcherRuleMatches(parsed, toolName, args)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Resolve the permission decision for a tool call.
 *
 * @param mode Current permission mode.
 * @param toolName Name of the tool being invoked.
 * @param policies Configured policy rules (only used by "auto" mode).
 * @param isInteractive Whether the session can prompt the user. Non-interactive sessions
 *   treat "prompt" decisions as "deny".
 */
export function resolvePermissionDecision(
	mode: PermissionMode,
	toolName: string,
	policies: PermissionPolicyConfig | undefined,
	isInteractive: boolean,
	args?: Record<string, unknown>,
): PermissionDecisionResult {
	switch (mode) {
		case "allow":
			return { decision: "approve" };
		case "ask":
			return isInteractive
				? { decision: "prompt", reason: `Permission mode is "ask"` }
				: { decision: "deny", reason: `Permission mode is "ask" but no TTY is available` };
		case "read-only":
			return DEFAULT_MUTATING_TOOL_NAMES.has(toolName)
				? { decision: "deny", reason: `Tool "${toolName}" is blocked in read-only mode` }
				: { decision: "approve" };
		case "auto": {
			const effectivePolicies = policies ?? { softDeny: [DEFAULTS_RULE_SENTINEL] };

			if (anyRuleMatches(effectivePolicies.hardDeny, toolName, args)) {
				return { decision: "deny", reason: `Tool "${toolName}" matches hard-deny policy` };
			}

			// Allow wins over soft-deny so a scoped allow ("Bash(npm test*)") can
			// carve exceptions out of a broad prompt rule ("Bash(*)").
			if (anyRuleMatches(effectivePolicies.allow, toolName, args)) {
				return { decision: "approve" };
			}

			if (anyRuleMatches(effectivePolicies.softDeny, toolName, args)) {
				return isInteractive
					? { decision: "prompt", reason: `Tool "${toolName}" matches soft-deny policy` }
					: { decision: "deny", reason: `Tool "${toolName}" matches soft-deny policy (no TTY)` };
			}

			// Default auto behavior: allow anything not explicitly restricted
			// unless the agent session's LLM classifier vetoes it (flagged to the
			// caller via matchedDefault).
			return { decision: "approve", matchedDefault: true };
		}
		default: {
			// Exhaustiveness fallback - treat unknown modes as ask.
			const unknownMode = mode as string;
			return { decision: "deny", reason: `Unknown permission mode "${unknownMode}"` };
		}
	}
}

/**
 * Expand a policy rule list for display or serialization.
 * "$defaults" is replaced with the concrete tool names it represents.
 */
export function expandPolicyRules(rules: PermissionRule[] | undefined): string[] {
	if (!rules) {
		return [];
	}
	const expanded: string[] = [];
	for (const rule of rules) {
		expanded.push(...expandRule(rule));
	}
	return expanded;
}

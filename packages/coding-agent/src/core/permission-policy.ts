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
	| { decision: "approve" }
	| { decision: "prompt"; reason?: string }
	| { decision: "deny"; reason: string };

/** Built-in tools that can mutate the filesystem or execute arbitrary code. */
export const DEFAULT_MUTATING_TOOL_NAMES = new Set<string>(["bash", "edit", "write"]);

/** Sentinel rule that expands to the default mutating tool names. */
export const DEFAULTS_RULE_SENTINEL = "$defaults";

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

function expandRule(rule: PermissionRule): string[] {
	if (rule === DEFAULTS_RULE_SENTINEL) {
		return [...DEFAULT_MUTATING_TOOL_NAMES];
	}
	return [rule];
}

function anyRuleMatches(rules: PermissionRule[] | undefined, toolName: string): boolean {
	if (!rules) {
		return false;
	}
	for (const rule of rules) {
		for (const expanded of expandRule(rule)) {
			if (ruleMatches(expanded, toolName)) {
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

			if (anyRuleMatches(effectivePolicies.hardDeny, toolName)) {
				return { decision: "deny", reason: `Tool "${toolName}" matches hard-deny policy` };
			}

			if (anyRuleMatches(effectivePolicies.softDeny, toolName)) {
				return isInteractive
					? { decision: "prompt", reason: `Tool "${toolName}" matches soft-deny policy` }
					: { decision: "deny", reason: `Tool "${toolName}" matches soft-deny policy (no TTY)` };
			}

			if (anyRuleMatches(effectivePolicies.allow, toolName)) {
				return { decision: "approve" };
			}

			// Default auto behavior: allow anything not explicitly restricted.
			return { decision: "approve" };
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

/**
 * Tool-pool resolver for sub-agents.
 *
 * One rule applies to every agent: the Agent/spawn_subagent tool itself is
 * stripped unconditionally so a sub-agent can never spawn another sub-agent
 * (the "no recursion" guarantee). On top of that, the agent's `disallowedTools`
 * deny-list and optional `tools` allow-list are applied.
 *
 * Operates on tool NAMES (strings) so it stays decoupled from the concrete Tool
 * type used by the agent loop — callers map the resolved names to their tool
 * objects. Tier 2/3 will consume `resolvedToolNames` to build the sub-agent's
 * actual tool pool.
 */

import type { AgentDefinition } from "./types.ts";

/** The tool name(s) that spawn sub-agents. Always stripped from a sub-agent's pool. */
export const SUBAGENT_TOOL_NAMES = new Set(["spawn_subagent", "Agent"]);

export interface ResolvedAgentTools {
	/** True when the agent allows everything that survives filtering (no explicit allow-list, or ["*"]). */
	hasWildcard: boolean;
	/** Tool names the sub-agent may use. */
	resolvedToolNames: string[];
	/** Names listed in `tools` that don't match any available tool — surfaced so misconfigured agents fail loudly. */
	invalidTools: string[];
}

/**
 * Build the sub-agent's tool-name pool from the parent's available tool names,
 * the agent's allow-list, and the agent's deny-list.
 *
 * Algorithm:
 *   1. Strip the sub-agent-spawning tools (no recursion).
 *   2. Apply `disallowedTools` (acts even when `tools` is wildcard).
 *   3. If `tools` is undefined / empty / ["*"], keep everything that survives.
 *   4. Otherwise, filter to the named subset (in declaration order, deduped).
 *      Unmatched names go to `invalidTools`.
 */
export function resolveAgentTools(
	def: Pick<AgentDefinition, "tools" | "disallowedTools">,
	availableToolNames: string[],
): ResolvedAgentTools {
	const noSubagent = availableToolNames.filter((name) => !SUBAGENT_TOOL_NAMES.has(name));
	const disallowed = new Set(def.disallowedTools ?? []);
	const afterDisallow = noSubagent.filter((name) => !disallowed.has(name));

	const tools = def.tools;
	const hasWildcard = !tools || tools.length === 0 || (tools.length === 1 && tools[0] === "*");
	if (hasWildcard) {
		return { hasWildcard: true, resolvedToolNames: afterDisallow, invalidTools: [] };
	}

	const byName = new Set(afterDisallow);
	const resolvedToolNames: string[] = [];
	const seen = new Set<string>();
	const invalidTools: string[] = [];
	for (const wanted of tools) {
		if (!byName.has(wanted)) {
			invalidTools.push(wanted);
			continue;
		}
		if (!seen.has(wanted)) {
			seen.add(wanted);
			resolvedToolNames.push(wanted);
		}
	}

	return { hasWildcard: false, resolvedToolNames, invalidTools };
}

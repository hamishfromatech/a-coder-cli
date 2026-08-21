/**
 * Sub-agent definitions — describe one named sub-agent the model can delegate
 * to via the `Agent`/`spawn_subagent` tool. Mirrors the easy-agent / Claude Code
 * `loadAgentsDir` shape, adapted to pi-mono.
 *
 * An agent is a Markdown file with YAML frontmatter:
 *
 *   ---
 *   name: "reviewer"
 *   description: "Code review specialist — invoke when the user asks for a review."
 *   tools: "read,grep,bash"            # optional allow-list (omit / ["*"] = wildcard)
 *   disallowedTools: "edit,write"      # optional deny-list (applies even when wildcard)
 *   model: "claude-haiku-4-5"          # optional model override
 *   maxTurns: 12                       # optional loop cap
 *   permissionMode: "default"          # optional: "default" | "plan" | "auto"
 *   isolation: "none"                  # optional: "none" | "worktree" (Tier 3)
 *   ---
 *   You are a senior code reviewer... (the body IS the sub-agent's system prompt)
 *
 * Sources, in priority order (later wins on name collision):
 *   1. built-in — hard-coded in ./builtIn.ts
 *   2. user     — ~/.a-coder-cli/agent/agents/*.md
 *   3. project  — <cwd>/.a-coder-cli/agents/*.md   (highest)
 */

export type AgentSource = "built-in" | "user" | "project";

export type AgentPermissionMode = "default" | "plan" | "auto";

/**
 * Filesystem isolation for the sub-agent. Tier 3 will wire "worktree" to a
 * fresh `git worktree` so a sub-agent's edits don't touch the main working
 * copy until reviewed. Tier 1 only carries the field.
 */
export type AgentIsolation = "none" | "worktree";

export interface AgentDefinition {
	/** Unique identifier — the `subagent_type` value passed to the Agent tool. */
	agentType: string;
	/** Human-readable "when to use" text shown in the system prompt so the model picks the right agent. */
	whenToUse: string;
	/** Optional explicit allow-list of tool names. Undefined / ["*"] → wildcard (everything except the Agent tool itself). */
	tools?: string[];
	/** Tool names stripped even when `tools` is wildcard. */
	disallowedTools?: string[];
	/** Optional model override; falls back to the parent's current model. */
	model?: string;
	/** Hard cap on the sub-agent's loop iterations. */
	maxTurns?: number;
	/** Sub-agent's permission mode; defaults to inheriting the parent's. */
	permissionMode?: AgentPermissionMode;
	/** Default filesystem isolation level. Tier 3 will honour "worktree". */
	isolation?: AgentIsolation;
	/** Where this definition came from. */
	source: AgentSource;
	/** Absolute path to the source `.md` file (custom agents only). */
	filePath?: string;
	/** Returns the system prompt for this agent. */
	getSystemPrompt(): string;
}

/** Result of loading agents from disk. */
export interface LoadAgentsResult {
	agents: AgentDefinition[];
	warnings: string[];
}

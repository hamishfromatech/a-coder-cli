/**
 * Format the available-sub-agents discovery listing into a `<system-reminder>`
 * block appended to the system prompt. The model uses this to pick a
 * `subagent_type` for the `spawn_subagent`/`Agent` tool, and to scaffold a
 * brand-new agent file in the correct format when the user asks for one.
 *
 * Ported from easy-agent's `agents/promptInjection.ts`, adapted to pi-mono's
 * config dir (`.a-coder-cli`) and tool names (`spawn_subagent`).
 */

import type { AgentDefinition } from "./types.ts";

const MAX_DESC_CHARS = 220;

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	if (max <= 1) return "…";
	return `${s.slice(0, max - 1).trimEnd()}…`;
}

const CREATION_GUIDANCE = [
	"",
	"Defining a new sub-agent (when the user asks you to create / scaffold one):",
	"- File path: `<cwd>/.a-coder-cli/agents/<name>.md` (project-scope, default)",
	"                or `~/.a-coder-cli/agent/agents/<name>.md` (user-scope, shared across projects)",
	"- File extension MUST be `.md` — `.yaml` / `.json` / `.txt` files are ignored by the loader.",
	"- Format: a Markdown file with a YAML frontmatter header followed by the system prompt body.",
	"- Required frontmatter fields: `name` (sub-agent identifier), `description` (whenToUse text shown to the dispatching agent).",
	"- Optional frontmatter fields: `tools` (CSV or YAML list — explicit allow-list; omit for wildcard),",
	"  `disallowedTools` (CSV or YAML list — strip from the wildcard pool, e.g. write/edit for read-only agents),",
	"  `model` (override; falls back to parent's), `maxTurns` (positive integer), `permissionMode` (default | plan | auto).",
	"- The Markdown body BELOW the frontmatter IS the sub-agent's system prompt — no extra wrapping needed.",
	"- After writing, the user must restart a-coder-cli for the registry to pick the new file up.",
	"",
	"Template — copy verbatim and edit:",
	"```markdown",
	"---",
	'name: "my-agent"',
	'description: "One-sentence whenToUse — the dispatching agent reads this to decide whether to delegate."',
	'tools: "read,grep,find"',
	'disallowedTools: "write,edit"',
	'model: "claude-sonnet-4-5"',
	"maxTurns: 20",
	'permissionMode: "default"',
	"---",
	"You are <role>. Your job is <one-sentence mission>.",
	"",
	"<Detailed instructions, output format, constraints.>",
	"```",
].join("\n");

/**
 * Render the "available sub-agents" system-reminder block. Returns an empty
 * string when there are no agents (so callers can concatenate unconditionally).
 */
export function formatAgentsSystemReminder(agents: AgentDefinition[]): string {
	if (agents.length === 0) return "";

	// Built-ins first, then alphabetical — stable across turns regardless of load order.
	const sorted = [...agents].sort((a, b) => {
		if (a.source === "built-in" && b.source !== "built-in") return -1;
		if (a.source !== "built-in" && b.source === "built-in") return 1;
		return a.agentType.localeCompare(b.agentType);
	});

	const lines = sorted.map((a) => {
		const tag = a.source === "built-in" ? "built-in" : a.source === "project" ? "project" : "user";
		return `- ${a.agentType} [${tag}]: ${truncate(a.whenToUse, MAX_DESC_CHARS)}`;
	});

	return [
		"<system-reminder>",
		"Available sub-agents you can invoke via the `spawn_subagent` tool. Each sub-agent runs in its own context window with its own tool set and returns a concise summary.",
		'Call `spawn_subagent(id="...", task="...", subagent_type="<name>")` to delegate a focused subtask. Use a short kebab-case `id`.',
		"Use sub-agents to keep the main conversation context clean — search-heavy or read-heavy work is a good fit. Do not delegate trivial single-step tasks.",
		"Sub-agents do NOT see the main conversation history, so the `task` prompt must be self-contained.",
		"",
		"Foreground vs background:",
		"- Use foreground (default) when you need the agent's results before you can proceed — e.g., a research agent whose findings inform your next steps.",
		"- Use `detached: true` when the user has independent work for you to do in parallel, or when the user explicitly asks for a background task.",
		"- After launching a background sub-agent you will be notified automatically when it completes — do NOT sleep, poll, or proactively check on its progress (no bash sleeps, no read on the output file).",
		"- You CAN continue with other unrelated work while a background sub-agent is running, including launching MORE background sub-agents for genuinely independent subtasks.",
		"- Or you can simply tell the user what you launched and end your response — the system will resume the conversation automatically when the sub-agent finishes.",
		"",
		...lines,
		CREATION_GUIDANCE,
		"</system-reminder>",
	].join("\n");
}

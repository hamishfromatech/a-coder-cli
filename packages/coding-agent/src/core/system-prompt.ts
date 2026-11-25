/**
 * System prompt construction and project context loading
 */

import { join } from "node:path";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { type AgentDefinition, formatAgentsSystemReminder } from "./agents/index.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";

export type AgentSurface = "cli" | "desktop" | "rpc";

export interface BuildSystemPromptOptions {
	/** Runtime surface: terminal CLI, desktop GUI, or a generic RPC client. Default: cli. */
	surface?: AgentSurface;
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Persisted memory sections (global/workspace) injected at rebuild time. */
	memory?: Array<{ scope: string; path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/** Pre-loaded sub-agent definitions (for the available-sub-agents system reminder). */
	agents?: AgentDefinition[];
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		surface = "cli",
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		memory,
		skills: providedSkills,
		agents: providedAgents,
	} = options;
	const resolvedCwd = cwd;
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const date = `${year}-${month}-${day}`;

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];
	const agents = providedAgents ?? [];
	const tools = selectedTools || ["read", "bash", "edit", "write"];
	const skillFileReadTool = (["read", "bash"] as const).find((tool) => tools.includes(tool));

	if (customPrompt) {
		let prompt = customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n<project_context>\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
			}
			prompt += "</project_context>\n";
		}

		prompt += formatMemorySection(memory);

		// Append sub-agents section (available whenever the spawn_subagent tool is present)
		const customPromptHasSubagent = !selectedTools || selectedTools.includes("spawn_subagent");
		if (customPromptHasSubagent && agents.length > 0) {
			prompt += formatAgentsSystemReminder(agents);
		}

		// Append skills when a tool capable of reading their files is available.
		if (skillFileReadTool && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills, skillFileReadTool);
		}

		if (surface === "desktop") {
			prompt += formatDesktopSection();
		}

		// Add date and working directory last
		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// Get absolute paths to documentation and examples
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const docsIndexPath = join(docsPath, "index.md");
	const examplesPath = getExamplesPath();

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasMcpTools = tools.some(
		(name) => name.startsWith("mcp__") || name === "mcp_list_resources" || name === "mcp_read_resource",
	);
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	// Cross-tool policy for the systems that are active in this session. Tool
	// definitions cover mechanics; these lines cover when to reach for them.
	if (tools.some((name) => name.startsWith("task_"))) {
		addGuideline(
			"Use the task graph for work that needs three or more steps, spans sessions, or has dependencies; keep one task list per project.",
		);
	}
	if (tools.includes("spawn_subagent")) {
		addGuideline(
			"Use subagents for context-heavy exploration or independent work. Give each a self-contained task; use background mode only when you can continue independently.",
		);
	}
	if (tools.includes("run_workflow")) {
		addGuideline(
			"Use run_workflow for saved multi-agent scripts; use spawn_subagent for a single focused delegation.",
		);
	}
	if (tools.includes("team_create")) {
		addGuideline(
			"Use Agent Teams when teammates need to message each other; a single subagent is enough for one-off delegation.",
		);
	}
	if (hasMcpTools) {
		addGuideline(
			"When a connected MCP tool fits the task, use it directly instead of shelling out to the same service. Use mcp_list_resources / mcp_read_resource for MCP resources when they are available.",
		);
	}
	if (tools.includes("computer")) {
		addGuideline(
			"For computer use, capture before acting, prefer background delivery, and re-capture after mutations; never repeat unverified input without checking state.",
		);
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");
	addGuideline(
		"When the user asks you to create, edit, or build something, use the available tools immediately to execute the work. Do not stop after describing your plan.",
	);

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are A-Coder, an expert coding and computer-use assistant. A-Coder CLI runs in the terminal; A-Coder Desktop wraps the same engine in a native GUI. You help users by reading files, executing commands, editing code, writing new files, and operating the desktop or connected tools when those capabilities are available.

Available tools in this session:
${toolsList}

The tool definitions in this request are authoritative. They may include extension, sub-agent, team, workflow, and MCP tools that are not repeated above; MCP tools are named mcp__<server>__<tool>, and connected servers may also expose mcp_list_resources / mcp_read_resource.

Guidelines:
${guidelines}

A-Coder documentation (read only when the user asks about A-Coder itself, its SDK, extensions, skills, desktop, MCP, computer use, office, workflows, or TUI):
- Documentation index: ${docsIndexPath}
- Additional docs: ${docsPath}
- Main README: ${readmePath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- Start at the documentation index; it links quickstart, usage, settings, providers, sessions, subagents, skills, workflows/SOPs, computer use, office, RPC, SDK, and the desktop app.
- When reading a-coder-cli docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions, themes, skills, prompt templates, subagents, workflows/SOPs, computer use, office, MCP/OAuth (settings.md), keybindings, TUI components, SDK integrations, custom providers, models, packages, environment variables, security, troubleshooting
- When working on A-Coder topics, read the docs and examples, and follow .md cross-references before implementing
- Always read A-Coder .md files completely and follow links to related docs (e.g., tui.md for TUI API details). UI surfaces in A-Coder Desktop are not tools; do not claim to click them unless a tool is available.`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n<project_context>\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}

	prompt += formatMemorySection(memory);

	// Append sub-agents section (available whenever the spawn_subagent tool is present)
	const hasSubagent = tools.includes("spawn_subagent");
	if (hasSubagent && agents.length > 0) {
		prompt += formatAgentsSystemReminder(agents);
	}

	// Append skills when a tool capable of reading their files is available.
	if (skillFileReadTool && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills, skillFileReadTool);
	}

	if (surface === "desktop") {
		prompt += formatDesktopSection();
	}

	// Add date and working directory last
	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
}

function formatDesktopSection(): string {
	return `

A-Coder Desktop session:
- This session is running in the A-Coder Desktop app. The IDE, browser panel, office, session tabs, and MCP settings are app surfaces, not agent tools; do not claim to click or change them unless a tool is available.
- Prefer output that renders well in the desktop transcript: Markdown, fenced code, diffs, and images.
- For settings, pairing, or account changes that need the GUI, point the user to the relevant Settings page instead of claiming to perform the UI action.
- Use the available browser, MCP, or computer tools for page and desktop actions; do not assume the embedded browser or editor can be driven directly.`;
}

/**
 * Format the <persistent_memory> section. Memory files are read once at
 * (re)build time, so the injected snapshot can lag behind writes made during
 * the session — the text tells the model to re-read via the memory tool.
 */
function formatMemorySection(memory: BuildSystemPromptOptions["memory"]): string {
	if (!memory || memory.length === 0) return "";
	let section = "\n\n<persistent_memory>\n\n";
	section +=
		"Persisted memory from previous sessions (snapshot at startup — re-read the current contents via the memory tool before relying on them):\n\n";
	for (const entry of memory) {
		section += `<memory scope="${entry.scope}" path="${entry.path}">\n${entry.content}\n</memory>\n\n`;
	}
	section += "</persistent_memory>\n";
	return section;
}

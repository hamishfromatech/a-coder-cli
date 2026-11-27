import { describe, expect, test } from "vitest";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

const testSkill: Skill = {
	name: "test-skill",
	description: "A test skill.",
	filePath: "/skills/test-skill/SKILL.md",
	baseDir: "/skills/test-skill",
	sourceInfo: createSyntheticSourceInfo("/skills/test-skill/SKILL.md", { source: "test" }),
	disableModelInvocation: false,
};

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Available tools in this session:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});

		test("identifies as A-Coder and points at the current documentation index", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("You are A-Coder");
			expect(prompt).not.toContain("inside pi");
			expect(prompt).toContain("Documentation index:");
			expect(prompt).toContain("index.md");
			expect(prompt).toContain("A-Coder Desktop");
			expect(prompt).toContain("mcp__<server>__<tool>");
			expect(prompt).toContain(
				"- When reading a-coder-cli docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory",
			);
			expect(prompt).toContain("environment variables");
		});

		test("adds desktop guidance only on the desktop surface", () => {
			const desktop = buildSystemPrompt({
				surface: "desktop",
				selectedTools: ["read"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});
			const cli = buildSystemPrompt({
				surface: "cli",
				selectedTools: ["read"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(desktop).toContain("A-Coder Desktop session:");
			expect(desktop).toContain("app surfaces, not agent tools");
			expect(cli).not.toContain("A-Coder Desktop session:");
		});

		test("adds cross-tool guidance only for active systems", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [
					"read",
					"task_create",
					"spawn_subagent",
					"run_workflow",
					"team_create",
					"computer",
					"mcp_list_resources",
				],
				toolSnippets: {
					read: "Read file contents",
					task_create: "Maintain a persistent task graph",
					spawn_subagent: "Delegate a focused subtask",
					run_workflow: "Execute a saved workflow",
					team_create: "Start a team",
					computer: "Control the desktop",
					mcp_list_resources: "List MCP resources",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Use the task graph for work that needs three or more steps");
			expect(prompt).toContain("Create the whole plan in one task_create call");
			expect(prompt).toContain("Use subagents for context-heavy exploration");
			expect(prompt).toContain("Use run_workflow for saved multi-agent scripts");
			expect(prompt).toContain("Use Agent Teams when teammates need to message each other");
			expect(prompt).toContain("When a connected MCP tool fits the task");
			expect(prompt).toContain("For computer use, capture before acting");
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("prompt guidelines", () => {
		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("renders persistent memory sections when provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				contextFiles: [],
				memory: [
					{
						scope: "global",
						path: "/memory/MEMORY.md",
						content: "User prefers concise answers.",
					},
					{
						scope: "workspace",
						path: "/ws/MEMORY.md",
						content: "Project uses bun.",
					},
				],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("<persistent_memory>");
			expect(prompt).toContain('<memory scope="global" path="/memory/MEMORY.md">');
			expect(prompt).toContain("User prefers concise answers.");
			expect(prompt).toContain("Project uses bun.");
			expect(prompt).toContain("re-read the current contents via the memory tool");
		});

		test("omits the persistent memory section when empty", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				contextFiles: [],
				memory: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("<persistent_memory>");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});

	describe("skills", () => {
		test.each([
			{ name: "default prompt", customPrompt: undefined },
			{ name: "custom prompt", customPrompt: "Custom system prompt" },
		])("includes skills with only bash in the $name", ({ customPrompt }) => {
			const prompt = buildSystemPrompt({
				customPrompt,
				selectedTools: ["bash"],
				contextFiles: [],
				skills: [testSkill],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("<available_skills>");
			expect(prompt).toContain("<name>test-skill</name>");
			expect(prompt).toContain("Use bash to load a skill's file");
		});

		test("omits skills without read or bash", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["write"],
				contextFiles: [],
				skills: [testSkill],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("<available_skills>");
		});
	});
});

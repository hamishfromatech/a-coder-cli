import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { loadSkillsFromDir, normalizeAllowedTools, normalizeSkillPaths } from "../src/core/skills.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("skill frontmatter normalization (easy-agent stage 17 follow-ups)", () => {
	it("normalizeAllowedTools accepts CSV strings, arrays, and rejects junk", () => {
		expect(normalizeAllowedTools("Bash(git *), Read")).toEqual(["Bash(git *)", "Read"]);
		expect(normalizeAllowedTools(["Bash(npm test *)", " Edit "])).toEqual(["Bash(npm test *)", "Edit"]);
		expect(normalizeAllowedTools("")).toBeUndefined();
		expect(normalizeAllowedTools(undefined)).toBeUndefined();
		expect(normalizeAllowedTools([123, "Read"])).toEqual(["Read"]);
		expect(normalizeAllowedTools([42])).toBeUndefined();
	});

	it("normalizeSkillPaths shares the same shape", () => {
		expect(normalizeSkillPaths("src/**, docs/*.md")).toEqual(["src/**", "docs/*.md"]);
		expect(normalizeSkillPaths("")).toBeUndefined();
	});

	it("loads allowed-tools and paths frontmatter from SKILL.md", () => {
		const dir = join(tmpdir(), `pi-skills-fm-${Date.now()}`);
		mkdirSync(join(dir, "git-fix"), { recursive: true });
		writeFileSync(
			join(dir, "git-fix", "SKILL.md"),
			[
				"---",
				"name: git-fix",
				"description: Fix a failing git workflow",
				"allowed-tools: Bash(git commit *), Bash(git push *)",
				"---",
				"",
				"Fix the workflow.",
				"",
			].join("\n"),
		);
		mkdirSync(join(dir, "flaky"), { recursive: true });
		writeFileSync(
			join(dir, "flaky", "SKILL.md"),
			// Note: a glob starting with `*` must be YAML-quoted (naive `- **/*...`
			// parses as a YAML alias). Skills with unparseable frontmatter produce
			// a warning diagnostic and are skipped.
			[
				"---",
				"name: flaky-fix",
				"description: Fix flaky tests",
				"paths:",
				"  - tests/e2e/**",
				'  - "**/*.flaky.ts"',
				"---",
				"",
				"Fix the flake.",
				"",
			].join("\n"),
		);
		try {
			const { skills } = loadSkillsFromDir({ dir, source: "project" });
			const gitFix = skills.find((s) => s.name === "git-fix");
			expect(gitFix?.allowedTools).toEqual(["Bash(git commit *)", "Bash(git push *)"]);
			expect(gitFix?.paths).toBeUndefined();

			const flaky = skills.find((s) => s.name === "flaky-fix");
			expect(flaky).toBeDefined();
			expect(flaky?.paths).toEqual(["tests/e2e/**", "**/*.flaky.ts"]);
			expect(flaky?.allowedTools).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("conditional skills (paths frontmatter) session activation", () => {
	it("activates a conditional skill when a touched path matches; sticky afterwards", async () => {
		const tempDir = join(tmpdir(), `pi-skills-activation-${Date.now()}`);
		const agentDir = join(tempDir, "agent");
		mkdirSync(join(agentDir, "skills", "flaky-fix"), { recursive: true });
		mkdirSync(join(tempDir, "src"), { recursive: true });
		writeFileSync(
			join(agentDir, "skills", "flaky-fix", "SKILL.md"),
			[
				"---",
				"name: flaky-fix",
				"description: Fix flaky tests",
				"paths: test/e2e/**",
				"---",
				"",
				"Fix the flaky test.",
				"",
			].join("\n"),
		);

		const { Agent } = await import("@earendil-works/pi-agent-core");
		const { getModel } = await import("@earendil-works/pi-ai/compat");
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const { AuthStorage } = await import("../src/core/auth-storage.ts");
		const { ModelRegistry } = await import("../src/core/model-registry.ts");
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = ModelRegistry.create(authStorage, tempDir);
		const loaded = loadSkillsFromDir({ dir: join(agentDir, "skills"), source: "user" });
		const resourceLoader = {
			...createTestResourceLoader(),
			getSkills: () => ({ skills: loaded.skills, diagnostics: [] }),
		};
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory({}),
			cwd: tempDir,
			modelRegistry,
			resourceLoader,
		});

		try {
			// Before activation: the conditional skill is not listed.
			expect(session.systemPrompt).not.toContain("flaky-fix");

			// A read of a non-matching path does not activate it.
			expect(session._activateConditionalSkillsForPaths(["src/index.ts"])).toEqual([]);
			expect(session.systemPrompt).not.toContain("flaky-fix");

			// A matching path activates it (joins the visible listing) and is sticky.
			expect(session._activateConditionalSkillsForPaths(["test/e2e/flaky.spec.ts"])).toEqual(["flaky-fix"]);
			expect(session.systemPrompt).toContain("flaky-fix");

			// Repeating a match is a no-op (already active).
			expect(session._activateConditionalSkillsForPaths(["test/e2e/other.spec.ts"])).toEqual([]);
			expect(session.systemPrompt).toContain("flaky-fix");
		} finally {
			session.dispose();
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

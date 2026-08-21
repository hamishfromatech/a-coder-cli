import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AgentDefinition,
	clearAgents,
	EXPLORE_AGENT,
	findAgent,
	formatAgentsSystemReminder,
	GENERAL_PURPOSE_AGENT,
	getAllAgents,
	loadAgentsFromDir,
	resolveAgentTools,
	setAgents,
} from "../src/core/agents/index.ts";

const tmp = join(tmpdir(), `pi-agents-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

beforeEach(() => {
	mkdirSync(tmp, { recursive: true });
	clearAgents();
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	clearAgents();
});

describe("resolveAgentTools", () => {
	const available = ["read", "grep", "find", "bash", "write", "edit", "spawn_subagent"];

	it("wildcard keeps everything except the subagent tool and disallowed", () => {
		const r = resolveAgentTools({ tools: undefined, disallowedTools: ["write", "edit"] }, available);
		expect(r.hasWildcard).toBe(true);
		expect(r.resolvedToolNames).toEqual(["read", "grep", "find", "bash"]);
		expect(r.invalidTools).toEqual([]);
	});

	it("strips the subagent tool even when not disallowed (no recursion)", () => {
		const r = resolveAgentTools({ tools: undefined, disallowedTools: [] }, available);
		expect(r.resolvedToolNames).not.toContain("spawn_subagent");
	});

	it("allow-list intersects with the available pool in declaration order", () => {
		const r = resolveAgentTools({ tools: ["bash", "read", "nope"], disallowedTools: [] }, available);
		expect(r.hasWildcard).toBe(false);
		expect(r.resolvedToolNames).toEqual(["bash", "read"]);
		expect(r.invalidTools).toEqual(["nope"]);
	});

	it("disallowedTools applies even with an allow-list", () => {
		const r = resolveAgentTools({ tools: ["read", "write"], disallowedTools: ["write"] }, available);
		expect(r.resolvedToolNames).toEqual(["read"]);
	});
});

describe("registry", () => {
	it("setAgents overwrites by name (project > user > built-in)", () => {
		const builtInExplore = EXPLORE_AGENT;
		const projectExplore: AgentDefinition = {
			agentType: "Explore",
			whenToUse: "project override",
			source: "project",
			getSystemPrompt: () => "project",
		};
		setAgents([builtInExplore, projectExplore]);
		expect(findAgent("Explore")?.whenToUse).toBe("project override");
		expect(getAllAgents()).toHaveLength(1);
	});

	it("findAgent returns undefined for unknown", () => {
		setAgents([GENERAL_PURPOSE_AGENT]);
		expect(findAgent("nope")).toBeUndefined();
		expect(findAgent("general-purpose")?.agentType).toBe("general-purpose");
	});
});

describe("built-in agents", () => {
	it("Explore is read-only (disallows write/edit) and wildcard", () => {
		expect(EXPLORE_AGENT.disallowedTools).toContain("write");
		expect(EXPLORE_AGENT.disallowedTools).toContain("edit");
		expect(EXPLORE_AGENT.tools).toBeUndefined();
		expect(EXPLORE_AGENT.getSystemPrompt()).toContain("READ-ONLY MODE");
	});

	it("general-purpose is wildcard (no tools list)", () => {
		expect(GENERAL_PURPOSE_AGENT.tools).toBeUndefined();
	});
});

describe("loadAgentsFromDir", () => {
	it("parses frontmatter + body into an AgentDefinition", () => {
		const dir = join(tmp, "good");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "reviewer.md"),
			`---
name: "reviewer"
description: "Code review specialist."
tools: "read,grep"
disallowedTools: "write,edit"
model: "claude-haiku-4-5"
maxTurns: 8
---
You are a senior code reviewer.`,
		);
		const { agents, warnings } = loadAgentsFromDir(dir, "project");
		expect(warnings).toEqual([]);
		expect(agents).toHaveLength(1);
		const a = agents[0]!;
		expect(a.agentType).toBe("reviewer");
		expect(a.whenToUse).toBe("Code review specialist.");
		expect(a.tools).toEqual(["read", "grep"]);
		expect(a.disallowedTools).toEqual(["write", "edit"]);
		expect(a.model).toBe("claude-haiku-4-5");
		expect(a.maxTurns).toBe(8);
		expect(a.source).toBe("project");
		expect(a.getSystemPrompt()).toBe("You are a senior code reviewer.");
	});

	it("skips files missing required fields and warns", () => {
		const dir = join(tmp, "bad");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "noname.md"), `---\ndescription: "no name"\n---\nbody`);
		writeFileSync(join(dir, "nobody.md"), `---\nname: "x"\ndescription: "y"\n---\n`);
		writeFileSync(join(dir, "ok.md"), `---\nname: "ok"\ndescription: "ok"\n---\nbody`);
		const { agents, warnings } = loadAgentsFromDir(dir, "user");
		expect(agents.map((a) => a.agentType)).toEqual(["ok"]);
		expect(warnings.length).toBeGreaterThanOrEqual(2);
	});

	it("returns empty with no warnings when the directory does not exist", () => {
		const { agents, warnings } = loadAgentsFromDir(join(tmp, "missing"), "user");
		expect(agents).toEqual([]);
		expect(warnings).toEqual([]);
	});
});

describe("formatAgentsSystemReminder", () => {
	it("returns empty string when there are no agents", () => {
		expect(formatAgentsSystemReminder([])).toBe("");
	});

	it("lists agents and includes the creation guidance", () => {
		const text = formatAgentsSystemReminder([GENERAL_PURPOSE_AGENT, EXPLORE_AGENT]);
		expect(text).toContain("<system-reminder>");
		expect(text).toContain("general-purpose [built-in]");
		expect(text).toContain("Explore [built-in]");
		expect(text).toContain("spawn_subagent");
		expect(text).toContain("Defining a new sub-agent");
		expect(text).toContain("</system-reminder>");
	});
});

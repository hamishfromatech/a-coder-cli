import { describe, expect, it } from "vitest";
import { loadAgentsFromDir } from "../src/core/agents/loadAgents.ts";

describe("shipped example agents", () => {
	it("all example .md files parse as valid agent definitions", () => {
		const { agents, warnings } = loadAgentsFromDir(join(process.cwd(), "examples/agents"), "project");
		expect(warnings).toEqual([]);
		expect(agents.map((a) => a.agentType).sort()).toEqual(["Explore", "pr-reviewer", "test-loop"]);
		for (const a of agents) {
			expect(a.whenToUse.length).toBeGreaterThan(10);
		}
	});
});

import { join } from "path";

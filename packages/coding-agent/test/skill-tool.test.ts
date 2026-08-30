import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import type { Skill } from "../src/core/skills.ts";

const emptyCtx = {} as ExtensionContext;

import { createSkillToolDefinition, prepareSkillBody } from "../src/core/tools/skill.ts";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
	return {
		name: "test-skill",
		description: "A test skill",
		filePath: "/tmp/skills/test-skill/SKILL.md",
		baseDir: "/tmp/skills/test-skill",
		sourceInfo: { path: "/tmp/skills/test-skill/SKILL.md" } as Skill["sourceInfo"],
		disableModelInvocation: false,
		...overrides,
	};
}

const SKILL_BODY = `---
name: test-skill
description: A test skill
---

Run the build with $ARGUMENTS. Assets live in \${SKILL_DIR}/assets. Session: \${SESSION_ID}.
`;

describe("prepareSkillBody", () => {
	it("substitutes $ARGUMENTS, SKILL_DIR and SESSION_ID", () => {
		const skill = makeSkill();
		const body = prepareSkillBody(skill, SKILL_BODY, "debug fast", "sess-42");
		expect(body).not.toContain("$ARGUMENTS");
		expect(body).toContain("Run the build with debug fast.");
		expect(body).toContain("/tmp/skills/test-skill/assets");
		expect(body).toContain("Session: sess-42.");
	});

	it("substitutes empty string when args are omitted", () => {
		const body = prepareSkillBody(makeSkill(), "Args: [$ARGUMENTS]", undefined, undefined);
		expect(body).toContain("Args: []");
	});

	it("strips frontmatter", () => {
		const body = prepareSkillBody(makeSkill(), SKILL_BODY, "", undefined);
		expect(body).not.toContain("description: A test skill");
	});
});

describe("skill tool", () => {
	it("returns the substituted body wrapped in a skill block", async () => {
		// The in-memory skill doesn't exist on disk; write a real temp file.

		const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const dir = mkdtempSync(join(tmpdir(), "skill-tool-"));
		try {
			const filePath = join(dir, "SKILL.md");
			writeFileSync(filePath, SKILL_BODY);
			const skill = makeSkill({ filePath, baseDir: dir });
			const toolWithFs = createSkillToolDefinition({
				getSkills: () => [skill],
				getSessionId: () => "sess-42",
			});
			const result = await toolWithFs.execute(
				"id",
				{ skill: "test-skill", args: "debug fast" },
				undefined,
				undefined,
				emptyCtx,
			);
			const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
			expect(text).toContain('<skill name="test-skill"');
			expect(text).toContain(`References are relative to ${dir}`);
			expect(text).toContain("Run the build with debug fast.");
			expect(text).toContain("Assets live in");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects unknown skills with the available names", async () => {
		const tool = createSkillToolDefinition({ getSkills: () => [makeSkill({ name: "known" })] });
		await expect(tool.execute("id", { skill: "nope" }, undefined, undefined, emptyCtx)).rejects.toThrow(
			/Available skills: known/,
		);
	});

	it("rejects disabling-model-invocation skills", async () => {
		const tool = createSkillToolDefinition({
			getSkills: () => [makeSkill({ disableModelInvocation: true })],
		});
		await expect(tool.execute("id", { skill: "test-skill" }, undefined, undefined, emptyCtx)).rejects.toThrow(
			/disable-model-invocation/,
		);
	});
});

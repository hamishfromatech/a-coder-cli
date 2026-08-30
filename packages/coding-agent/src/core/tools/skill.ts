/**
 * Skill invocation tool — progressive disclosure for the skills system.
 *
 * The system prompt lists skills as name + description only; this tool loads
 * the full skill instructions on demand (with $ARGUMENTS / ${SKILL_DIR} /
 * ${SESSION_ID} substitution), so skill bodies do not have to be pre-read
 * from disk by the model via the read tool.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { readFileSync } from "fs";
import { type Static, Type } from "typebox";
import { stripFrontmatter } from "../../utils/frontmatter.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { Skill } from "../skills.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const skillSchema = Type.Object({
	skill: Type.String({
		description: "Name of the skill to load (from the available_skills list in the system prompt).",
	}),
	args: Type.Optional(
		Type.String({
			description: 'Optional arguments forwarded to the skill (substituted for "$ARGUMENTS" in its instructions).',
		}),
	),
});

export type SkillToolInput = Static<typeof skillSchema>;

export interface SkillToolOptions {
	/** Returns the currently loaded skills (session-scoped). */
	getSkills: () => Skill[];
	/** Session id, substituted for `${SESSION_ID}` in the skill body. */
	getSessionId?: () => string;
	/**
	 * Grant session-scoped permission allow rules (easy-agent `allowed-tools`
	 * frontmatter): called when a skill with `allowed-tools` is invoked, before
	 * its instructions are returned.
	 */
	addSessionAllowRules?: (rules: string[]) => void;
}

/**
 * Strip frontmatter and substitute invocation variables into a skill body.
 * Supported tokens: $ARGUMENTS, ${SKILL_DIR} (+ legacy ${CLAUDE_SKILL_DIR}),
 * ${SESSION_ID} (+ legacy ${CLAUDE_SESSION_ID}). Exported for tests.
 */
export function prepareSkillBody(
	skill: Skill,
	rawContent: string,
	argsText: string | undefined,
	sessionId: string | undefined,
): string {
	let body = stripFrontmatter(rawContent).trim();
	// Tokens built via concatenation so lint does not see template placeholders.
	const token = (name: string): string => `\${${name}}`;
	const substitutions: Array<[string, string]> = [
		["$ARGUMENTS", argsText ?? ""],
		[token("SKILL_DIR"), skill.baseDir],
		[token("CLAUDE_SKILL_DIR"), skill.baseDir],
		[token("SESSION_ID"), sessionId ?? ""],
		[token("CLAUDE_SESSION_ID"), sessionId ?? ""],
	];
	for (const [token, value] of substitutions) {
		body = body.split(token).join(value);
	}
	return body;
}

export function createSkillToolDefinition(options: SkillToolOptions): ToolDefinition<typeof skillSchema> {
	const { getSkills } = options;
	return {
		name: "skill",
		label: "skill",
		description:
			"Load a skill's full instructions by name. Use when the task matches a skill from the available_skills list: pass its name and, when the user gave details, an args string. The returned instructions replace the need to read the skill file directly.",
		parameters: skillSchema,
		promptGuidelines: [
			"Prefer the skill tool over reading SKILL.md files: it resolves the skill by name and substitutes $ARGUMENTS correctly.",
		],
		async execute(_toolCallId, params: SkillToolInput) {
			const skills = getSkills();
			const skill = skills.find((s) => s.name === params.skill);
			if (!skill) {
				const available = skills
					.filter((s) => !s.disableModelInvocation)
					.map((s) => s.name)
					.join(", ");
				throw new Error(
					`Skill "${params.skill}" not found. Available skills: ${available || "(none loaded)"}. If it is listed in the system prompt, use the exact name.`,
				);
			}
			if (skill.disableModelInvocation) {
				throw new Error(
					`Skill "${skill.name}" cannot be invoked by the model (disable-model-invocation is set). The user can run it explicitly via /skill:${skill.name}.`,
				);
			}
			// easy-agent parity: pre-approve the skill's `allowed-tools` for this
			// session before the model follows its instructions.
			if (skill.allowedTools?.length && options.addSessionAllowRules) {
				options.addSessionAllowRules(skill.allowedTools);
			}
			let raw: string;
			try {
				raw = readFileSync(skill.filePath, "utf-8");
			} catch (err) {
				throw new Error(
					`Failed to read skill "${skill.name}" at ${skill.filePath}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			const body = prepareSkillBody(skill, raw, params.args ?? "", options.getSessionId?.() ?? "");
			const text = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
			return {
				content: [{ type: "text", text }],
				details: { skill: skill.name },
			};
		},
	};
}

/** AgentTool flavor for the core runtime (createAllTools / createCodingTools). */
export function createSkillTool(options: SkillToolOptions): AgentTool<any> {
	return wrapToolDefinition(createSkillToolDefinition(options));
}

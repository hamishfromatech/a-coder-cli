/**
 * SOP (Standard Operating Procedure) support for skills.
 *
 * Ports the Strands agent-sop conventions into a-coder-cli's skill system. An
 * SOP is a `.sop.md` skill file — a parameterized, constraint-based workflow
 * the agent executes step by step (see docs/sops.md):
 *
 *     # Title
 *     ## Overview
 *     ## Parameters
 *     - **task_description** (required): What to do
 *     ## Steps
 *     ### 1. Setup
 *     **Constraints:**
 *     - You MUST ...
 *
 * SOPs are ordinary Agent Skills: same discovery, same frontmatter, same
 * /skill:<name> invocation. This module only adds structural validation so a
 * malformed SOP surfaces through the same resource-diagnostics channel as
 * other skill warnings. Validation is intentionally lenient — warnings, never
 * load failure.
 */

import { parseFrontmatter } from "../utils/frontmatter.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";

/** File suffix that marks a skill file as an SOP. */
export const SOP_FILE_SUFFIX = ".sop.md";

/** A parameter declared in an SOP's `## Parameters` section. */
export interface SopParameter {
	name: string;
	required: boolean;
	default?: string;
	description?: string;
}

/** Optional machine-readable `parameters` frontmatter entry. */
export interface SopFrontmatterParameter {
	name?: unknown;
	required?: unknown;
	default?: unknown;
	description?: unknown;
}

const PARAM_LINE_RE = /^\s*[-*]\s+\*\*([A-Za-z0-9_-]+)\*\*\s*\(([^)]*)\)\s*:?\s*(.*)$/;
const DEFAULT_IN_STATUS_RE = /(?:^|,)\s*default:\s*"([^"]*)"/;
const SECTION_RE = /^##\s+(.+?)\s*$/gm;
const NEGATIVE_RFC2119_RE = /\b(?:MUST NOT|SHOULD NOT|MAY NOT|REQUIRED NOT|SHALL NOT)\b[.:]?\s*$/;
const RFC2119_RE = /\b(MUST(?: NOT)?|SHOULD(?: NOT)?|MAY(?: NOT)?|REQUIRED|SHALL(?: NOT)?|OPTIONAL)\b/;

/** Extract the markdown body of a `## <title>` section, or undefined. */
export function extractSection(content: string, title: string): string | undefined {
	const re = new RegExp(`^##\\s+${title}\\s*$`, "gim");
	const match = re.exec(content);
	if (!match) return undefined;
	const rest = content.slice(match.index + match[0].length);
	const next = rest.search(/^##\s+/m);
	return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Parse an SOP's `## Parameters` bullet list.
 *
 * Expected per-line format (spec):
 *   - **name** (required|optional[, default: "value"]): description
 * Returns the parsed parameters; also returns entries for lines that fail to
 * parse so callers can warn about them (required=false, no description).
 */
export function parseSopParameters(content: string): SopParameter[] {
	const section = extractSection(content, "Parameters");
	if (section === undefined) return [];
	const params: SopParameter[] = [];
	for (const line of section.split(/\r?\n/)) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const match = PARAM_LINE_RE.exec(line);
		if (!match) continue;
		const [, name, status, description] = match;
		const required = /\brequired\b/i.test(status ?? "");
		const optional = /\boptional\b/i.test(status ?? "");
		const defaultMatch = DEFAULT_IN_STATUS_RE.exec(status ?? "");
		params.push({
			name: name ?? "",
			required: required && !optional,
			...(defaultMatch ? { default: defaultMatch[1] } : {}),
			...(description?.trim() ? { description: description.trim() } : {}),
		});
	}
	return params;
}

/** Section titles present in the markdown (for validation). */
function sectionTitles(content: string): string[] {
	const titles: string[] = [];
	SECTION_RE.lastIndex = 0;
	for (const line of content.split(/\r?\n/)) {
		const match = /^##\s+(.+?)\s*$/.exec(line);
		if (match?.[1]) titles.push(match[1]);
	}
	return titles;
}
/** Read optional machine-readable `parameters` frontmatter (lenient). */
export function parseSopFrontmatterParameters(rawContent: string): SopParameter[] {
	const { frontmatter } = parseFrontmatter<Record<string, unknown>>(rawContent);
	const value = frontmatter.parameters;
	if (!Array.isArray(value)) return [];
	const params: SopParameter[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as SopFrontmatterParameter;
		if (typeof record.name !== "string" || !record.name) continue;
		const required = record.required === true;
		const def = typeof record.default === "string" ? record.default : undefined;
		const description = typeof record.description === "string" ? record.description : undefined;
		params.push({
			name: record.name,
			required,
			...(def !== undefined ? { default: def } : {}),
			...(description ? { description } : {}),
		});
	}
	return params;
}

/**
 * Validate SOP structure. Produces warnings only — an SOP that fails
 * validation still loads (and runs) as an ordinary skill.
 */
export function validateSop(rawContent: string, filePath: string): ResourceDiagnostic[] {
	const diagnostics: ResourceDiagnostic[] = [];
	const warn = (message: string) => diagnostics.push({ type: "warning", message, path: filePath });

	const titles = sectionTitles(rawContent).map((t) => t.toLowerCase());

	if (!titles.some((t) => t.toLowerCase() === "overview")) {
		warn("SOP is missing a '## Overview' section (used as the description when sharing the SOP)");
	}

	const params = parseSopParameters(rawContent);
	if (!titles.some((t) => t.toLowerCase() === "parameters")) {
		warn("SOP is missing a '## Parameters' section (declare inputs even when empty)");
	} else if (params.length === 0) {
		warn(
			"SOP '## Parameters' section has no recognizable parameter bullets; expected '- **name** (required|optional): description'",
		);
	}

	for (const param of params) {
		if (!/^[a-z][a-z0-9_-]*$/.test(param.name)) {
			warn(`parameter "${param.name}" should use lowercase letters, digits, underscores or hyphens`);
		}
	}

	const stepsSection = extractSection(rawContent, "Steps");
	if (stepsSection === undefined) {
		warn("SOP is missing a '## Steps' section");
	} else if (!/^#{3,}\s+\d+/m.test(stepsSection)) {
		warn("SOP '## Steps' section has no numbered step headings ('### 1. Step Name')");
	}

	const hasConstraints = rawContent
		.split(/\r?\n/)
		.some((line) => /^\s*\*{0,2}Constraints:?\*{0,2}\s*$/i.test(line.trim()));
	if (!hasConstraints) {
		warn("SOP has no '**Constraints:**' blocks; steps SHOULD carry RFC 2119 constraints (MUST/SHOULD/MAY)");
	} else if (!RFC2119_RE.test(rawContent.replace(/#{1,3}\s/g, ""))) {
		// Heading digits are stripped so step numbers never satisfy the check.
		warn("SOP constraint blocks use no RFC 2119 keywords (MUST/SHOULD/MAY)");
	}

	for (const line of rawContent.split(/\r?\n/)) {
		if (NEGATIVE_RFC2119_RE.test(line.trim())) {
			warn(`negative constraint lacks context: "${line.trim()}" — state what to do instead or why`);
		}
	}

	const frontmatterParams = parseSopFrontmatterParameters(rawContent);
	if (frontmatterParams.length > 0) {
		const markdownNames = new Set(params.map((p) => p.name));
		for (const fp of frontmatterParams) {
			if (!markdownNames.has(fp.name)) {
				warn(`frontmatter parameter "${fp.name}" is not declared in the '## Parameters' section`);
			}
		}
	}

	return diagnostics;
}

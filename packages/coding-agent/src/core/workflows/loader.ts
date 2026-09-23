/**
 * Workflow script discovery and loading.
 *
 * A workflow is a plain JavaScript file with `export const meta = { name,
 * description }` followed by a top-level-await body that orchestrates
 * subagents through the runtime primitives (see runtime.ts). Scripts live in
 * the same shape as Claude Code's saved workflows, adapted to our config
 * layout:
 *   project: `<cwd>/.a-coder-cli/workflows/*.js`  (shared with the repo; wins collisions)
 *   user:    `<agentDir>/workflows/*.js`           (personal, every project)
 *
 * Loading is strict about the static contract — a script that uses import(),
 * require, or a broken/missing meta block would fail mid-run or register a
 * broken command, so those surface as load diagnostics instead.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { CONFIG_DIR_NAME } from "../../config.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { staticScriptViolations } from "./runtime.ts";
import type { WorkflowSource, WorkflowSpec } from "./types.ts";

const WORKFLOW_FILE_SUFFIX = ".js";

interface WorkflowMeta {
	name: string;
	description: string;
	phases?: string[];
}

/**
 * Extract and evaluate the `export const meta = {...}` block. The literal must
 * evaluate to a plain object with a kebab-case `name`; anything else (missing,
 * non-literal, malformed) fails the file with a diagnostic.
 */
export function extractWorkflowMeta(source: string): { meta?: WorkflowMeta; error?: string } {
	const marker = /(?:^|\n)\s*export\s+const\s+meta\s*=\s*/.exec(source);
	if (!marker) return { error: "workflow scripts must start with `export const meta = { name, description }`" };

	const literal = matchBracedLiteral(source, marker.index + marker[0].length);
	if (!literal) return { error: "meta block is not a plain object literal" };

	try {
		const value = new Function(`return (${literal})`)() as unknown;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return { error: "meta must be a plain object literal" };
		}
		const record = value as Record<string, unknown>;
		const name = typeof record.name === "string" ? record.name : undefined;
		if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) {
			return { error: "meta.name must be a lowercase kebab-case string" };
		}
		const description = typeof record.description === "string" ? record.description : "";

		let phases: string[] | undefined;
		if (record.phases !== undefined) {
			if (!Array.isArray(record.phases) || record.phases.some((p) => typeof p !== "string" || p.length === 0)) {
				return { error: "meta.phases must be an array of non-empty strings" };
			}
			phases = [...new Set(record.phases as string[])];
		}

		return { meta: { name, description, ...(phases !== undefined ? { phases } : {}) } };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `meta block must be a plain literal: ${message}` };
	}
}

/**
 * Match a `{...}` literal starting at `start`, tracking strings, template
 * literals, comments, and escapes. Returns the literal including braces, or
 * undefined when unbalanced (non-literal meta blocks fail evaluation instead).
 */
function matchBracedLiteral(source: string, start: number): string | undefined {
	if (source[start] !== "{") return undefined;
	let depth = 0;
	let inString: string | undefined;
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (inString) {
			if (char === "\\" && inString !== "`") {
				i++; // skip escaped character
				continue;
			}
			if (inString === "`" && char === "$" && source[i + 1] === "{") {
				// template expression: skip to its closing brace, tracking strings inside
				const end = skipTemplateExpression(source, i + 2);
				if (end === undefined) return undefined;
				i = end;
				continue;
			}
			if (char === inString) inString = undefined;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			inString = char;
			continue;
		}
		if (char === "/" && source[i + 1] === "/") {
			const newline = source.indexOf("\n", i);
			if (newline === -1) return undefined;
			i = newline;
			continue;
		}
		if (char === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			if (end === -1) return undefined;
			i = end + 1;
			continue;
		}
		if (char === "{") depth++;
		if (char === "}") {
			depth--;
			if (depth === 0) return source.slice(start, i + 1);
		}
	}
	return undefined;
}

/** Skip a `${...}` expression inside a template literal; returns the `}` index. */
function skipTemplateExpression(source: string, start: number): number | undefined {
	let depth = 1;
	let inString: string | undefined;
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (inString) {
			if (char === "\\") {
				i++;
				continue;
			}
			if (char === inString) inString = undefined;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			inString = char;
			continue;
		}
		if (char === "{") depth++;
		if (char === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return undefined;
}

/** Parse + validate one workflow script into a WorkflowSpec. */
export function parseWorkflowSpec(
	content: string,
	filePath: string,
	source: WorkflowSource,
	diagnostics: ResourceDiagnostic[],
): WorkflowSpec | null {
	const violations = staticScriptViolations(content);
	if (violations.length > 0) {
		diagnostics.push({ type: "warning", message: `${violations[0]} (${filePath})`, path: filePath });
		return null;
	}

	const extracted = extractWorkflowMeta(content);
	if (!extracted.meta) {
		diagnostics.push({
			type: "warning",
			message: `${extracted.error ?? "invalid meta block"} (${filePath})`,
			path: filePath,
		});
		return null;
	}

	return {
		name: extracted.meta.name,
		description: extracted.meta.description,
		...(extracted.meta.phases !== undefined ? { phases: extracted.meta.phases } : {}),
		filePath,
		source,
		content,
	};
}

/**
 * Discover workflow scripts from the project and user directories, plus any
 * extra files (package-provided workflows) given as absolute paths. Standard
 * dirs win name collisions over package files.
 */
export function loadWorkflows(options: { cwd: string; agentDir: string; extraFiles?: string[] }): {
	workflows: WorkflowSpec[];
	diagnostics: ResourceDiagnostic[];
} {
	const diagnostics: ResourceDiagnostic[] = [];
	const byName = new Map<string, WorkflowSpec>();

	const addFile = (filePath: string, source: WorkflowSource) => {
		try {
			const content = readFileSync(filePath, "utf-8");
			const spec = parseWorkflowSpec(content, filePath, source, diagnostics);
			if (!spec) return;
			const existing = byName.get(spec.name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `workflow "${spec.name}" collision`,
					path: filePath,
					collision: {
						resourceType: "extension",
						name: spec.name,
						winnerPath: existing.filePath,
						loserPath: filePath,
					},
				});
				// Project wins over user wins over package; on same-source
				// collisions first wins (sorted).
				if (existing.source === "project" || source !== "project") return;
				byName.delete(spec.name);
			}
			byName.set(spec.name, spec);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			diagnostics.push({ type: "warning", message, path: filePath });
		}
	};

	const scanDir = (dir: string, source: "project" | "user") => {
		if (!existsSync(dir)) return;
		let entries: string[];
		try {
			entries = readdirSync(dir)
				.filter((f) => f.endsWith(WORKFLOW_FILE_SUFFIX) && !f.endsWith(".test.js"))
				.sort();
		} catch {
			return;
		}
		for (const file of entries) {
			addFile(resolve(dir, file), source);
		}
	};

	scanDir(resolve(options.cwd, CONFIG_DIR_NAME, "workflows"), "project");
	scanDir(resolve(options.agentDir, "workflows"), "user");
	for (const file of (options.extraFiles ?? []).filter((f) => !f.endsWith(".test.js")).sort()) {
		addFile(file, "package");
	}

	return { workflows: Array.from(byName.values()), diagnostics };
}

/** Resolve a workflow by name or path from the standard directories. */
export function findWorkflow(
	nameOrPath: string,
	options: { cwd: string; agentDir: string },
): { workflow: WorkflowSpec | null; diagnostics: ResourceDiagnostic[] } {
	const { workflows, diagnostics } = loadWorkflows(options);
	const byName = workflows.find((w) => w.name === nameOrPath);
	if (byName) return { workflow: byName, diagnostics };
	const resolved = resolve(nameOrPath);
	const byPath = workflows.find((w) => w.filePath === resolved);
	if (byPath) return { workflow: byPath, diagnostics };
	return { workflow: null, diagnostics };
}

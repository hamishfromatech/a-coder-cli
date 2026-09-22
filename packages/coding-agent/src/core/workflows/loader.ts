/**
 * Workflow SOP discovery and loading.
 *
 * Workflows live in the same shape as Claude Code's saved workflows, adapted
 * to our config layout:
 *   project: `<cwd>/.a-coder-cli/workflows/*.sop.md`  (shared with the repo; wins collisions)
 *   user:    `<agentDir>/workflows/*.sop.md`           (personal, every project)
 *
 * A workflow file is an ordinary SOP (validated by sop.ts on skill load) whose
 * frontmatter adds a machine-readable `workflow.steps` array. Loading here is
 * strict about step wiring — a workflow whose references dangle would fail
 * mid-run, so those surface as load diagnostics instead.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { CONFIG_DIR_NAME } from "../../config.ts";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { WorkflowPredicate, WorkflowSpec, WorkflowStep } from "./types.ts";

const WORKFLOW_FILE_SUFFIX = ".sop.md";

function parsePredicate(value: unknown, diagnostics: ResourceDiagnostic[]): WorkflowPredicate | undefined {
	if (typeof value !== "object" || value === null) {
		diagnostics.push({ type: "warning", message: `workflow 'until' must be an object`, path: undefined });
		return undefined;
	}
	const p = value as WorkflowPredicate;
	if (p.equals === undefined && p.notEquals === undefined && p.exists === undefined) {
		diagnostics.push({
			type: "warning",
			message: `workflow 'until' predicate has no criterion (equals / notEquals / exists)`,
			path: undefined,
		});
		return undefined;
	}
	return p;
}

/** Parse + validate the `workflow.steps` frontmatter into a WorkflowSpec. */
export function parseWorkflowSpec(
	rawContent: string,
	filePath: string,
	source: "project" | "user",
	diagnostics: ResourceDiagnostic[],
): WorkflowSpec | null {
	const { frontmatter } = parseFrontmatter<Record<string, unknown>>(rawContent);
	const name = typeof frontmatter.name === "string" && frontmatter.name ? frontmatter.name : undefined;
	const description = typeof frontmatter.description === "string" ? frontmatter.description : "";

	const workflow = frontmatter.workflow;
	if (typeof workflow !== "object" || workflow === null) {
		diagnostics.push({
			type: "warning",
			message: "workflow file has no 'workflow:' frontmatter block",
			path: filePath,
		});
		return null;
	}
	const steps = (workflow as Record<string, unknown>).steps;
	if (!Array.isArray(steps) || steps.length === 0) {
		diagnostics.push({ type: "warning", message: "workflow.steps is empty or missing", path: filePath });
		return null;
	}

	const parsed: WorkflowStep[] = [];
	const ids = new Set<string>();
	let valid = true;

	for (const [index, raw] of steps.entries()) {
		if (typeof raw !== "object" || raw === null) {
			diagnostics.push({ type: "warning", message: `workflow.steps[${index}] is not an object`, path: filePath });
			valid = false;
			continue;
		}
		const step = raw as Record<string, unknown>;
		const id = typeof step.id === "string" ? step.id : undefined;
		const type = step.type;
		const prompt = typeof step.prompt === "string" ? step.prompt : undefined;

		if (!id || !/^[a-z][a-z0-9_-]*$/.test(id)) {
			diagnostics.push({
				type: "warning",
				message: `workflow.steps[${index}].id must be a lowercase kebab-case string`,
				path: filePath,
			});
			valid = false;
			continue;
		}
		if (ids.has(id)) {
			diagnostics.push({ type: "warning", message: `duplicate workflow step id "${id}"`, path: filePath });
			valid = false;
			continue;
		}
		if (type !== "run" && type !== "fan-out") {
			diagnostics.push({
				type: "warning",
				message: `workflow step "${id}" has unknown type "${String(type)}" (expected "run" or "fan-out")`,
				path: filePath,
			});
			valid = false;
			continue;
		}
		if (!prompt) {
			diagnostics.push({ type: "warning", message: `workflow step "${id}" has no prompt`, path: filePath });
			valid = false;
			continue;
		}

		let over: string | undefined;
		if (type === "fan-out") {
			over = typeof step.over === "string" ? step.over : undefined;
			if (!over) {
				diagnostics.push({ type: "warning", message: `fan-out step "${id}" is missing 'over'`, path: filePath });
				valid = false;
				continue;
			}
			const overStep = over.split(".")[0];
			if (!ids.has(over) && !parsed.some((p) => p.id === overStep)) {
				diagnostics.push({
					type: "warning",
					message: `fan-out step "${id}" references "${over}", which is not a previous step`,
					path: filePath,
				});
				valid = false;
				continue;
			}
		}

		let until: WorkflowPredicate | undefined;
		if (step.until !== undefined) {
			const parsedPredicate = parsePredicate(step.until, diagnostics);
			if (!parsedPredicate) {
				valid = false;
			} else {
				until = parsedPredicate;
			}
		}

		ids.add(id);
		parsed.push({
			id,
			type,
			prompt,
			...(over !== undefined ? { over } : {}),
			...(typeof step.label === "string" ? { label: step.label } : {}),
			...(typeof step.model === "string" ? { model: step.model } : {}),
			...(typeof step.agent_type === "string" ? { agent_type: step.agent_type } : {}),
			...(step.schema && typeof step.schema === "object" ? { schema: step.schema as Record<string, unknown> } : {}),
			...(until !== undefined ? { until } : {}),
			...(typeof step.max_rounds === "number" && step.max_rounds > 0
				? { max_rounds: Math.floor(step.max_rounds) }
				: {}),
			...(typeof step.stop_on_no_progress === "number" && step.stop_on_no_progress > 0
				? { stop_on_no_progress: Math.floor(step.stop_on_no_progress) }
				: {}),
		});
	}

	if (!valid || parsed.length === 0) return null;

	return {
		name:
			name ??
			filePath
				.replace(/\\/g, "/")
				.split("/")
				.pop()!
				.replace(/\.sop\.md$/, ""),
		description,
		filePath,
		source,
		steps: parsed,
	};
}

/** Discover workflow SOPs from the project and user directories. */
export function loadWorkflows(options: { cwd: string; agentDir: string }): {
	workflows: WorkflowSpec[];
	diagnostics: ResourceDiagnostic[];
} {
	const diagnostics: ResourceDiagnostic[] = [];
	const byName = new Map<string, WorkflowSpec>();

	const scan = (dir: string, source: "project" | "user") => {
		if (!existsSync(dir)) return;
		let entries: string[];
		try {
			entries = readdirSync(dir)
				.filter((f) => f.endsWith(WORKFLOW_FILE_SUFFIX))
				.sort();
		} catch {
			return;
		}
		for (const file of entries) {
			const filePath = resolve(dir, file);
			try {
				const raw = readFileSync(filePath, "utf-8");
				const spec = parseWorkflowSpec(raw, filePath, source, diagnostics);
				if (!spec) continue;
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
					// Project wins over user; on same-source collisions first wins (sorted).
					if (existing.source === "project" || source !== "project") continue;
					byName.delete(spec.name);
				}
				byName.set(spec.name, spec);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				diagnostics.push({ type: "warning", message, path: filePath });
			}
		}
	};

	scan(resolve(options.cwd, CONFIG_DIR_NAME, "workflows"), "project");
	scan(resolve(options.agentDir, "workflows"), "user");

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

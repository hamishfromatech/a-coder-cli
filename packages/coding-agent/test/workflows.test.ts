import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPredicate, interpolate, resolvePath } from "../src/core/workflows/data-flow.ts";
import { loadWorkflows, parseWorkflowSpec } from "../src/core/workflows/loader.ts";
import { type WorkflowAgentInvoker, WorkflowRunner, type WorkflowRunnerEvent } from "../src/core/workflows/runner.ts";
import {
	buildWorkflowAuthoringPrompt,
	listRunIds,
	loadRunState,
	matchesWorkflowTrigger,
	readRunState,
	stripWorkflowTrigger,
} from "../src/core/workflows/runs.ts";
import {
	extractJson,
	findSchemaContradictions,
	validateAgainstSchema,
} from "../src/core/workflows/structured-output.ts";
import type { WorkflowRunState, WorkflowSpec } from "../src/core/workflows/types.ts";

/** Build a template reference string without tripping noTemplateCurlyInString. */
const ref = (name: string): string => `\u0024{${name}}`;

describe("resolvePath", () => {
	it("resolves nested paths and array indices", () => {
		const value = { files: ["a.ts", "b.ts"], meta: { count: 2 } };
		expect(resolvePath(value, "files.1")).toBe("b.ts");
		expect(resolvePath(value, "meta.count")).toBe(2);
		expect(resolvePath(value, "missing")).toBeUndefined();
	});
});

describe("interpolate", () => {
	it("interpolates step outputs, args, and fan-out items", () => {
		const out = interpolate(
			`Find files for ${ref("item")} from ${ref("discover.files")}`.replace("${ref(", "${").replace(")}", "}"),
			{
				steps: { discover: { files: ["src", "lib"] } },
				args: {},
			},
			{ item: "x.ts", missing: () => {} },
		);
		expect(out).toContain('"src"');
		expect(out).toContain("x.ts");
	});

	it("reports missing references instead of throwing", () => {
		const missing: string[] = [];
		const out = interpolate(
			`Hello ${ref("args.name")}`,
			{ steps: {}, args: undefined },
			{ missing: (r) => missing.push(r) },
		);
		expect(out).toBe("Hello ");
		expect(missing).toEqual(["args.name"]);
	});
});

describe("checkPredicate", () => {
	it("requires at least one criterion", () => {
		expect(checkPredicate({}, { pass: true })).toBe(false);
		expect(checkPredicate(undefined, { pass: true })).toBe(false);
	});

	it("evaluates path + equals / notEquals / exists", () => {
		expect(checkPredicate({ path: "pass", equals: true }, { pass: true })).toBe(true);
		expect(checkPredicate({ path: "pass", equals: true }, { pass: false })).toBe(false);
		expect(checkPredicate({ path: "pass", notEquals: true }, { pass: false })).toBe(true);
		expect(checkPredicate({ path: "done", exists: true }, { done: 0 })).toBe(true);
		expect(checkPredicate({ path: "done", exists: false }, {})).toBe(true);
	});
});

describe("structured output", () => {
	it("extracts JSON from prose and code fences", () => {
		expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(extractJson("prefix [1, 2, 3] suffix")).toEqual([1, 2, 3]);
		expect(extractJson("no json here")).toBeUndefined();
	});

	it("validates against the schema subset", () => {
		const schema = {
			type: "object",
			required: ["files"],
			additionalProperties: false,
			properties: { files: { type: "array", items: { type: "string" } } },
		};
		expect(validateAgainstSchema({ files: ["a"] }, schema)).toEqual([]);
		expect(validateAgainstSchema({ files: "a" }, schema).length).toBeGreaterThan(0);
		expect(validateAgainstSchema({ extra: true }, schema).length).toBeGreaterThan(0);
	});

	it("proves required-key / additionalProperties contradictions statically", () => {
		const schema = {
			type: "object",
			required: ["report"],
			additionalProperties: false,
			properties: {},
		};
		expect(findSchemaContradictions(schema)).toHaveLength(1);
		expect(
			findSchemaContradictions({ type: "object", required: ["a"], properties: { a: { type: "string" } } }),
		).toEqual([]);
	});
});

// ============================================================ loader

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "a-coder-workflows-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function writeWorkflow(name: string, frontmatter: string, source: "project" | "user"): string {
	const base = source === "project" ? join(dir, "proj", ".a-coder-cli", "workflows") : join(dir, "agent", "workflows");
	mkdirSync(base, { recursive: true });
	const filePath = join(base, name);
	writeFileSync(filePath, frontmatter, "utf-8");
	return filePath;
}

describe("loader", () => {
	const workflowFile = (stepsYaml: string) => `---
name: sweep
description: Sweep files for issues.
workflow:
  steps:
${stepsYaml}
---

# Sweep

## Overview

Fan out an audit across files and synthesize.

## Parameters

- **dir** (required): directory

## Steps

### 1. Discover

**Constraints:**
- You MUST list files as JSON
`;

	it("parses and loads workflow SOPs from the project directory", () => {
		writeWorkflow(
			"sweep.sop.md",
			workflowFile(`    - id: discover
      type: run
      prompt: "list"`),
			"project",
		);
		const { workflows } = loadWorkflows({ cwd: join(dir, "proj"), agentDir: join(dir, "agent") });
		expect(workflows.map((w) => w.name)).toEqual(["sweep"]);
		expect(workflows[0]?.source).toBe("project");
		expect(workflows[0]?.steps[0]?.id).toBe("discover");
	});

	it("project wins over user on name collision", () => {
		const steps = (id: string) => `    - id: ${id}
      type: run
      prompt: p`;
		writeWorkflow("sweep.sop.md", workflowFile(steps("from_project")), "project");
		writeWorkflow("sweep.sop.md", workflowFile(steps("from_user")), "user");
		const { workflows } = loadWorkflows({ cwd: join(dir, "proj"), agentDir: join(dir, "agent") });
		expect(workflows).toHaveLength(1);
		expect(workflows[0]?.steps[0]?.id).toBe("from_project");
	});

	it("flags missing workflow frontmatter at parse", () => {
		const diagnostics: { message: string }[] = [];
		parseWorkflowSpec(
			`---\nname: broken\n---\n# Broken\n\nworkflow broken`,
			join(dir, "broken.sop.md"),
			"user",
			diagnostics as never,
		);
		expect(diagnostics.map((d) => d.message).join("\n")).toContain("no 'workflow:' frontmatter");
	});
});

// ============================================================ runner

function makeSpec(steps: object[]): WorkflowSpec {
	return { name: "test", description: "", filePath: "/tmp/x.sop.md", source: "project", steps: steps as never };
}

describe("WorkflowRunner", () => {
	function run(steps: object[], invoker: WorkflowAgentInvoker, args?: Record<string, unknown>) {
		const events: WorkflowRunnerEvent[] = [];
		const runner = new WorkflowRunner(
			makeSpec(steps),
			{ invoker, maxConcurrent: 2, onEvent: (e) => events.push(e) },
			"run-1",
		);
		return runner.run(args).then((state) => ({ state, events }));
	}

	it("executes run steps in order and feeds outputs forward", async () => {
		const calls: string[] = [];
		const { state } = await run(
			[
				{ id: "discover", type: "run", prompt: "list", schema: { type: "object", properties: { files: {} } } },
				{ id: "sum", type: "run", prompt: `summarize ${ref("discover.files")}` },
			],
			async (request) => {
				calls.push(request.prompt);
				if (request.schema) return { ok: true, output: { files: ["a", "b"] } };
				return { ok: true, output: `done: ${request.prompt}` };
			},
		);
		expect(state.status).toBe("completed");
		expect(calls[0]).toBe("list");
		expect(calls[1]).toContain('"a"');
	});

	it("fans out one agent per item and preserves order", async () => {
		const outputs: string[] = [];
		const { state } = await run(
			[
				{
					id: "discover",
					type: "run",
					prompt: "list",
					schema: { type: "object", properties: { files: { type: "array" } } },
				},
				{ id: "audit", type: "fan-out", over: "discover.files", prompt: `audit ${ref("item")}` },
			],
			async (request) => {
				outputs.push(request.prompt);
				if (request.schema) return { ok: true, output: { files: ["x", "y", "z"] } };
				// Simulate a mid-fan failure for item "y".
				if (request.prompt.includes("y")) return { ok: false, error: "boom" };
				return { ok: true, output: `audited ${request.prompt.replace("audit ", "")}` };
			},
		);
		expect(state.agentCount).toBe(4);
		const auditRound = (state.steps.audit?.outputs.at(-1) ?? []) as unknown[];
		expect(auditRound[0]).toContain("audited");
		expect(auditRound[1]).toBeNull();
		expect(auditRound[2]).toContain("audited");
	});

	it("loops until the predicate holds", async () => {
		let round = 0;
		const { state } = await run(
			[
				{
					id: "fix",
					type: "run",
					prompt: "fix round",
					until: { path: "pass", equals: true },
					max_rounds: 5,
				},
			],
			async () => {
				round++;
				return { ok: true, output: { pass: round >= 3, round } };
			},
		);
		expect(state.steps.fix?.rounds).toBe(3);
		expect((state.steps.fix?.outputs.at(-1) as { pass: boolean }).pass).toBe(true);
	});

	it("stops a loop after stop_on_no_progress identical rounds", async () => {
		let round = 0;
		const { state } = await run(
			[
				{
					id: "search",
					type: "run",
					prompt: "search round",
					until: { path: "found", equals: true },
					max_rounds: 10,
					stop_on_no_progress: 2,
				},
			],
			async () => {
				round++;
				return { ok: true, output: { found: false, round: round <= 2 ? round : 9 } };
			},
		);
		// r1/r2 differ; r3==r4 identical → no-progress counter hits 2 at r4.
		expect(state.steps.search?.rounds).toBe(5);
	});

	it("reuses unchanged steps from a resumed run and reruns changed ones", async () => {
		const invoker: WorkflowAgentInvoker = async (request) =>
			request.schema ? { ok: true, output: { files: ["a"] } } : { ok: true, output: `out: ${request.prompt}` };
		const spec = makeSpec([
			{ id: "discover", type: "run", prompt: `list ${ref("args.dir")}`, schema: { type: "object", properties: {} } },
			{ id: "work", type: "run", prompt: `do ${ref("discover.files")}` },
		]);
		const first = await new WorkflowRunner(spec, { invoker, maxConcurrent: 2 }, "r1").run({ dir: "x" });
		// Resume with the same args: discover reused, only "work" runs.
		const resumeEvents: WorkflowRunnerEvent[] = [];
		await new WorkflowRunner(
			spec,
			{ invoker, maxConcurrent: 2, onEvent: (e) => resumeEvents.push(e) },
			"r2",
			first,
		).run({ dir: "x" });
		expect(resumeEvents.filter((e) => e.type === "step_start")).toHaveLength(0); // both steps reused
		// Fresh run with changed args: both steps run.
		const changedEvents: WorkflowRunnerEvent[] = [];
		await new WorkflowRunner(spec, { invoker, maxConcurrent: 2, onEvent: (e) => changedEvents.push(e) }, "r3").run({
			dir: "z",
		});
		expect(changedEvents.filter((e) => e.type === "step_start")).toHaveLength(2);
	});

	it("throws when fan-out source is missing or not an array", async () => {
		await expect(
			run([{ id: "audit", type: "fan-out", over: "ghost.items", prompt: "p" }], async () => ({
				ok: true,
				output: "",
			})),
		).rejects.toThrow(/unavailable/);
	});
});

// ============================================================ run state + trigger

describe("run state helpers", () => {
	it("round-trips a run state through loadRunState", () => {
		const state: WorkflowRunState = {
			id: "sweep-123",
			workflowName: "sweep",
			filePath: "/tmp/sweep.sop.md",
			status: "failed",
			startedAt: 1,
			updatedAt: 2,
			steps: { discover: { stepId: "discover", rounds: 1, outputs: [{ files: [] }] } },
			agentCount: 3,
			error: "step audit failed",
		};
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "sweep-123.json"), JSON.stringify(state), "utf-8");
		const loaded = loadRunState(dir, "sweep-123");
		expect("state" in loaded && loaded.state.workflowName).toBe("sweep");
		expect(readRunState(dir, "sweep-123")?.status).toBe("failed");
	});

	it("reports a missing or corrupt state as nothing to resume", () => {
		mkdirSync(dir, { recursive: true });
		const missing = loadRunState(dir, "ghost");
		expect("error" in missing && missing.error).toMatch(/nothing to resume/);

		writeFileSync(join(dir, "junk-1.json"), "{ not json", "utf-8");
		const corrupt = loadRunState(dir, "junk-1");
		expect("error" in corrupt && corrupt.error).toMatch(/unreadable/);

		writeFileSync(join(dir, "wrong-2.json"), JSON.stringify({ id: "other", workflowName: "x" }), "utf-8");
		const mismatched = loadRunState(dir, "wrong-2");
		expect("error" in mismatched && mismatched.error).toMatch(/not a valid/);
	});

	it("lists run ids newest first and tolerates a missing directory", () => {
		expect(listRunIds(join(dir, "absent"))).toEqual([]);
		expect(listRunIds(undefined)).toEqual([]);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "a-1.json"), "{}", "utf-8");
		writeFileSync(join(dir, "b-2.json"), "{}", "utf-8");
		writeFileSync(join(dir, "readme.txt"), "x", "utf-8");
		expect(listRunIds(dir)).toEqual(["b-2", "a-1"]);
	});
});

describe("authoring trigger", () => {
	it("matches the keyword as a standalone word, case-insensitively", () => {
		expect(matchesWorkflowTrigger("ultracode: audit the routes")).toBe(true);
		expect(matchesWorkflowTrigger("Use ULTRACODE to sweep the repo")).toBe(true);
		expect(matchesWorkflowTrigger("ultracodewrong")).toBe(false);
		expect(matchesWorkflowTrigger("no keyword here")).toBe(false);
	});

	it("strips the keyword and keeps the task", () => {
		expect(stripWorkflowTrigger("ultracode: audit the routes")).toBe("audit the routes");
		expect(stripWorkflowTrigger("use ultracode for the migration")).toBe("use for the migration");
		expect(stripWorkflowTrigger("ultracode")).toBeUndefined();
	});

	it("rewrites the prompt into authoring instructions with the task embedded", () => {
		const prompt = buildWorkflowAuthoringPrompt("audit every route handler");
		expect(prompt).toContain("run_workflow");
		expect(prompt).toContain(".a-coder-cli/workflows/");
		expect(prompt).toContain("Task: audit every route handler");
	});
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractWorkflowMeta, findWorkflow, loadWorkflows } from "../src/core/workflows/loader.ts";
import {
	buildAutoOrchestrationPrompt,
	buildWorkflowAuthoringPrompt,
	listRunIds,
	loadRunState,
	matchesWorkflowTrigger,
	readRunState,
	stripWorkflowTrigger,
} from "../src/core/workflows/runs.ts";
import { phaseSummaries, WorkflowRuntime } from "../src/core/workflows/runtime.ts";
import {
	extractJson,
	findSchemaContradictions,
	validateAgainstSchema,
} from "../src/core/workflows/structured-output.ts";
import type {
	WorkflowAgentInvocationResult,
	WorkflowAgentInvoker,
	WorkflowRunState,
} from "../src/core/workflows/types.ts";

// ============================================================ structured output

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

function writeWorkflow(name: string, content: string, source: "project" | "user"): string {
	const base = source === "project" ? join(dir, "proj", ".a-coder-cli", "workflows") : join(dir, "agent", "workflows");
	mkdirSync(base, { recursive: true });
	const filePath = join(base, name);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

const VALID_SCRIPT = [
	"export const meta = { name: 'audit-routes', description: 'Audit route handlers' }",
	"const found = await agent('list', { schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } } })",
	"return pipeline(found.files, (file) => agent('audit ' + file))",
].join("\n");

describe("workflow loader", () => {
	it("extracts a valid meta block", () => {
		const extracted = extractWorkflowMeta(VALID_SCRIPT);
		expect(extracted.meta).toEqual({ name: "audit-routes", description: "Audit route handlers" });
	});

	it("extracts, dedupes, and validates meta.phases", () => {
		const extracted = extractWorkflowMeta(
			"export const meta = { name: 'demo', description: '', phases: ['search', 'read', 'search'] }",
		);
		expect(extracted.meta?.phases).toEqual(["search", "read"]);
		expect(extractWorkflowMeta("export const meta = { name: 'd', phases: ['ok', 1] }").error).toContain(
			"meta.phases",
		);
		expect(extractWorkflowMeta("export const meta = { name: 'd', phases: 'search' }").error).toContain("meta.phases");
		// Absent phases stays absent (no empty array).
		expect(extractWorkflowMeta("export const meta = { name: 'd' }").meta?.phases).toBeUndefined();
	});

	it("rejects missing, non-literal, and badly named meta blocks", () => {
		expect(extractWorkflowMeta("const x = 1").error).toContain("export const meta");
		expect(extractWorkflowMeta("export const meta = { name: getName() }").error).toContain("plain literal");
		expect(extractWorkflowMeta("export const meta = { name: 'Bad Name' }").error).toContain("kebab-case");
		expect(extractWorkflowMeta("export const meta = [1]").error).toContain("plain object");
	});

	it("parses and loads workflow scripts from the project directory", () => {
		const filePath = writeWorkflow("audit-routes.js", VALID_SCRIPT, "project");
		const { workflows } = loadWorkflows({ cwd: join(dir, "proj"), agentDir: join(dir, "agent") });
		expect(workflows).toHaveLength(1);
		expect(workflows[0]?.name).toBe("audit-routes");
		expect(workflows[0]?.filePath).toBe(filePath);
		expect(workflows[0]?.content).toBe(VALID_SCRIPT);
	});

	it("resolves by name and by absolute path", () => {
		const filePath = writeWorkflow("audit-routes.js", VALID_SCRIPT, "project");
		const ctx = { cwd: join(dir, "proj"), agentDir: join(dir, "agent") };
		expect(findWorkflow("audit-routes", ctx).workflow?.name).toBe("audit-routes");
		expect(findWorkflow(filePath, ctx).workflow?.filePath).toBe(filePath);
		expect(findWorkflow("missing", ctx).workflow).toBeNull();
	});

	it("project wins over user on name collision", () => {
		writeWorkflow("audit-routes.js", VALID_SCRIPT, "user");
		const projectPath = writeWorkflow(
			"audit-routes.js",
			VALID_SCRIPT.replace("Audit route handlers", "Project override"),
			"project",
		);
		const { workflows, diagnostics } = loadWorkflows({ cwd: join(dir, "proj"), agentDir: join(dir, "agent") });
		expect(workflows).toHaveLength(1);
		expect(workflows[0]?.description).toBe("Project override");
		expect(workflows[0]?.filePath).toBe(projectPath);
		expect(diagnostics.some((d) => d.type === "collision")).toBe(true);
	});

	it("loads package files with lowest precedence", () => {
		const pkgDir = join(dir, "pkg", "workflows");
		mkdirSync(pkgDir, { recursive: true });
		const pkgFile = join(pkgDir, "audit-routes.js");
		writeFileSync(pkgFile, VALID_SCRIPT.replace("Audit route handlers", "Package copy"), "utf-8");

		// A project workflow with the same name wins over the package file.
		writeWorkflow("audit-routes.js", VALID_SCRIPT, "project");
		const withProject = loadWorkflows({
			cwd: join(dir, "proj"),
			agentDir: join(dir, "agent"),
			extraFiles: [pkgFile],
		});
		expect(withProject.workflows).toHaveLength(1);
		expect(withProject.workflows[0]?.source).toBe("project");
		expect(withProject.diagnostics.some((d) => d.type === "collision")).toBe(true);

		// Without a project workflow, the package file loads as "package".
		rmSync(join(dir, "proj", ".a-coder-cli", "workflows"), { recursive: true, force: true });
		const packageOnly = loadWorkflows({
			cwd: join(dir, "proj"),
			agentDir: join(dir, "agent"),
			extraFiles: [pkgFile],
		});
		expect(packageOnly.workflows).toHaveLength(1);
		expect(packageOnly.workflows[0]?.source).toBe("package");
		expect(packageOnly.workflows[0]?.description).toBe("Package copy");
	});

	it("rejects scripts with import()/require and files without meta", () => {
		const bad = writeWorkflow("bad.js", "import('fs').then(() => {})", "project");
		const noMeta = writeWorkflow("nometa.js", "return 1", "user");
		const { workflows, diagnostics } = loadWorkflows({ cwd: join(dir, "proj"), agentDir: join(dir, "agent") });
		expect(workflows).toHaveLength(0);
		expect(diagnostics.some((d) => d.path === bad && d.message.includes("import()"))).toBe(true);
		expect(diagnostics.some((d) => d.path === noMeta && d.message.includes("export const meta"))).toBe(true);
	});
});

// ============================================================ runtime

const ok = (output: unknown): WorkflowAgentInvocationResult => ({ ok: true, output });
const agentFailed = (error = "agent killed"): WorkflowAgentInvocationResult => ({
	ok: false,
	error,
	kind: "agent-failed",
});
const invalidOutput = (error = "schema validation failed"): WorkflowAgentInvocationResult => ({
	ok: false,
	error,
	kind: "invalid-output",
});

interface InvocationRecord {
	id: string;
	prompt: string;
	label: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeInvoker(
	behavior: (request: InvocationRecord) => WorkflowAgentInvocationResult | Promise<WorkflowAgentInvocationResult>,
) {
	const calls: InvocationRecord[] = [];
	const invoker: WorkflowAgentInvoker = async (request) => {
		calls.push({ id: request.id, prompt: request.prompt, label: request.label });
		return behavior(request);
	};
	return { invoker, calls };
}

function runScript(
	content: string,
	invoker: WorkflowAgentInvoker,
	opts?: {
		args?: unknown;
		resumeState?: WorkflowRunState;
		maxConcurrent?: number;
		persist?: (state: WorkflowRunState) => void;
		onEvent?: (event: { type: string; [key: string]: unknown }) => void;
	},
): Promise<WorkflowRunState> {
	const runtime = new WorkflowRuntime(
		{ name: "demo", content },
		{
			invoker,
			maxConcurrent: opts?.maxConcurrent ?? 4,
			...(opts?.persist ? { persist: opts.persist } : {}),
		},
		opts?.resumeState?.id ?? "demo-run",
		opts?.resumeState,
	);
	return runtime.run(opts?.args);
}

describe("WorkflowRuntime", () => {
	it("executes a script, feeds results forward, and returns the script value", async () => {
		const { invoker, calls } = makeInvoker((request) => {
			if (request.prompt === "list") return ok({ files: ["a.ts", "b.ts"] });
			return ok({ file: request.prompt.slice(6), finding: "missing auth" });
		});
		const state = await runScript(VALID_SCRIPT, invoker);
		expect(state.status).toBe("completed");
		expect(state.returnValue).toEqual([
			{ file: "a.ts", finding: "missing auth" },
			{ file: "b.ts", finding: "missing auth" },
		]);
		expect(calls).toHaveLength(3);
		expect(calls[0]?.id).toBe("demo-run-a0");
		expect(calls.map((c) => c.prompt)).toEqual(["list", "audit a.ts", "audit b.ts"]);
		expect(state.steps.main).toEqual({ stepId: "main", rounds: 3 });
	});

	it("passes args through to the script", async () => {
		const { invoker } = makeInvoker(() => agentFailed("no agents should run"));
		const state = await runScript("export const meta = {}\nreturn args", invoker, { args: { limit: 5 } });
		expect(state.returnValue).toEqual({ limit: 5 });
	});

	it("keeps failed agents as nulls in pipeline results and completes the run", async () => {
		const { invoker, calls } = makeInvoker((request) => {
			if (request.prompt === "audit b") return agentFailed("agent killed by user");
			return ok(`done: ${request.prompt}`);
		});
		const state = await runScript(
			"export const meta = {}\nreturn pipeline(['a', 'b', 'c'], (f) => agent('audit ' + f))",
			invoker,
		);
		expect(state.status).toBe("completed");
		expect(state.returnValue).toEqual(["done: audit a", null, "done: audit c"]);
		expect(calls).toHaveLength(3);
	});

	it("fails the run when a structured output never validates", async () => {
		const { invoker } = makeInvoker(() => invalidOutput("expected object, got string"));
		const state = await runScript(
			"export const meta = {}\nawait agent('x', { schema: { type: 'object' } })",
			invoker,
		);
		expect(state.status).toBe("failed");
		expect(state.error).toContain("failed schema validation");
	});

	it("caps concurrency across pipeline items", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const { invoker } = makeInvoker(async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 10));
			inFlight--;
			return ok("x");
		});
		const state = await runScript(
			"export const meta = {}\nconst items = [1, 2, 3, 4, 5, 6]\nreturn await pipeline(items, (i) => agent('job ' + i))",
			invoker,
			{ maxConcurrent: 2 },
		);
		expect(state.status).toBe("completed");
		expect(state.returnValue).toHaveLength(6);
		expect(maxInFlight).toBeLessThanOrEqual(2);
	});

	it("groups agents under phase() titles in state", async () => {
		const { invoker } = makeInvoker(() => ok("x"));
		const state = await runScript(
			[
				"export const meta = {}",
				"phase('discover')",
				"await agent('list')",
				"phase('verify')",
				"await agent('check one')",
				"await agent('check two')",
				"log('all done')",
				"return 'ok'",
			].join("\n"),
			invoker,
		);
		expect(state.phases).toEqual(["discover", "verify"]);
		expect(state.steps.discover).toEqual({ stepId: "discover", rounds: 1 });
		expect(state.steps.verify).toEqual({ stepId: "verify", rounds: 2 });
		expect(state.agents.map((a) => a.phase)).toEqual(["discover", "verify", "verify"]);
		expect(state.returnValue).toBe("ok");
	});

	it("runs parallel task sets", async () => {
		const { invoker, calls } = makeInvoker((request) => ok(`result: ${request.prompt}`));
		const state = await runScript("export const meta = {}\nreturn parallel([agent('a'), () => agent('b')])", invoker);
		expect(state.returnValue).toEqual(["result: a", "result: b"]);
		expect(calls).toHaveLength(2);
	});

	it.each([
		["Date.now()", "export const meta = {}\nreturn Date.now()"],
		["Math.random()", "export const meta = {}\nreturn Math.random()"],
		["new Date()", "export const meta = {}\nreturn new Date().getTime()"],
	])("rejects nondeterministic %s for replay safety", async (_name, body) => {
		const { invoker, calls } = makeInvoker(() => ok("x"));
		const state = await runScript(body, invoker);
		expect(state.status).toBe("failed");
		expect(state.error).toContain("disabled inside workflow scripts");
		expect(calls).toHaveLength(0);
	});

	it("fails before any agent spawns when the script uses import()", async () => {
		const { invoker, calls } = makeInvoker(() => ok("x"));
		const state = await runScript("export const meta = {}\nawait import('node:fs')", invoker);
		expect(state.status).toBe("failed");
		expect(state.error).toContain("import()");
		expect(calls).toHaveLength(0);
	});

	it("replays completed agents from a resumed run without spawning", async () => {
		const { invoker, calls } = makeInvoker(() => ok("x"));
		const first = await runScript(
			"export const meta = {}\nconst a = await agent('one')\nreturn await agent('two')",
			invoker,
		);
		expect(first.status).toBe("completed");
		expect(calls).toHaveLength(2);

		// Resume with an invoker that refuses to spawn: everything replays.
		const replay = makeInvoker(() => {
			throw new Error("no agents should spawn during replay");
		});
		const resumed = await runScript(
			"export const meta = {}\nconst a = await agent('one')\nreturn await agent('two')",
			replay.invoker,
			{ resumeState: first },
		);
		expect(resumed.status).toBe("completed");
		expect(resumed.agentCount).toBe(2);
		expect(replay.calls).toHaveLength(0);
		expect(resumed.returnValue).toBe("x");
	});

	it("replays unchanged prompts from cache and cascades reruns from the first change", async () => {
		const script = "export const meta = {}\nconst a = await agent('one')\nreturn await agent('two from ' + a)";
		const { invoker, calls } = makeInvoker((request) => ok(`result of ${request.prompt}`));
		const first = await runScript(script, invoker);
		expect(first.returnValue).toBe("result of two from result of one");
		expect(calls).toHaveLength(2);

		// Same script, new invoker: prompts are unchanged, so every agent
		// replays from cache and nothing spawns.
		const replay = makeInvoker(() => {
			throw new Error("no agents should spawn during replay");
		});
		const replayed = await runScript(script, replay.invoker, { resumeState: first });
		expect(replay.calls).toHaveLength(0);
		expect(replayed.returnValue).toBe("result of two from result of one");

		// Edited script: the first agent's prompt changes, it reruns and now
		// returns something different, so the second agent's prompt changes
		// and it reruns too.
		const rerun = makeInvoker((request) =>
			request.prompt === "one-v2" ? ok("CHANGED") : ok(`result of ${request.prompt}`),
		);
		const resumed = await runScript(
			"export const meta = {}\nconst a = await agent('one-v2')\nreturn await agent('two from ' + a)",
			rerun.invoker,
			{ resumeState: first },
		);
		expect(rerun.calls.map((c) => c.prompt)).toEqual(["one-v2", "two from CHANGED"]);
		expect(resumed.returnValue).toBe("result of two from CHANGED");
	});

	it("reruns when the script's first prompt is edited", async () => {
		const { invoker, calls } = makeInvoker(() => ok("x"));
		const first = await runScript(
			"export const meta = {}\nawait agent('original prompt')\nreturn await agent('second')",
			invoker,
		);
		expect(calls).toHaveLength(2);

		const rerun = makeInvoker(() => ok("fresh"));
		const resumed = await runScript(
			"export const meta = {}\nawait agent('edited prompt')\nreturn await agent('second')",
			rerun.invoker,
			{ resumeState: first },
		);
		// The first agent reruns; the second's prompt is unchanged but the log
		// was truncated, so it reruns too (matching upstream's cascade rule).
		expect(rerun.calls.map((c) => c.prompt)).toEqual(["edited prompt", "second"]);
		expect(resumed.returnValue).toBe("fresh");
	});

	it("pauses at agent spawn and resumes on demand", async () => {
		const { invoker, calls } = makeInvoker(() => ok("x"));
		const runtime = new WorkflowRuntime(
			{ name: "demo", content: "export const meta = {}\nawait agent('a')\nreturn await agent('b')" },
			{
				invoker,
				maxConcurrent: 2,
				onEvent: (event) => {
					if (event.type === "agent_start" && event.seq === 0) runtime.setPaused(true);
				},
			},
			"demo-run",
		);
		const runPromise = runtime.run(undefined);
		await vi.waitFor(() => expect(runtime.state.status).toBe("paused"));
		// The pause fired during agent 0's start event, before its subagent
		// spawned — nothing runs while paused.
		expect(calls).toHaveLength(0);

		runtime.setPaused(false);
		const state = await runPromise;
		expect(state.status).toBe("completed");
		expect(calls.map((c) => c.prompt)).toEqual(["a", "b"]);
	});

	it("reports abort via the aborted getter and stops waiting on pause", async () => {
		const controller = new AbortController();
		const runtime = new WorkflowRuntime(
			{ name: "demo", content: "export const meta = {}\nreturn await agent('a')" },
			{ invoker: makeInvoker(() => ok("x")).invoker, maxConcurrent: 1, signal: controller.signal },
			"demo-run",
		);
		runtime.setPaused(true);
		const waited = runtime.waitWhilePaused();
		controller.abort();
		await waited; // resolves despite being paused — abort breaks the wait
		expect(runtime.aborted).toBe(true);
	});

	it("holds same-signature fan-out siblings until the leader's response begins", async () => {
		const spawnLog: Array<{ prompt: string; at: number }> = [];
		const invoker: WorkflowAgentInvoker = async (request) => {
			spawnLog.push({ prompt: request.prompt, at: Date.now() });
			if (request.prompt === "leader") {
				// The leader streams for a moment, then its response begins.
				await sleep(60);
				request.onResponseBegin?.();
			} else {
				await sleep(20);
				request.onResponseBegin?.();
			}
			return ok(`done: ${request.prompt}`);
		};
		const runtime = new WorkflowRuntime(
			{
				name: "demo",
				content:
					"export const meta = {}\nconst r = await parallel([agent('leader'), agent('sib-1'), agent('sib-2')])\nreturn r",
			},
			{ invoker, maxConcurrent: 8, staggerMs: 5000 },
			"demo-run",
		);
		const state = await runtime.run(undefined);
		expect(state.status).toBe("completed");
		expect(spawnLog.map((s) => s.prompt)).toEqual(["leader", "sib-1", "sib-2"]);
		// Both siblings spawn after the leader's response began (60ms in), well
		// inside the 5s cap — i.e. the gate released them, not the timeout.
		const leaderAt = spawnLog[0]!.at;
		expect(spawnLog[1]!.at - leaderAt).toBeGreaterThanOrEqual(55);
		expect(spawnLog[2]!.at - leaderAt).toBeLessThan(1000);
	});

	it("releases held siblings after the stagger cap when the leader never begins", async () => {
		const invoker: WorkflowAgentInvoker = async (request) => {
			// Leader never signals a response begin and settles fast.
			if (request.prompt === "leader") return ok("done");
			return ok(`done: ${request.prompt}`);
		};
		const runtime = new WorkflowRuntime(
			{
				name: "demo",
				content: "export const meta = {}\nconst r = await parallel([agent('leader'), agent('sib')])\nreturn r",
			},
			{ invoker, maxConcurrent: 8, staggerMs: 80 },
			"demo-run",
		);
		const state = await runtime.run(undefined);
		expect(state.status).toBe("completed");
		expect(state.returnValue).toEqual(["done", "done: sib"]);
	});

	it("persists state after each agent completes", async () => {
		const snapshots: WorkflowRunState[] = [];
		const { invoker } = makeInvoker(() => ok("x"));
		await runScript("export const meta = {}\nawait agent('a')\nawait agent('b')", invoker, {
			persist: (state) => snapshots.push(structuredClone(state)),
		});
		// One per agent append + one per completion + one final.
		expect(snapshots.length).toBeGreaterThanOrEqual(5);
		const last = snapshots[snapshots.length - 1];
		expect(last?.agents.map((a) => a.status)).toEqual(["completed", "completed"]);
	});

	it("treats a crashed run's running entries as not completed on resume", async () => {
		const crashed = await runScript(
			"export const meta = {}\nawait agent('a')\nreturn await agent('b')",
			makeInvoker(() => ok("fresh")).invoker,
		);
		crashed.agents[1]!.status = "running"; // simulate a crash mid-run

		const rerun = makeInvoker(() => ok("rerun result"));
		const resumed = await runScript(
			"export const meta = {}\nawait agent('a')\nreturn await agent('b')",
			rerun.invoker,
			{ resumeState: crashed },
		);
		// Agent 0 replays from cache; agent 1 (running when the run died) reruns.
		expect(rerun.calls.map((c) => c.prompt)).toEqual(["b"]);
		expect(resumed.returnValue).toBe("rerun result");
	});

	it("pre-seeds meta-declared phases in run state before any phase() call", async () => {
		const { invoker } = makeInvoker(() => ok("x"));
		const runtime = new WorkflowRuntime(
			{
				name: "demo",
				content:
					"export const meta = { name: 'demo', phases: ['discover', 'verify'] }\nawait agent('a')\nreturn 'ok'",
				phases: ["discover", "verify"],
			},
			{ invoker, maxConcurrent: 2 },
			"demo-run",
		);
		// Declared phases are visible before the script runs.
		expect(runtime.state.phases).toEqual(["discover", "verify"]);
		const state = await runtime.run(undefined);
		expect(state.phases).toEqual(["discover", "verify"]);
		// Declared phases pre-seed the summaries (even before use); the first
		// agent runs under the implicit "main" bucket.
		expect(state.steps.discover).toEqual({ stepId: "discover", rounds: 0 });
		expect(state.steps.main?.rounds).toBe(1);
	});
});

// ============================================================ run state helpers

describe("run state helpers", () => {
	it("round-trips a run state through loadRunState", () => {
		const stateDir = join(dir, "session", "workflows");
		const state = makeState("demo-123");
		writeWorkflowFile(stateDir, `${state.id}.json`, JSON.stringify(state));
		const loaded = loadRunState(stateDir, state.id);
		expect("state" in loaded && loaded.state.id).toBe(state.id);
		expect(readRunState(stateDir, state.id)?.workflowName).toBe("demo");
	});

	it("reports a missing or corrupt state as nothing to resume", () => {
		const stateDir = join(dir, "session", "workflows");
		const ghost = loadRunState(stateDir, "ghost");
		expect(ghost).toEqual({ error: expect.stringContaining("nothing to resume") });
		writeWorkflowFile(stateDir, "corrupt.json", "{ not json");
		const corrupt = loadRunState(stateDir, "corrupt");
		expect(corrupt).toEqual({ error: expect.stringContaining("unreadable") });
		writeWorkflowFile(
			stateDir,
			"wrong.json",
			JSON.stringify({ id: "other", workflowName: "x", agents: [], scriptContent: "" }),
		);
		const wrong = loadRunState(stateDir, "wrong");
		expect(wrong).toEqual({ error: expect.stringContaining("not a valid workflow run state") });
	});

	it("lists run ids newest first and tolerates a missing directory", () => {
		const stateDir = join(dir, "session", "workflows");
		expect(listRunIds(stateDir)).toEqual([]);
		expect(listRunIds(undefined)).toEqual([]);
		for (const id of ["a", "b", "c"]) {
			writeWorkflowFile(stateDir, `${id}.json`, "{}");
		}
		expect(listRunIds(stateDir)).toEqual(["c", "b", "a"]);
	});
});

// ============================================================ authoring trigger

describe("authoring trigger", () => {
	it("matches the keyword as a standalone word, case-insensitively", () => {
		expect(matchesWorkflowTrigger("ultracode: audit the routes")).toBe(true);
		expect(matchesWorkflowTrigger("ULTRACODE audit the routes")).toBe(true);
		expect(matchesWorkflowTrigger("ultracodewrong")).toBe(false);
		expect(matchesWorkflowTrigger("just audit the routes")).toBe(false);
	});

	it("strips the keyword and keeps the task", () => {
		expect(stripWorkflowTrigger("ultracode: audit the routes")).toBe("audit the routes");
		expect(stripWorkflowTrigger("use ultracode for the migration")).toBe("use for the migration");
		expect(stripWorkflowTrigger("ultracode")).toBeUndefined();
	});

	it("rewrites the prompt into script-authoring instructions with the task embedded", () => {
		const prompt = buildWorkflowAuthoringPrompt("audit every route handler for missing auth");
		expect(prompt).toContain("audit every route handler for missing auth");
		expect(prompt).toContain("export const meta");
		expect(prompt).toContain("agent(");
		expect(prompt).toContain("pipeline(");
		expect(prompt).toContain("parallel(");
		expect(prompt).toContain("phase(");
		expect(prompt).toContain("run_workflow");
	});

	it("wraps the task in auto-orchestration guidance that leaves trivial tasks inline", () => {
		const prompt = buildAutoOrchestrationPrompt("rename this variable");
		expect(prompt).toContain("rename this variable");
		expect(prompt).toContain("trivial or conversational, just handle it inline");
		expect(prompt).toContain("run_workflow");
		expect(prompt).toContain("agent(");
	});
});

// ============================================================ helpers

function writeWorkflowFile(dirPath: string, fileName: string, content: string): void {
	mkdirSync(dirPath, { recursive: true });
	writeFileSync(join(dirPath, fileName), content, "utf-8");
}

function makeState(id: string): WorkflowRunState {
	return {
		id,
		workflowName: "demo",
		status: "completed",
		startedAt: 1000,
		updatedAt: 1000,
		agentCount: 2,
		phases: ["main"],
		steps: phaseSummaries({
			id,
			workflowName: "demo",
			status: "completed",
			startedAt: 1000,
			updatedAt: 1000,
			agentCount: 2,
			phases: ["main"],
			steps: {},
			scriptContent: "",
			agents: [
				{ seq: 0, prompt: "a", label: "a", phase: "main", status: "completed", result: 1 },
				{ seq: 1, prompt: "b", label: "b", phase: "main", status: "completed", result: 2 },
			],
		}),
		agents: [],
		scriptContent: "export const meta = {}",
	};
}

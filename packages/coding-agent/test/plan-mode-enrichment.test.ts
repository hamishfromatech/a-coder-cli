import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentContext, BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isReadOnlyShellCommand } from "../src/core/permission-policy.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createPlanModeToolDefinition, type PlanModeToolCallbacks } from "../src/core/tools/plan-mode.ts";

describe("plan-mode enrichment", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-plan-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function makeToolCall(name: string, args?: Record<string, unknown>): BeforeToolCallContext {
		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		};
		const context: AgentContext = { systemPrompt: "", messages: [] };
		return {
			assistantMessage,
			toolCall: { type: "toolCall", name, id: "tc-1", arguments: args ?? {} },
			args,
			context,
		};
	}

	async function createSession(permissionMode: "ask" | "allow" | "read-only" | "auto") {
		const settingsManager = SettingsManager.inMemory({ permissionMode });
		const sessionManager = SessionManager.inMemory();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
		});
		return { session, sessionManager };
	}

	// ─── isReadOnlyShellCommand ─────────────────────────────────────────

	it("classifies obvious read-only shell commands as read-only", () => {
		expect(isReadOnlyShellCommand("pwd")).toBe(true);
		expect(isReadOnlyShellCommand("ls -la")).toBe(true);
		expect(isReadOnlyShellCommand("rg pattern src")).toBe(true);
		expect(isReadOnlyShellCommand("git status")).toBe(true);
		expect(isReadOnlyShellCommand("git diff HEAD~1")).toBe(true);
		expect(isReadOnlyShellCommand("cat a.txt | grep foo")).toBe(true);
	});

	it("rejects mutating/intent-bearing shell commands", () => {
		expect(isReadOnlyShellCommand("rm -rf /")).toBe(false);
		expect(isReadOnlyShellCommand("find . -name x -delete")).toBe(false);
		expect(isReadOnlyShellCommand("find . -exec rm {} \\;")).toBe(false);
		expect(isReadOnlyShellCommand("cat a > b")).toBe(false);
		expect(isReadOnlyShellCommand("echo x >> f.txt")).toBe(false);
		expect(isReadOnlyShellCommand("ls && rm x")).toBe(false);
		expect(isReadOnlyShellCommand("npm install")).toBe(false);
		expect(isReadOnlyShellCommand("sed -i s/a/b/ f.txt")).toBe(false);
		expect(isReadOnlyShellCommand("curl https://example.com")).toBe(false);
		expect(isReadOnlyShellCommand("")).toBe(false);
		expect(isReadOnlyShellCommand("python script.py")).toBe(false);
	});

	// ─── plan-mode permission gating ─────────────────────────────────────

	it("auto-approves read-only bash but denies other mutating tools in plan mode (non-interactive)", async () => {
		const { session } = await createSession("allow");
		session.setPlanMode(true);

		const readOnly = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "git status" }));
		expect(readOnly).toBeUndefined();

		const mutatingBash = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "npm install" }));
		expect(mutatingBash).toEqual({
			block: true,
			reason: "Plan mode is active but no TTY is available for approval",
		});

		const edit = await session.agent.beforeToolCall?.(makeToolCall("edit", { path: "src/a.ts" }));
		expect(edit).toEqual({
			block: true,
			reason: "Plan mode is active but no TTY is available for approval",
		});
		session.dispose();
	});

	it("allows writes to the session plan file while in plan mode", async () => {
		const { session } = await createSession("allow");
		session.setPlanMode(true);
		const planPath = session.getPlanFilePath();

		const allowed = await session.agent.beforeToolCall?.(makeToolCall("write", { path: planPath }));
		expect(allowed).toBeUndefined();

		const elsewhere = await session.agent.beforeToolCall?.(makeToolCall("write", { path: join(tempDir, "x.ts") }));
		expect(elsewhere).toEqual({
			block: true,
			reason: "Plan mode is active but no TTY is available for approval",
		});
		session.dispose();
	});

	it("gates read-only bash by content, not just prefix", async () => {
		const { session } = await createSession("allow");
		session.setPlanMode(true);
		const redirect = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "ls > out.txt" }));
		expect(redirect).toEqual({
			block: true,
			reason: "Plan mode is active but no TTY is available for approval",
		});
		session.dispose();
	});

	// ─── session allow rules (allowedPrompts on plan exit) ───────────────

	it("session allow rules override the mode and are arg-scoped", async () => {
		const { session } = await createSession("read-only");
		session.addSessionAllowRules(["Bash(npm test *)"]);

		const approved = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "npm test foo" }));
		expect(approved).toBeUndefined();

		const denied = await session.agent.beforeToolCall?.(makeToolCall("bash", { command: "npm run other" }));
		expect(denied).toEqual({ block: true, reason: 'Tool "bash" is blocked in read-only mode' });

		// Explicit session rules never reach the auto-mode classifier: matchedDefault is unset.
		session.dispose();
	});

	it("deduplicates session allow rules", async () => {
		const { session } = await createSession("read-only");
		session.addSessionAllowRules(["grep", "grep", "grep"]);
		expect(session.getSessionAllowRules()).toEqual(["grep"]);
		session.dispose();
	});

	// ─── plan_mode tool: persistPlan + allowedPrompts on exit ───────────

	it("plan_mode tool persists the plan and grants allow rules on exit", async () => {
		let planMode = false;
		let persisted = "";
		let rules: string[] = [];
		const callbacks: PlanModeToolCallbacks = {
			getPlanMode: () => planMode,
			setPlanMode: (enabled) => {
				planMode = enabled;
			},
			getPlanFilePath: () => "/tmp/plan.md",
			persistPlan: (plan) => {
				persisted = plan;
			},
			addSessionAllowRules: (granted) => {
				rules = granted;
			},
		};
		const tool = createPlanModeToolDefinition(callbacks);

		const enterResult = await tool.execute("t1", { enabled: true }, undefined, undefined, {} as never);
		expect(planMode).toBe(true);
		expect(enterResult.details).toMatchObject({ enabled: true, planFilePath: "/tmp/plan.md" });
		expect(enterResult.content[0]).toMatchObject({ type: "text" });
		expect((enterResult.content[0] as { text: string }).text).toContain("/tmp/plan.md");

		const exitResult = await tool.execute(
			"t2",
			{
				enabled: false,
				plan: "# The plan",
				allowedPrompts: [
					{ tool: "Bash", prompt: "npm test" },
					{ tool: "Edit", prompt: "edit src/" },
				],
			},
			undefined,
			undefined,
			{} as never,
		);
		expect(planMode).toBe(false);
		expect(persisted).toBe("# The plan");
		expect(rules).toEqual(["Bash(npm test *)", "edit"]);
		expect(exitResult.details).toMatchObject({ enabled: false, planSaved: true, allowedPromptsApplied: 2 });
		expect((exitResult.content[0] as { text: string }).text).toContain("Bash(npm test *)");
	});

	it("plan file path is stable per session id", async () => {
		const { session } = await createSession("allow");
		const planPath = session.getPlanFilePath();
		expect(planPath.endsWith(`${session.sessionId}.md`)).toBe(true);
		expect(planPath).toContain("plans");
		session.dispose();
	});

	it("plan_mode tool writes nothing when exiting without plan content", async () => {
		let planMode = true;
		const callbacks: PlanModeToolCallbacks = {
			getPlanMode: () => planMode,
			setPlanMode: (enabled) => {
				planMode = enabled;
			},
			getPlanFilePath: () => "/tmp/plan.md",
		};
		const tool = createPlanModeToolDefinition(callbacks);
		const result = await tool.execute("t1", { enabled: false }, undefined, undefined, {} as never);
		expect(result.details).toEqual({ enabled: false, planSaved: undefined, allowedPromptsApplied: undefined });
		expect(planMode).toBe(false);
	});
});

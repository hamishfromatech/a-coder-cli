import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeHookCommand } from "../src/core/hooks/executor.ts";
import type { HooksConfig } from "../src/core/hooks/hook-events.ts";
import { buildHookInput, decodeHookResult, matcherApplies, runConfiguredHooks } from "../src/core/hooks/run-hooks.ts";

const passthroughHook = { type: "command" as const, command: "exit 0" };

describe("matcherApplies", () => {
	it("matches omitted or wildcard matchers, exact strings, and regexes", () => {
		expect(matcherApplies(undefined, "bash")).toBe(true);
		expect(matcherApplies("*", "bash")).toBe(true);
		expect(matcherApplies("bash", "bash")).toBe(true);
		expect(matcherApplies("bash", "edit")).toBe(false);
		expect(matcherApplies("b.sh", "bash")).toBe(true);
		expect(matcherApplies("^(bash|edit)$", "edit")).toBe(true);
	});
});

describe("decodeHookResult", () => {
	const run = (stdout: string) =>
		decodeHookResult({ hook: passthroughHook, exitCode: 0, stdout, stderr: "", timedOut: false });

	it("treats exit 2 as block with stderr as reason", () => {
		const decision = decodeHookResult({
			hook: passthroughHook,
			exitCode: 2,
			stdout: "",
			stderr: "nope",
			timedOut: false,
		});
		expect(decision.block).toBe(true);
		expect(decision.reason).toBe("nope");
	});

	it("parses JSON stdout decisions", () => {
		expect(run('{"decision":"block","reason":"no"}').block).toBe(true);
		expect(run('{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"d"}}')).toEqual({
			block: true,
			reason: "d",
		});
		expect(run('{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"hmm"}}')).toEqual({
			ask: true,
			reason: "hmm",
		});
		expect(run('{"hookSpecificOutput":{"permissionDecision":"allow"}}').approve).toBe(true);
		expect(run('{"continue":false,"stopReason":"done"}').block).toBe(true);
		expect(run('{"additionalContext":"use rust"}')).toEqual({ additionalContext: ["use rust"] });
		expect(run('{"decision":"approve","reason":"safe"}')).toEqual({ approve: true, reason: "safe" });
		expect(run("plain output")).toEqual({});
	});

	it("ignores non-blocking failures", () => {
		expect(
			decodeHookResult({ hook: passthroughHook, exitCode: 1, stdout: "", stderr: "boom", timedOut: false }),
		).toEqual({});
		expect(
			decodeHookResult({
				hook: passthroughHook,
				exitCode: null,
				stdout: "",
				stderr: "",
				timedOut: false,
				spawnError: "no exec",
			}),
		).toEqual({});
	});
});

describe("executeHookCommand", () => {
	it("passes a JSON payload on stdin and captures output", async () => {
		const result = await executeHookCommand({ type: "command", command: "cat; echo done >&2" }, { hello: "world" });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe('{"hello":"world"}');
		expect(result.stderr.trim()).toBe("done");
	});

	it("propagates the exit code", async () => {
		const result = await executeHookCommand({ type: "command", command: "exit 7" }, {});
		expect(result.exitCode).toBe(7);
	});

	it("times out long-running hooks", async () => {
		const result = await executeHookCommand({ type: "command", command: "sleep 30", timeout: 0.3 }, {});
		expect(result.timedOut).toBe(true);
		expect(result.exitCode).not.toBe(0);
	}, 10_000);
});

describe("runConfiguredHooks", () => {
	function makeConfigDir(config: HooksConfig): string {
		// The hook config reader reads <home>/.a-coder/settings.json — seed the
		// temp dir as a fake home so it is picked up.
		const dir = mkdtempSync(join(tmpdir(), "hooks-test-"));
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ hooks: config }));
		const nested = join(dir, ".a-coder");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "settings.json"), JSON.stringify({ hooks: config }));
		return dir;
	}
	const settingsCwd = (dir: string): { cwd: string; home: string } => ({ cwd: dir, home: dir });

	it("runs matching hooks with stdin payload and aggregates decisions", async () => {
		const dir = makeConfigDir({
			PreToolUse: [
				{
					matcher: "bash",
					hooks: [
						{
							type: "command",
							command: 'echo \'{"decision":"block","reason":"no destructive commands"}\'',
						},
					],
				},
			],
		});
		const outcome = await runConfiguredHooks("PreToolUse", "bash", { tool_name: "bash" }, settingsCwd(dir));
		expect(outcome.ran).toBe(1);
		expect(outcome.errors).toHaveLength(0);
		expect(outcome.block).toBe(true);
		expect(outcome.reason).toBe("no destructive commands");

		const skipped = await runConfiguredHooks("PreToolUse", "read", {}, settingsCwd(dir));
		expect(skipped.ran).toBe(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("blocks when an exit-2 hook matches and skips non-matching keys", async () => {
		const dir = makeConfigDir({
			PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "echo blocked-input >&2; exit 2" }] }],
		});
		const outcome = await runConfiguredHooks("PreToolUse", "bash", {}, settingsCwd(dir));
		expect(outcome.block).toBe(true);
		expect(outcome.reason).toContain("blocked-input");

		const skipped = await runConfiguredHooks("PreToolUse", "read", {}, settingsCwd(dir));
		expect(skipped.ran).toBe(0);
		expect(skipped.block).toBe(false);
		rmSync(dir, { recursive: true, force: true });
	});

	it("skips everything when the kill switch is set", async () => {
		const dir = makeConfigDir({
			PreToolUse: [{ hooks: [{ type: "command", command: "exit 2" }] }],
		});
		process.env.A_CODER_CLI_DISABLE_HOOKS = "1";
		try {
			const outcome = await runConfiguredHooks("PreToolUse", "bash", {}, settingsCwd(dir));
			expect(outcome.ran).toBe(0);
		} finally {
			delete process.env.A_CODER_CLI_DISABLE_HOOKS;
		}
		rmSync(dir, { recursive: true, force: true });
	});

	it("aggregates deny over ask over approve across multiple hooks", async () => {
		const dir = makeConfigDir({
			PreToolUse: [
				{ hooks: [{ type: "command", command: 'echo \'{"hookSpecificOutput":{"permissionDecision":"allow"}}\'' }] },
				{
					hooks: [
						{
							type: "command",
							command:
								'echo \'{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"hmm"}}\'',
						},
					],
				},
			],
		});
		const both = await runConfiguredHooks("PreToolUse", "bash", {}, settingsCwd(dir));
		expect(both.approve).toBe(true);
		expect(both.ask).toBe(true);

		const withDeny = makeConfigDir({
			PreToolUse: [
				{ hooks: [{ type: "command", command: 'echo \'{"decision":"approve"}\'' }] },
				{ hooks: [{ type: "command", command: "exit 2" }] },
			],
		});
		const denied = await runConfiguredHooks("PreToolUse", "bash", {}, settingsCwd(withDeny));
		expect(denied.block).toBe(true);
		expect(denied.approve).toBe(false);
		rmSync(dir, { recursive: true, force: true });
		rmSync(withDeny, { recursive: true, force: true });
	});
});

describe("buildHookInput", () => {
	it("stamps session/cwd/event plus extras", () => {
		const input = buildHookInput("sess-1", "/tmp/work", "PreToolUse", { tool_name: "bash" });
		expect(input).toEqual({
			session_id: "sess-1",
			cwd: "/tmp/work",
			hook_event_name: "PreToolUse",
			tool_name: "bash",
		});
	});
});

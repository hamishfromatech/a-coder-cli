import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHooksConfig } from "../src/core/hooks/hook-config-reader.ts";
import { CLAUDE_HOOK_EVENTS, claudeHookEventToCli, cliEventToClaudeHook } from "../src/core/hooks/hook-events.ts";

describe("hook event-name mapping", () => {
	it("maps Claude-Code PreToolUse to CLI tool_call", () => {
		expect(claudeHookEventToCli("PreToolUse")).toBe("tool_call");
	});

	it("maps Claude-Code PostToolUse to CLI tool_result", () => {
		expect(claudeHookEventToCli("PostToolUse")).toBe("tool_result");
	});

	it("maps Claude-Code UserPromptSubmit to CLI input", () => {
		expect(claudeHookEventToCli("UserPromptSubmit")).toBe("input");
	});

	it("maps Claude-Code SessionStart to CLI session_start", () => {
		expect(claudeHookEventToCli("SessionStart")).toBe("session_start");
	});

	it("maps Claude-Code PreCompact to CLI session_before_compact", () => {
		expect(claudeHookEventToCli("PreCompact")).toBe("session_before_compact");
	});

	it("maps Stop to turn_end", () => {
		expect(claudeHookEventToCli("Stop")).toBe("turn_end");
	});

	it("reverse lookup returns the Claude-Code name for a CLI event", () => {
		expect(cliEventToClaudeHook("tool_call")).toContain("PreToolUse");
		expect(cliEventToClaudeHook("tool_result")).toContain("PostToolUse");
		expect(cliEventToClaudeHook("input")).toContain("UserPromptSubmit");
	});

	it("CLAUDE_HOOK_EVENTS contains all known names", () => {
		expect(CLAUDE_HOOK_EVENTS.size).toBe(9);
		for (const name of CLAUDE_HOOK_EVENTS) {
			expect(claudeHookEventToCli(name)).toBeDefined();
		}
	});
});

describe("readHooksConfig", () => {
	it("returns empty config when no settings.json files exist", () => {
		const home = mkdtempSync(join(tmpdir(), "hooks-home-"));
		const cwd = mkdtempSync(join(tmpdir(), "hooks-cwd-"));
		const config = readHooksConfig({ home, cwd });
		expect(config).toEqual({});
	});

	it("reads hooks from ~/.a-coder/settings.json", () => {
		const home = mkdtempSync(join(tmpdir(), "hooks-home-"));
		const cwd = mkdtempSync(join(tmpdir(), "hooks-cwd-"));
		mkdirSync(join(home, ".a-coder"), { recursive: true });
		writeFileSync(
			join(home, ".a-coder", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
				},
			}),
		);
		const config = readHooksConfig({ home, cwd });
		expect(config.PreToolUse).toBeDefined();
		expect(config.PreToolUse?.[0]?.hooks?.[0]?.command).toBe("echo pre");
	});

	it("reads hooks from ~/.claude/settings.json", () => {
		const home = mkdtempSync(join(tmpdir(), "hooks-home-"));
		const cwd = mkdtempSync(join(tmpdir(), "hooks-cwd-"));
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify({
				hooks: {
					UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: "echo user" }] }],
				},
			}),
		);
		const config = readHooksConfig({ home, cwd });
		expect(config.UserPromptSubmit).toBeDefined();
	});

	it("project .a-coder overrides global .claude for the same event", () => {
		const home = mkdtempSync(join(tmpdir(), "hooks-home-"));
		const cwd = mkdtempSync(join(tmpdir(), "hooks-cwd-"));
		mkdirSync(join(home, ".claude"), { recursive: true });
		mkdirSync(join(cwd, ".a-coder"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify({ hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "global" }] }] } }),
		);
		writeFileSync(
			join(cwd, ".a-coder", "settings.json"),
			JSON.stringify({ hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "project" }] }] } }),
		);
		const config = readHooksConfig({ home, cwd });
		expect(config.Stop?.[0]?.hooks?.[0]?.command).toBe("project");
	});

	it("ignores unknown event names", () => {
		const home = mkdtempSync(join(tmpdir(), "hooks-home-"));
		const cwd = mkdtempSync(join(tmpdir(), "hooks-cwd-"));
		mkdirSync(join(home, ".a-coder"), { recursive: true });
		writeFileSync(
			join(home, ".a-coder", "settings.json"),
			JSON.stringify({ hooks: { DiffZoneApply: [{ hooks: [] }], PreToolUse: [{ hooks: [] }] } }),
		);
		const config = readHooksConfig({ home, cwd });
		expect(config.PreToolUse).toBeDefined();
		expect((config as Record<string, unknown>).DiffZoneApply).toBeUndefined();
	});
});

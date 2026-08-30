import { describe, expect, it } from "vitest";
import {
	matcherRuleMatches,
	parsePolicyRule,
	resolvePermissionDecision,
	toolCallMatchValue,
} from "../src/core/permission-policy.ts";
import type { PermissionPolicyConfig } from "../src/core/settings-manager.ts";

describe("parsePolicyRule", () => {
	it("parses Tool(arg) forms and rejects malformed rules", () => {
		expect(parsePolicyRule("Bash(git *)")).toEqual({ rule: "Bash(git *)", tool: "bash", argGlob: "git *" });
		expect(parsePolicyRule("edit(.env)")).toEqual({ rule: "edit(.env)", tool: "edit", argGlob: ".env" });
		expect(parsePolicyRule("bash")).toBeUndefined();
		expect(parsePolicyRule("Bash()")).toBeUndefined();
		expect(parsePolicyRule("Bash(git")).toBeUndefined();
	});
});

describe("toolCallMatchValue", () => {
	it("uses the command for bash and the path for file tools", () => {
		expect(toolCallMatchValue("bash", { command: "rm -rf /" })).toBe("rm -rf /");
		expect(toolCallMatchValue("edit", { path: "src/a.ts" })).toBe("src/a.ts");
		expect(toolCallMatchValue("edit", { file_path: "src/b.ts" })).toBe("src/b.ts");
		// Unknown shapes serialize the args.
		expect(toolCallMatchValue("mcp__x__t", { url: "https://x" })).toContain("https://x");
	});
});

describe("matcherRuleMatches", () => {
	it("matches command globs case-insensitively with * wildcards", () => {
		const parsed = parsePolicyRule("Bash(git push*)")!;
		expect(matcherRuleMatches(parsed, "bash", { command: "git push --force origin main" })).toBe(true);
		expect(matcherRuleMatches(parsed, "bash", { command: "git status" })).toBe(false);
		expect(matcherRuleMatches(parsed, "edit", { path: "git push" })).toBe(false);
	});

	it("reads .env-style path rules", () => {
		const parsed = parsePolicyRule("write(*.env)")!;
		expect(matcherRuleMatches(parsed, "write", { path: "prod.env" })).toBe(true);
		expect(matcherRuleMatches(parsed, "write", { path: "src/index.ts" })).toBe(false);
	});
});

describe("resolvePermissionDecision with arg rules", () => {
	const autoPolicies = (rules: Partial<PermissionPolicyConfig>): PermissionPolicyConfig => ({
		softDeny: [],
		allow: [],
		hardDeny: [],
		...rules,
	});

	it("hard-deny Bash(git push*) blocks that command but not others", () => {
		const policies = autoPolicies({ hardDeny: ["Bash(git push*)"] });
		const blocked = resolvePermissionDecision("auto", "bash", policies, true, { command: "git push -f" });
		expect(blocked.decision).toBe("deny");
		const allowed = resolvePermissionDecision("auto", "bash", policies, true, { command: "git status" });
		expect(allowed).toEqual({ decision: "approve", matchedDefault: true });
	});

	it("allow rules with args approve specific commands in auto mode", () => {
		const policies = autoPolicies({ softDeny: ["Bash(*)"], allow: ["Bash(npm test*)"] });
		const approved = resolvePermissionDecision("auto", "bash", policies, true, { command: "npm test -- --run" });
		expect(approved).toEqual({ decision: "approve" });
		const prompted = resolvePermissionDecision("auto", "bash", policies, true, { command: "curl example.com" });
		expect(prompted.decision).toBe("prompt");
	});

	it("expands $defaults without arg rules like before", () => {
		const policies = autoPolicies({ softDeny: ["$defaults"] });
		expect(resolvePermissionDecision("auto", "edit", policies, true, { path: "a.ts" }).decision).toBe("prompt");
	});
});

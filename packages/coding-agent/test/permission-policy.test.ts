import { describe, expect, it } from "vitest";
import {
	DEFAULT_MUTATING_TOOL_NAMES,
	expandPolicyRules,
	resolvePermissionDecision,
} from "../src/core/permission-policy.ts";
import type { PermissionPolicyConfig } from "../src/core/settings-manager.ts";

describe("resolvePermissionDecision", () => {
	it("allows everything in allow mode", () => {
		expect(resolvePermissionDecision("allow", "bash", undefined, true)).toEqual({ decision: "approve" });
		expect(resolvePermissionDecision("allow", "write", undefined, false)).toEqual({ decision: "approve" });
		expect(resolvePermissionDecision("allow", "read", {}, true)).toEqual({ decision: "approve" });
	});

	it("prompts in ask mode when interactive, denies otherwise", () => {
		expect(resolvePermissionDecision("ask", "bash", undefined, true)).toEqual({
			decision: "prompt",
			reason: 'Permission mode is "ask"',
		});
		expect(resolvePermissionDecision("ask", "read", undefined, false)).toEqual({
			decision: "deny",
			reason: 'Permission mode is "ask" but no TTY is available',
		});
	});

	it("denies mutating tools and allows others in read-only mode", () => {
		for (const tool of DEFAULT_MUTATING_TOOL_NAMES) {
			expect(resolvePermissionDecision("read-only", tool, undefined, true)).toEqual({
				decision: "deny",
				reason: `Tool "${tool}" is blocked in read-only mode`,
			});
		}
		expect(resolvePermissionDecision("read-only", "read", undefined, true)).toEqual({ decision: "approve" });
		expect(resolvePermissionDecision("read-only", "grep", undefined, true)).toEqual({ decision: "approve" });
	});

	it("denies on hardDeny matches in auto mode", () => {
		const policies: PermissionPolicyConfig = { hardDeny: ["bash", "write"] };
		expect(resolvePermissionDecision("auto", "bash", policies, true)).toEqual({
			decision: "deny",
			reason: 'Tool "bash" matches hard-deny policy',
		});
		expect(resolvePermissionDecision("auto", "write", policies, true)).toEqual({
			decision: "deny",
			reason: 'Tool "write" matches hard-deny policy',
		});
		expect(resolvePermissionDecision("auto", "read", policies, true)).toEqual({ decision: "approve" });
	});

	it("prompts on softDeny matches in auto mode when interactive, denies otherwise", () => {
		const policies: PermissionPolicyConfig = { softDeny: ["write", "edit"] };
		expect(resolvePermissionDecision("auto", "write", policies, true)).toEqual({
			decision: "prompt",
			reason: 'Tool "write" matches soft-deny policy',
		});
		expect(resolvePermissionDecision("auto", "edit", policies, false)).toEqual({
			decision: "deny",
			reason: 'Tool "edit" matches soft-deny policy (no TTY)',
		});
		expect(resolvePermissionDecision("auto", "read", policies, true)).toEqual({ decision: "approve" });
	});

	it("approves on explicit allow matches in auto mode", () => {
		const policies: PermissionPolicyConfig = { allow: ["read", "grep"] };
		expect(resolvePermissionDecision("auto", "read", policies, true)).toEqual({ decision: "approve" });
		expect(resolvePermissionDecision("auto", "grep", policies, true)).toEqual({ decision: "approve" });
		expect(resolvePermissionDecision("auto", "bash", policies, true)).toEqual({ decision: "approve" });
	});

	it("expands $defaults to mutating tools and treats them as soft-deny by default", () => {
		const policies: PermissionPolicyConfig = { softDeny: ["$defaults"] };
		for (const tool of DEFAULT_MUTATING_TOOL_NAMES) {
			expect(resolvePermissionDecision("auto", tool, policies, true).decision).toBe("prompt");
		}
		expect(resolvePermissionDecision("auto", "read", policies, true)).toEqual({ decision: "approve" });
		expect(resolvePolicyRules(policies)).toEqual([...DEFAULT_MUTATING_TOOL_NAMES]);
	});

	it("gives hardDeny precedence over allow and softDeny", () => {
		const policies: PermissionPolicyConfig = {
			allow: ["bash"],
			softDeny: ["bash"],
			hardDeny: ["bash"],
		};
		expect(resolvePermissionDecision("auto", "bash", policies, true)).toEqual({
			decision: "deny",
			reason: 'Tool "bash" matches hard-deny policy',
		});
	});

	it("supports wildcard rules", () => {
		const policies: PermissionPolicyConfig = { hardDeny: ["custom:*"] };
		expect(resolvePermissionDecision("auto", "custom:dangerous", policies, true)).toEqual({
			decision: "deny",
			reason: 'Tool "custom:dangerous" matches hard-deny policy',
		});
		expect(resolvePermissionDecision("auto", "custom_safe", policies, true)).toEqual({ decision: "approve" });
	});

	it("falls back to approve in auto mode when no rules match", () => {
		expect(resolvePermissionDecision("auto", "anything", {}, true)).toEqual({ decision: "approve" });
		expect(resolvePermissionDecision("auto", "anything", undefined, false)).toEqual({ decision: "approve" });
	});
});

function resolvePolicyRules(policies: PermissionPolicyConfig): string[] {
	return [
		...(policies.allow ? expandPolicyRules(policies.allow) : []),
		...(policies.softDeny ? expandPolicyRules(policies.softDeny) : []),
		...(policies.hardDeny ? expandPolicyRules(policies.hardDeny) : []),
	];
}

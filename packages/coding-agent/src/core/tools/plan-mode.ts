import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const allowedPromptSchema = Type.Object(
	{
		/** Tool the prompt applies to (e.g. "Bash", "Edit", "Write"). */
		tool: Type.String({ description: 'Tool the prompt applies to (e.g. "Bash")' }),
		/** What the user approved, e.g. "npm test". */
		prompt: Type.String({ description: 'The command or action the user pre-approved, e.g. "npm test"' }),
	},
	{ additionalProperties: false },
);

const planModeSchema = Type.Object(
	{
		enabled: Type.Boolean({
			description:
				"true to enter plan mode (subsequent mutating tools require user approval), false to exit plan mode.",
		}),
		reason: Type.Optional(
			Type.String({
				description: "Optional explanation for why you are enabling or disabling plan mode. Shown to the user.",
			}),
		),
		plan: Type.Optional(
			Type.String({
				description:
					"On exit (enabled=false): the full implementation plan to persist to the plan file before leaving plan mode. Take the approved plan from the conversation.",
			}),
		),
		allowedPrompts: Type.Optional(
			Type.Array(allowedPromptSchema, {
				description:
					"On exit (enabled=false): commands the user pre-approved during planning, granted as session allow rules so the run does not re-prompt for them.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type PlanModeToolInput = Static<typeof planModeSchema>;

export interface PlanModeToolDetails {
	enabled: boolean;
	reason?: string;
	planFilePath?: string;
	planSaved?: boolean;
	allowedPromptsApplied?: number;
	/** Set when the user declined the exit and plan mode stays on. */
	keepPlanning?: boolean;
}

/**
 * User decision from the exit-plan approval dialog (easy-agent
 * PlanApprovalDialog parity). `proceed` exits plan mode (optionally first
 * switching the permission mode to "ask" so every edit still prompts);
 * `keep-planning` keeps plan mode active and returns the typed feedback to
 * the model.
 */
export type PlanExitDecision = { decision: "proceed"; mode?: "ask" } | { decision: "keep-planning"; feedback?: string };

export interface PlanModeToolCallbacks {
	getPlanMode(): boolean;
	setPlanMode(enabled: boolean): void;
	/** Absolute path of this session's plan file (created on first call if missing the parent dir). */
	getPlanFilePath(): string;
	/** Persist the approved plan. Called on exit when the model supplies `plan`. */
	persistPlan?(plan: string): void;
	/** Grant explicit session-scoped allow rules on exit (easy-agent's allowedPrompts). */
	addSessionAllowRules?(rules: string[]): void;
	/** Current plan-file content for the approval dialog preview. */
	getPlanFileContent?(): string | undefined;
	/** Switch permission mode as part of the approved exit (option 2). */
	setPermissionMode?(mode: "ask"): void;
	/**
	 * Ask the user to approve the plan before leaving plan mode. When absent
	 * (headless/RPC), exits proceed directly without a dialog.
	 */
	requestPlanApproval?(info: { plan?: string; planFilePath?: string }): Promise<PlanExitDecision>;
}

/**
 * Convert easy-agent-style allowedPrompts entries into pi permission rules.
 * Bash prompts become arg-scoped rules ("Bash(cmd *)"); everything else is a
 * bare tool-name rule.
 */
export function buildAllowRulesFromPrompts(allowedPrompts: Array<{ tool: string; prompt: string }>): string[] {
	return allowedPrompts
		.filter((item) => item.tool && item.prompt)
		.map((item) => (item.tool.toLowerCase() === "bash" ? `Bash(${item.prompt} *)` : item.tool.toLowerCase()));
}

function formatPlanModeResult(enabled: boolean, reason?: string): string {
	const state = enabled ? "Plan mode enabled" : "Plan mode disabled";
	const suffix = reason ? `: ${reason}` : "";
	return `${state}${suffix}`;
}

export function createPlanModeToolDefinition(
	callbacks: PlanModeToolCallbacks,
): ToolDefinition<typeof planModeSchema, PlanModeToolDetails> {
	return {
		name: "plan_mode",
		label: "Plan mode",
		description:
			"Toggle plan mode. When enabled, mutating tool calls (bash, edit, write) require explicit user approval before they run, regardless of the current permission mode; only obvious read-only bash commands and writes to the session's plan file are auto-approved while planning. Use this before starting non-trivial multi-step work where you want to explore, write a plan file, and get confirmation before making changes.",
		promptSnippet: "Toggle plan mode to explore read-only, persist a plan file, and confirm before mutating changes",
		promptGuidelines: [
			"Enable plan_mode before multi-step changes that affect files or run commands when you want to confirm the plan with the user first.",
			"While plan mode is active: explore with read-only tools, write the implementation plan to the plan file given in the result, and avoid mutating commands. Writes to the plan file are allowed; other mutating tools prompt the user.",
			"Disable plan_mode with enabled=false once the work the user approved is complete or they ask to return to normal flow. On exit you may pass plan (final plan content) and allowedPrompts (commands the user approved, e.g. npm test) so the run can proceed without re-prompting.",
			"Read-only tools (read, grep, find, ls) remain auto-approved in plan mode so you can explore before proposing changes.",
		],
		parameters: planModeSchema,
		async execute(_toolCallId, params: PlanModeToolInput) {
			const previousMode = callbacks.getPlanMode();

			// Exit path: ask the user to approve the plan first (interactive UIs
			// wire requestPlanApproval; headless runs proceed directly).
			if (!params.enabled && previousMode && callbacks.requestPlanApproval) {
				const planFilePath = callbacks.getPlanFilePath();
				const preview = params.plan?.trim() || callbacks.getPlanFileContent?.() || undefined;
				const decision = await callbacks.requestPlanApproval({
					...(preview ? { plan: preview } : {}),
					planFilePath,
				});
				if (decision.decision === "keep-planning") {
					const feedback = decision.feedback?.trim();
					const lines = [
						"Plan mode still active — the user chose to keep planning.",
						`Plan file: ${planFilePath}`,
						feedback
							? `User feedback: ${feedback}`
							: "Refine the plan in the plan file, then call plan_mode with enabled=false again.",
					];
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: {
							enabled: true,
							keepPlanning: true,
							...(feedback ? { reason: feedback } : {}),
						} satisfies PlanModeToolDetails,
					};
				}
				if (decision.mode && callbacks.setPermissionMode) {
					callbacks.setPermissionMode(decision.mode);
				}
			}

			callbacks.setPlanMode(params.enabled);
			const enabled = callbacks.getPlanMode();

			const details: PlanModeToolDetails = { enabled, reason: params.reason };
			const blocks: string[] = [formatPlanModeResult(enabled, params.reason)];

			if (enabled && !previousMode) {
				const planFilePath = callbacks.getPlanFilePath();
				details.planFilePath = planFilePath;
				blocks.push(
					"",
					"PLAN MODE ACTIVE — gather context with read-only tools first.",
					`Plan file: ${planFilePath}`,
					"- Write the implementation plan to the plan file (writes there are allowed in plan mode).",
					"- Mutating tools prompt the user for approval; obvious read-only bash commands run without prompting.",
					"- Exit by calling plan_mode with enabled=false, optionally passing the final plan as `plan` and user-approved commands as `allowedPrompts` (each becomes a session allow rule).",
				);
			}

			if (!enabled && previousMode) {
				const plan = params.plan?.trim();
				if (plan && callbacks.persistPlan) {
					callbacks.persistPlan(plan);
					details.planSaved = true;
					blocks.push(`Plan saved to ${callbacks.getPlanFilePath()}`);
				}
				if (params.allowedPrompts?.length && callbacks.addSessionAllowRules) {
					const rules = buildAllowRulesFromPrompts(params.allowedPrompts);
					if (rules.length > 0) {
						callbacks.addSessionAllowRules(rules);
						details.allowedPromptsApplied = rules.length;
						blocks.push(`Granted ${rules.length} session allow rule(s): ${rules.join(", ")}`);
					}
				}
				blocks.push("Full tool access restored (subject to the current permission mode). Start implementing.");
			}

			return {
				content: [{ type: "text", text: blocks.join("\n") }],
				details,
			};
		},
		renderCall(args, theme, _context) {
			const text = new Text("", 0, 0);
			const label = args?.enabled ? "Enable plan mode" : "Disable plan mode";
			text.setText(`${theme.fg("toolTitle", theme.bold("plan_mode"))} ${theme.fg("accent", label)}`);
			return text;
		},
		renderResult(result, _options, theme, _context) {
			const text = new Text("", 0, 0);
			const details = result.details as PlanModeToolDetails | undefined;
			if (details?.keepPlanning) {
				const lines = [theme.fg("warning", "Plan mode kept active — user chose to keep planning")];
				if (details.reason) lines.push(theme.fg("muted", `Feedback: ${details.reason}`));
				text.setText(lines.join("\n"));
				return text;
			}
			const lines: string[] = [formatPlanModeResult(details?.enabled ?? false, details?.reason)];
			if (details?.planFilePath) {
				lines.push(theme.fg("dim", `Plan file: ${details.planFilePath}`));
			}
			if (details?.planSaved) {
				lines.push(theme.fg("success", "Plan persisted"));
			}
			if (details?.allowedPromptsApplied) {
				lines.push(theme.fg("success", `${details.allowedPromptsApplied} session allow rule(s) granted`));
			}
			text.setText(lines.join("\n"));
			return text;
		},
	};
}

export function createPlanModeTool(callbacks: PlanModeToolCallbacks): AgentTool {
	return wrapToolDefinition(createPlanModeToolDefinition(callbacks));
}

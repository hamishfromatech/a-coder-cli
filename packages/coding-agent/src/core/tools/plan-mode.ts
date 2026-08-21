import type { AgentTool } from "@theatechcorporation/pi-agent-core";
import { Text } from "@theatechcorporation/pi-tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

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
	},
	{ additionalProperties: false },
);

export type PlanModeToolInput = Static<typeof planModeSchema>;

export interface PlanModeToolDetails {
	enabled: boolean;
	reason?: string;
}

export interface PlanModeToolCallbacks {
	getPlanMode(): boolean;
	setPlanMode(enabled: boolean): void;
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
			"Toggle plan mode. When enabled, every subsequent mutating tool call (bash, edit, write) requires explicit user approval before it runs, regardless of the current permission mode. Use this before starting non-trivial multi-step work where you want to present a plan and get confirmation before making changes. Read-only tools remain auto-approved so you can still gather context while planning.",
		promptSnippet: "Toggle plan mode to require approval before mutating changes",
		promptGuidelines: [
			"Enable plan_mode before multi-step changes that affect files or run commands when you want to confirm the plan with the user first.",
			"When plan mode is active, mutating tools (bash, edit, write) will prompt the user for approval. Present a clear plan in your assistant message before calling the first mutating tool.",
			"Disable plan_mode once the user-approved work is complete, or when the user asks to return to normal flow.",
			"Read-only tools (read, grep, find, ls) remain auto-approved in plan mode so you can explore before proposing changes.",
		],
		parameters: planModeSchema,
		async execute(_toolCallId, params: PlanModeToolInput) {
			callbacks.setPlanMode(params.enabled);
			const enabled = callbacks.getPlanMode();
			const text = formatPlanModeResult(enabled, params.reason);
			return {
				content: [
					{
						type: "text",
						text,
					},
				],
				details: { enabled, reason: params.reason },
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
			text.setText(
				theme.fg(
					details?.enabled ? "warning" : "success",
					formatPlanModeResult(details?.enabled ?? false, details?.reason),
				),
			);
			return text;
		},
	};
}

export function createPlanModeTool(callbacks: PlanModeToolCallbacks): AgentTool {
	return wrapToolDefinition(createPlanModeToolDefinition(callbacks));
}

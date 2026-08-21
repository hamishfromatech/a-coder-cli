import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { findAgent } from "../agents/index.ts";
import type { ExtensionFactory, InProcessSubAgentRecord, SubAgentRunResult } from "../extensions/types.ts";

export interface SubagentToolOptions {
	cliPath?: string;
	defaultProvider?: string;
	defaultModel?: string;
}

/**
 * Register the sub-agent tools. Both foreground and background sub-agents run
 * in-process as nested agent loops (shared stream fn / auth / permission hooks,
 * filtered tool pool with spawn_subagent stripped — no recursion). Background
 * sub-agents are managed via the session's in-process store
 * (getSubAgent / listSubAgents / waitSubAgent / killSubAgent).
 */
export function createSubagentExtensionFactory(_options: SubagentToolOptions = {}): ExtensionFactory {
	return async (pi) => {
		pi.registerTool({
			name: "spawn_subagent",
			label: "Spawn subagent",
			description:
				"Start a subagent to work on an independent task. If detached is false (default), the subagent runs in-process as a nested agent loop and this call returns its final output. If detached is true, the subagent runs in the background and this call returns immediately with a subagent id usable with wait_subagent, get_subagent_status, and kill_subagent.",
			parameters: Type.Object({
				id: Type.String({ description: "Unique identifier for this subagent task. Use a short kebab-case slug." }),
				task: Type.String({ description: "The task prompt to send to the subagent." }),
				subagent_type: Type.Optional(
					Type.String({
						description:
							"Named sub-agent type to invoke (e.g. general-purpose, Explore, or a custom agent from .a-coder-cli/agents/*.md). When set, the agent's system prompt and model override are applied. Available types are listed in the system prompt.",
					}),
				),
				system_prompt: Type.Optional(
					Type.String({ description: "Optional system prompt override (takes precedence over subagent_type)." }),
				),
				provider: Type.Optional(
					Type.String({ description: "Provider name (defaults to current session provider)." }),
				),
				model: Type.Optional(Type.String({ description: "Model id (defaults to current session model)." })),
				timeout_ms: Type.Optional(
					Type.Number({ description: "Maximum runtime in milliseconds (default: 600000)." }),
				),
				detached: Type.Optional(
					Type.Boolean({ description: "If true, return immediately without waiting for the subagent to finish." }),
				),
				isolation: Type.Optional(
					Type.Union([Type.Literal("none"), Type.Literal("worktree")], {
						description:
							"Filesystem isolation. 'worktree' runs the subagent inside a fresh git worktree so its file edits don't touch the main working copy until reviewed; the worktree is removed on completion unless it has changes (the kept path is then surfaced in the result). Requires the working directory to be a git repository; otherwise the subagent runs without isolation and a warning is returned. Default 'none'.",
					}),
				),
				name: Type.Optional(
					Type.String({
						description:
							"Agent Teams teammate name (e.g. 'backend'). Pair with team_name to join the active team; the teammate is reachable via send_message and visible in the team roster.",
					}),
				),
				team_name: Type.Optional(
					Type.String({
						description:
							"Agent Teams team name (e.g. 'refactor-auth'). Pair with name to register the subagent as a named teammate of that team.",
					}),
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
				// Resolve a named sub-agent type (if any) to its system prompt + model override.
				// An explicit system_prompt/model param takes precedence over the agent definition.
				const subagentType = params.subagent_type as string | undefined;
				const def = subagentType ? findAgent(subagentType) : undefined;
				if (subagentType && !def) {
					return {
						content: [
							{
								type: "text",
								text: `Unknown subagent_type "${subagentType}". Available types are listed in the system prompt.`,
							},
						],
						details: null,
					};
				}
				const task = params.task as string;
				const detached = (params.detached as boolean | undefined) ?? false;
				const modelObj = params.model
					? ctx.modelRegistry.getAvailable().find((m) => m.id === (params.model as string))
					: undefined;

				if (!detached) {
					// Foreground: run in-process via the background machinery so the
					// live progress card (subscribeSubAgents) is also active for
					// awaited sub-agents — mirrors easy-agent's seed-at-tool_use_start
					// + onProgress→store bridge. Returns the final output once done.
					ctx.runSubAgentBackground({
						id: params.id as string,
						agentType: subagentType ?? "general-purpose",
						prompt: task,
						systemPrompt: params.system_prompt as string | undefined,
						model: modelObj,
						maxTurns: def?.maxTurns,
						notifyOnComplete: false,
						isolation: params.isolation as "none" | "worktree" | undefined,
						name: params.name as string | undefined,
						teamName: params.team_name as string | undefined,
					});
					const record = await ctx.waitSubAgent(
						params.id as string,
						(params.timeout_ms as number | undefined) ?? undefined,
					);
					if (!record) {
						return {
							content: [{ type: "text", text: `Subagent "${params.id}" not found.` }],
							details: null,
						};
					}
					const result: SubAgentRunResult = {
						agentType: record.agentType,
						finalText: record.finalText ?? record.error ?? "",
						toolUseCount: record.toolUseCount,
						turnCount: record.turnCount,
						...(record.error ? { warnings: [record.error] } : {}),
					};
					return {
						content: [{ type: "text", text: formatRunResult(result) }],
						details: result,
					};
				}

				// Background (detached): run in-process without awaiting; manage via the store.
				const { id } = ctx.runSubAgentBackground({
					id: params.id as string,
					agentType: subagentType ?? "general-purpose",
					prompt: task,
					systemPrompt: params.system_prompt as string | undefined,
					model: modelObj,
					maxTurns: def?.maxTurns,
					isolation: params.isolation as "none" | "worktree" | undefined,
					name: params.name as string | undefined,
					teamName: params.team_name as string | undefined,
				});
				const record = ctx.getSubAgent(id);
				return {
					content: [
						{
							type: "text",
							text: `Started background subagent "${id}" (${subagentType ?? "general-purpose"}). Use get_subagent_status or wait_subagent to check on it; kill_subagent to stop it.`,
						},
					],
					details: record ?? null,
				};
			},
		});

		pi.registerTool({
			name: "list_subagents",
			label: "List subagents",
			description: "List all background subagents with their current status.",
			parameters: Type.Object({}),
			async execute(_toolCallId, _params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
				const list = ctx.listSubAgents();
				const lines = list.map((r) => `- ${r.id}: ${r.status} (${r.agentType})${r.error ? ` — ${r.error}` : ""}`);
				return {
					content: [{ type: "text", text: lines.join("\n") || "No subagents." }],
					details: list,
				};
			},
		});

		pi.registerTool({
			name: "get_subagent_status",
			label: "Get subagent status",
			description: "Get detailed status and latest output for a background subagent by id.",
			parameters: Type.Object({
				id: Type.String({ description: "Subagent id." }),
				timeout_ms: Type.Optional(
					Type.Number({ description: "Maximum time to wait in milliseconds (default: 60000)." }),
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
				const id = params.id as string;
				const record = ctx.getSubAgent(id);
				if (!record) {
					return {
						content: [{ type: "text", text: `Subagent "${id}" not found.` }],
						details: null,
					};
				}
				return {
					content: [{ type: "text", text: formatRecord(record) }],
					details: record,
				};
			},
		});

		pi.registerTool({
			name: "wait_subagent",
			label: "Wait for subagent",
			description: "Block until a background subagent completes and return its final result.",
			parameters: Type.Object({
				id: Type.String({ description: "Subagent id." }),
				timeout_ms: Type.Optional(
					Type.Number({ description: "Maximum time to wait in milliseconds (default: 60000)." }),
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
				const id = params.id as string;
				const record = await ctx.waitSubAgent(id, (params.timeout_ms as number | undefined) ?? undefined);
				if (!record) {
					return {
						content: [{ type: "text", text: `Subagent "${id}" not found.` }],
						details: null,
					};
				}
				return {
					content: [{ type: "text", text: formatRecord(record) }],
					details: record,
				};
			},
		});

		pi.registerTool({
			name: "kill_subagent",
			label: "Kill subagent",
			description: "Terminate a background subagent by id.",
			parameters: Type.Object({
				id: Type.String({ description: "Subagent id." }),
				reason: Type.Optional(Type.String({ description: "Reason for killing the subagent." })),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
				const id = params.id as string;
				const record = ctx.killSubAgent(id, (params.reason as string | undefined) ?? "tool");
				return {
					content: [
						{
							type: "text",
							text: record
								? `Killed subagent "${record.id}". Status: ${record.status}.`
								: `Subagent "${id}" not found.`,
						},
					],
					details: record ?? null,
				};
			},
		});
	};
}

function formatRunResult(result: SubAgentRunResult): string {
	const lines = [`Subagent: ${result.agentType}`, `Turns: ${result.turnCount}`, `Tool uses: ${result.toolUseCount}`];
	if (result.warnings?.length) lines.push(`Warnings: ${result.warnings.join("; ")}`);
	if (result.finalText) lines.push("Output:", result.finalText.slice(0, 4000));
	return lines.join("\n");
}

function formatRecord(record: InProcessSubAgentRecord): string {
	const lines = [
		`Subagent: ${record.id}`,
		`Type: ${record.agentType}`,
		`Status: ${record.status}`,
		`Turns: ${record.turnCount}`,
		`Tool uses: ${record.toolUseCount}`,
	];
	if (record.error) lines.push(`Error: ${record.error}`);
	if (record.worktreePath) lines.push(`Worktree: ${record.worktreePath} (${record.worktreeBranch})`);
	if (record.finalText) lines.push("Output:", record.finalText.slice(0, 4000));
	return lines.join("\n");
}

import type { AgentToolResult } from "@theatechcorporation/pi-agent-core";
import { Type } from "typebox";
import { findAgent } from "../agents/index.ts";
import type { ExtensionFactory, SubAgentRunResult } from "../extensions/types.ts";
import { createSubagentManager } from "./manager.ts";
import type { SubagentConfig } from "./types.ts";

export interface SubagentToolOptions {
	cliPath?: string;
	defaultProvider?: string;
	defaultModel?: string;
}

export function createSubagentExtensionFactory(options: SubagentToolOptions): ExtensionFactory {
	const manager = createSubagentManager(options);

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

				if (!detached) {
					// Foreground: run in-process as a nested agent with the parent's stream
					// function / auth / permission hooks and a filtered tool pool (no recursion
					// — spawn_subagent itself is stripped from the sub-agent's tools).
					const modelObj = params.model
						? ctx.modelRegistry.getAvailable().find((m) => m.id === (params.model as string))
						: undefined;
					const result = await ctx.runSubAgent({
						agentType: subagentType ?? "general-purpose",
						prompt: task,
						systemPrompt: params.system_prompt as string | undefined,
						model: modelObj,
						maxTurns: def?.maxTurns,
					});
					return {
						content: [{ type: "text", text: formatInProcessResult(result) }],
						details: result,
					};
				}

				// Detached (background): process-based manager. In-process background (with
				// an in-process subagent store + completion notification) is a follow-up.
				const config: SubagentConfig = {
					id: params.id as string,
					task,
					systemPrompt: (params.system_prompt as string | undefined) ?? def?.getSystemPrompt(),
					provider: (params.provider as string | undefined) ?? options.defaultProvider,
					model: (params.model as string | undefined) ?? def?.model ?? options.defaultModel,
					timeoutMs: (params.timeout_ms as number | undefined) ?? undefined,
					detached: true,
				};
				const record = manager.spawn(config);
				return {
					content: [{ type: "text", text: formatSubagentResult(record) }],
					details: record,
				};
			},
		});

		pi.registerTool({
			name: "list_subagents",
			label: "List subagents",
			description: "List all subagents with their current status.",
			parameters: Type.Object({}),
			async execute(_toolCallId, _params, _signal): Promise<AgentToolResult<unknown>> {
				const list = manager.list();
				const lines = list.map((r) => `- ${r.id}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
				return {
					content: [{ type: "text", text: lines.join("\n") || "No subagents." }],
					details: list,
				};
			},
		});

		pi.registerTool({
			name: "get_subagent_status",
			label: "Get subagent status",
			description: "Get detailed status and latest output for a subagent by id.",
			parameters: Type.Object({
				id: Type.String({ description: "Subagent id." }),
				timeout_ms: Type.Optional(
					Type.Number({ description: "Maximum time to wait in milliseconds (default: 60000)." }),
				),
			}),
			async execute(_toolCallId, params, _signal): Promise<AgentToolResult<unknown>> {
				const id = params.id as string;
				const record = manager.get(id);
				if (!record) {
					return {
						content: [{ type: "text", text: `Subagent "${id}" not found.` }],
						details: null,
					};
				}
				return {
					content: [{ type: "text", text: formatSubagentResult(record) }],
					details: record,
				};
			},
		});

		pi.registerTool({
			name: "wait_subagent",
			label: "Wait for subagent",
			description: "Block until a running subagent completes and return its final result.",
			parameters: Type.Object({
				id: Type.String({ description: "Subagent id." }),
				timeout_ms: Type.Optional(
					Type.Number({ description: "Maximum time to wait in milliseconds (default: 60000)." }),
				),
			}),
			async execute(_toolCallId, params, _signal): Promise<AgentToolResult<unknown>> {
				const record = await manager.wait(params.id as string);
				return {
					content: [{ type: "text", text: formatSubagentResult(record) }],
					details: record,
				};
			},
		});

		pi.registerTool({
			name: "kill_subagent",
			label: "Kill subagent",
			description: "Terminate a running subagent by id.",
			parameters: Type.Object({
				id: Type.String({ description: "Subagent id." }),
				reason: Type.Optional(Type.String({ description: "Reason for killing the subagent." })),
			}),
			async execute(_toolCallId, params, _signal): Promise<AgentToolResult<unknown>> {
				const record = manager.kill(params.id as string, (params.reason as string | undefined) ?? "tool");
				return {
					content: [
						{
							type: "text",
							text: `Killed subagent "${params.id as string}". Status: ${record?.status ?? "not found"}.`,
						},
					],
					details: record,
				};
			},
		});
	};
}

function formatInProcessResult(result: SubAgentRunResult): string {
	const lines = [`Subagent: ${result.agentType}`, `Turns: ${result.turnCount}`, `Tool uses: ${result.toolUseCount}`];
	if (result.warnings?.length) lines.push(`Warnings: ${result.warnings.join("; ")}`);
	if (result.finalText) lines.push("Output:", result.finalText.slice(0, 4000));
	return lines.join("\n");
}

function formatSubagentResult(record: import("./types.ts").SubagentRecord): string {
	const lines = [
		`Subagent: ${record.id}`,
		`Status: ${record.status}`,
		`Created: ${record.createdAt}`,
		`Updated: ${record.updatedAt}`,
	];
	if (record.error) lines.push(`Error: ${record.error}`);
	if (record.exitCode !== undefined && record.exitCode !== null) lines.push(`Exit code: ${record.exitCode}`);
	if (record.sessionPath) lines.push(`Session: ${record.sessionPath}`);
	const lastText = getLastAssistantText(record);
	if (lastText) {
		lines.push("Output:", lastText.slice(0, 4000));
	}
	return lines.join("\n");
}

type LastMessageCandidate = { role?: string; content?: ({ type?: string; text?: string } | string)[] | string };

function getLastAssistantText(record: import("./types.ts").SubagentRecord): string | undefined {
	for (let i = record.events.length - 1; i >= 0; i--) {
		const event = record.events[i];
		if (event?.type === "message_end" || event?.type === "turn_end" || event?.type === "agent_end") {
			const raw =
				(event as { messages?: unknown[]; message?: unknown }).messages?.at(-1) ??
				(event as { message?: unknown }).message;
			const message = raw as LastMessageCandidate | undefined;
			if (message?.role === "assistant" && message.content) {
				const parts = Array.isArray(message.content) ? message.content : [message.content];
				const text = parts.map((c) => (typeof c === "string" ? c : ((c as { text?: string }).text ?? ""))).join("");
				if (text) return text;
			}
		}
	}
	return undefined;
}

import type { AgentToolResult } from "@theatechcorporation/pi-agent-core";
import { Type } from "typebox";
import type { ExtensionFactory } from "../extensions/types.ts";
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
				"Start a background a-coder-cli subagent to work on an independent task. Returns a subagent id that can be used with wait_subagent, get_subagent_status, and kill_subagent.",
			parameters: Type.Object({
				id: Type.String({ description: "Unique identifier for this subagent task. Use a short kebab-case slug." }),
				task: Type.String({ description: "The task prompt to send to the subagent." }),
				system_prompt: Type.Optional(Type.String({ description: "Optional system prompt override." })),
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
			async execute(_toolCallId, params, _signal): Promise<AgentToolResult<unknown>> {
				const config: SubagentConfig = {
					id: params.id as string,
					task: params.task as string,
					systemPrompt: (params.system_prompt as string | undefined) ?? undefined,
					provider: (params.provider as string | undefined) ?? options.defaultProvider,
					model: (params.model as string | undefined) ?? options.defaultModel,
					timeoutMs: (params.timeout_ms as number | undefined) ?? undefined,
					detached: (params.detached as boolean | undefined) ?? false,
				};
				const record = manager.spawn(config);
				if (!config.detached) {
					await manager.wait(config.id);
				}
				const updated = manager.get(config.id) ?? record;
				return {
					content: [{ type: "text", text: formatSubagentResult(updated) }],
					details: updated,
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

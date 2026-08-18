import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { getMemoryPath, getSessionMemoryPath, getWorkspaceMemoryPath } from "../../config.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export type MemoryScope = "global" | "workspace" | "session";

const memorySchema = Type.Object(
	{
		action: Type.Union(
			[
				Type.Literal("read", {
					description: "Read the full contents of the selected memory file.",
				}),
				Type.Literal("write", {
					description: "Replace the entire contents of the selected memory file with the provided content.",
				}),
				Type.Literal("append", {
					description: "Append the provided content to the end of the selected memory file.",
				}),
			],
			{
				description: "The action to perform on the persistent memory file.",
			},
		),
		scope: Type.Optional(
			Type.Union(
				[
					Type.Literal("global", {
						description:
							"Shared across every workspace and session (~/.a-coder-cli/MEMORY.md). Use for user preferences, project context, conventions, or any facts that should be available globally.",
					}),
					Type.Literal("workspace", {
						description:
							"Tied to the current workspace/project. Survives across sessions opened in the same project directory. Use for project-specific conventions, architecture decisions, or recurring context.",
					}),
					Type.Literal("session", {
						description:
							"Tied to the current session only. Persists across reloads/reconnects of the same session. Use for temporary notes, hypotheses, or task-specific context you want to keep for this conversation without polluting workspace/global memory.",
					}),
				],
				{
					description:
						'Which memory file to target. Defaults to "global". Use the narrowest scope that fits the information.',
				},
			),
		),
		content: Type.Optional(
			Type.String({
				description: "Content to write or append. Required for write/append, ignored for read.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type MemoryToolInput = Static<typeof memorySchema>;

const DEFAULT_MEMORY_CONTENT = `# Memory

Persistent notes shared across all a-coder workspaces.\n`;

function resolveMemoryPath(params: MemoryToolInput, context?: MemoryToolContext): string {
	const scope: MemoryScope = params.scope ?? "global";
	switch (scope) {
		case "workspace": {
			if (!context?.sessionDir) throw new Error("memory workspace scope requires a session directory");
			return getWorkspaceMemoryPath(context.sessionDir);
		}
		case "session": {
			if (!context?.sessionDir || !context?.sessionId) {
				throw new Error("memory session scope requires both a session directory and session id");
			}
			return getSessionMemoryPath(context.sessionDir, context.sessionId);
		}
		default:
			return getMemoryPath();
	}
}

async function ensureMemoryFile(path: string): Promise<string> {
	if (!existsSync(path)) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, DEFAULT_MEMORY_CONTENT, "utf-8");
	}
	return path;
}

export interface MemoryToolContext {
	sessionDir?: string;
	sessionId?: string;
}

export function createMemoryToolDefinition(): ToolDefinition<typeof memorySchema, undefined> {
	return {
		name: "memory",
		label: "memory",
		description:
			"Read or update persistent memory. Three scopes are available: global (shared across all workspaces and sessions), workspace (tied to the current project directory and survives across sessions there), and session (tied to the current conversation and survives reconnects/reloads of that session). Use the narrowest scope that fits the information.",
		promptSnippet: "Access persistent scoped memory",
		promptGuidelines: [
			"Use `memory` read with the appropriate scope to load context before starting a task if relevant.",
			"Prefer `workspace` scope for project-specific conventions, architecture notes, or recurring files.",
			"Prefer `session` scope for temporary notes, hypotheses, or task-specific context that should not pollute workspace/global memory.",
			"Use `memory` write/append only when the user explicitly asks you to remember or update something.",
		],
		parameters: memorySchema,
		async execute(_toolCallId, params: MemoryToolInput, _signal, _onUpdate, rawContext?: ExtensionContext) {
			const context = rawContext as MemoryToolContext | undefined;
			const path = await ensureMemoryFile(resolveMemoryPath(params, context));
			if (params.action === "read") {
				const content = await readFile(path, "utf-8");
				const text = content.trim() === "" ? "(memory file is empty)" : content;
				return {
					content: [
						{
							type: "text",
							text: `[Read from ${params.scope ?? "global"} memory (${path})]\n\n${text}`,
						} as TextContent,
					],
					details: undefined,
				};
			}

			if (typeof params.content !== "string") {
				throw new Error(`memory ${params.action} requires a content argument`);
			}

			if (params.action === "write") {
				await writeFile(path, params.content, "utf-8");
				return {
					content: [
						{
							type: "text",
							text: `[${params.scope ?? "global"} memory updated (${path})]\nWrote ${params.content.length} characters.`,
						} as TextContent,
					],
					details: undefined,
				};
			}

			// append
			const piece = params.content.endsWith("\n") ? params.content : `${params.content}\n`;
			await appendFile(path, piece, "utf-8");
			return {
				content: [
					{
						type: "text",
						text: `[Appended to ${params.scope ?? "global"} memory (${path})]\nAdded ${piece.length} characters.`,
					} as TextContent,
				],
				details: undefined,
			};
		},
		renderCall(args, theme, _context) {
			const text = new Text("", 0, 0);
			const scope = args?.scope ?? "global";
			text.setText(`${theme.fg("toolTitle", theme.bold("memory"))} ${theme.fg("accent", `${args?.action ?? "read"}:${scope}`)}`);
			return text;
		},
		renderResult(result, _options, theme, _context) {
			const text = new Text("", 0, 0);
			const output = result.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			text.setText(theme.fg("toolOutput", output));
			return text;
		},
	};
}

export function createMemoryTool(context?: MemoryToolContext): AgentTool<typeof memorySchema> {
	return wrapToolDefinition(createMemoryToolDefinition(), () => context as ExtensionContext);
}

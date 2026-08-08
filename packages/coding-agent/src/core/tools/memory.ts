import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { getMemoryPath } from "../../config.ts";
import { Text } from "@earendil-works/pi-tui";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const memorySchema = Type.Object(
	{
		action: Type.Union(
			[
				Type.Literal("read", {
					description: "Read the full contents of MEMORY.md.",
				}),
				Type.Literal("write", {
					description: "Replace the entire contents of MEMORY.md with the provided content.",
				}),
				Type.Literal("append", {
					description: "Append the provided content to the end of MEMORY.md.",
				}),
			],
			{
				description: "The action to perform on the persistent memory file.",
			},
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

async function ensureMemoryFile(): Promise<string> {
	const path = getMemoryPath();
	if (!existsSync(path)) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, DEFAULT_MEMORY_CONTENT, "utf-8");
	}
	return path;
}

export function createMemoryToolDefinition(): ToolDefinition<typeof memorySchema, undefined> {
	return {
		name: "memory",
		label: "memory",
		description:
			"Read or update the persistent MEMORY.md file stored in ~/.a-coder-cli. This memory is shared across every workspace and survives across sessions. Use it to remember user preferences, project context, conventions, or any facts that should be available globally. Read it at the start of a task if it may contain useful context; update it when the user asks you to remember something permanently.",
		promptSnippet: "Access persistent cross-workspace memory",
		promptGuidelines: [
			"Use `memory` read to load global context before starting a task if relevant.",
			"Use `memory` write/append only when the user explicitly asks to remember or update something.",
		],
		parameters: memorySchema,
		async execute(_toolCallId, params: MemoryToolInput) {
			const path = await ensureMemoryFile();
			if (params.action === "read") {
				const content = await readFile(path, "utf-8");
				const text = content.trim() === "" ? "(memory file is empty)" : content;
				return {
					content: [
						{
							type: "text",
							text: `[Read from persistent memory (${path})]\n\n${text}`,
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
							text: `[Persistent memory updated (${path})]\nWrote ${params.content.length} characters.`,
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
						text: `[Appended to persistent memory (${path})]\nAdded ${piece.length} characters.`,
					} as TextContent,
				],
				details: undefined,
			};
		},
		renderCall(args, theme, _context) {
			const text = new Text("", 0, 0);
			text.setText(`${theme.fg("toolTitle", theme.bold("memory"))} ${theme.fg("accent", args?.action ?? "read")}`);
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

export function createMemoryTool(): AgentTool<typeof memorySchema> {
	return wrapToolDefinition(createMemoryToolDefinition());
}

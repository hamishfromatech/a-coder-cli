import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Text } from "@earendil-works/pi-tui";
import { execFile, spawn } from "child_process";
import path from "path";
import { type Static, Type } from "typebox";
import { promisify } from "util";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { ensureTool } from "../../utils/tools-manager.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { resolveToCwd } from "./path-utils.ts";
import { getTextOutput, invalidArgText, shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
	truncateHead,
	truncateLine,
} from "./truncate.ts";

const grepSchema = Type.Object(
	{
		pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
		path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
		glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
		ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
		literal: Type.Optional(
			Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" }),
		),
		context: Type.Optional(
			Type.Number({ description: "Number of lines to show before and after each match (default: 0)" }),
		),
		limit: Type.Optional(
			Type.Number({ minimum: 1, description: "Maximum number of matches to return (default: 100)" }),
		),
	},
	{ additionalProperties: false },
);

export type GrepToolInput = Static<typeof grepSchema>;

function prepareGrepArguments(input: unknown): GrepToolInput {
	if (!input || typeof input !== "object") {
		return input as GrepToolInput;
	}

	const args = input as Record<string, unknown>;
	if (typeof args.path === "string" || typeof args.file_path !== "string") {
		return args as GrepToolInput;
	}

	const { file_path, ...rest } = args;
	return { ...rest, path: file_path } as GrepToolInput;
}
const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	linesTruncated?: boolean;
	/** Set when the search ran through the grep(1) fallback (ripgrep unavailable). */
	grepFallbackUsed?: boolean;
}

/**
 * Pluggable operations for the grep tool.
 * Override these to delegate search to remote systems (for example SSH).
 */
export interface GrepOperations {
	/** Check if path is a directory. Throws if path does not exist. */
	isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
	/** Read file contents for context lines */
	readFile: (absolutePath: string) => Promise<string> | string;
}

const defaultGrepOperations: GrepOperations = {
	isDirectory: async (p) => (await fsStat(p)).isDirectory(),
	readFile: (p) => fsReadFile(p, "utf-8"),
};

const execFileAsync = promisify(execFile);

/**
 * Result of running the grep(1) fallback used when ripgrep is unavailable.
 */
export interface GrepFallbackResult {
	/** Formatted output lines (same `path:line: text` shape as the ripgrep path). */
	outputLines: string[];
	matchCount: number;
	matchLimitReached: boolean;
	linesTruncated: boolean;
}

/**
 * Build grep(1) arguments mirroring the common subset of the ripgrep path's
 * input. Uses ERE (`-E`) as the closest match for ripgrep's regex flavor.
 */
export function buildGrepFallbackArguments(input: {
	pattern: string;
	ignoreCase?: boolean;
	literal?: boolean;
	glob?: string;
	context?: number;
	searchPath: string;
}): string[] {
	const args = input.literal ? ["-R", "-n", "-F"] : ["-R", "-n", "-E"];
	if (input.ignoreCase) args.push("-i");
	if (input.glob) args.push("--include", input.glob);
	if (input.context && input.context > 0) args.push("-C", String(Math.floor(input.context)));
	args.push("--", input.pattern, input.searchPath);
	return args;
}

/**
 * grep(1) fallback for environments where ripgrep cannot be provisioned
 * (offline mode, Termux, failed download). Output shape matches the ripgrep
 * path so consumers see the same format. Difference vs ripgrep, stated in the
 * tool's fallback notice: grep(1) does not respect .gitignore.
 */
export async function runGrepFallback(
	input: {
		pattern: string;
		ignoreCase?: boolean;
		literal?: boolean;
		glob?: string;
		context?: number;
	},
	searchPath: string,
	effectiveLimit: number,
	signal?: AbortSignal,
): Promise<GrepFallbackResult> {
	const args = buildGrepFallbackArguments({ ...input, searchPath });
	let stdout: string;
	try {
		const result = await execFileAsync("grep", args, {
			maxBuffer: 8 * 1024 * 1024,
			signal,
			windowsHide: true,
		});
		stdout = result.stdout;
	} catch (error: unknown) {
		const err = error as { code?: number | string; killed?: boolean; message?: string };
		if (err?.code === 1) {
			// grep exit code 1 = no matches.
			return { outputLines: [], matchCount: 0, matchLimitReached: false, linesTruncated: false };
		}
		if (err?.killed) {
			throw new Error("Operation aborted");
		}
		throw new Error(err?.message ?? "grep (1) fallback failed");
	}

	const searchIsFile = !(await fsStat(searchPath)
		.then((s) => s.isDirectory())
		.catch(() => false));
	const baseDir = searchIsFile ? path.dirname(searchPath) : searchPath;
	const matchLineRe = /^(.+?):(\d+):(.*)$/;
	const contextLineRe = /^(.+?)-(\d+)-(.*)$/;

	const outputLines: string[] = [];
	let matchCount = 0;
	let matchLimitReached = false;
	let linesTruncated = false;

	for (const rawLine of stdout.split("\n")) {
		if (!rawLine) continue;
		const match = matchLineRe.exec(rawLine);
		const contextMatch = !match || matchCount >= effectiveLimit ? contextLineRe.exec(rawLine) : undefined;
		const parsed = match ?? contextMatch;
		if (!parsed) {
			// "Binary file X matches" and other non path lines pass through
			// while matches still fit within the limit.
			if (matchCount < effectiveLimit) outputLines.push(rawLine);
			continue;
		}
		if (matchCount >= effectiveLimit && !contextMatch) {
			matchLimitReached = true;
			continue;
		}
		const [, filePath, lineNumber, lineTextRaw] = parsed;
		const displayPath = relativeDisplayPath(baseDir, filePath);
		const { text: truncatedText, wasTruncated } = truncateLine(lineTextRaw.replace(/\r/g, ""));
		if (wasTruncated) linesTruncated = true;
		if (contextMatch) {
			outputLines.push(`${displayPath}-${lineNumber}- ${truncatedText}`);
		} else {
			outputLines.push(`${displayPath}:${lineNumber}: ${truncatedText}`);
			matchCount++;
		}
	}

	matchLimitReached = matchCount >= effectiveLimit;
	return { outputLines, matchCount, matchLimitReached, linesTruncated };
}

function relativeDisplayPath(baseDir: string, filePath: string): string {
	const rel = path.relative(baseDir, filePath);
	return rel && !rel.startsWith("..") ? rel.replace(/\\/g, "/") : path.basename(filePath);
}

export interface GrepToolOptions {
	/** Custom operations for grep. Default: local filesystem plus ripgrep */
	operations?: GrepOperations;
}

function formatGrepCall(
	args: { pattern: string; path?: string; glob?: string; limit?: number } | undefined,
	theme: Theme,
): string {
	const pattern = str(args?.pattern);
	const rawPath = str(args?.path);
	const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
	const glob = str(args?.glob);
	const limit = args?.limit;
	const invalidArg = invalidArgText(theme);
	let text =
		theme.fg("toolTitle", theme.bold("grep")) +
		" " +
		(pattern === null ? invalidArg : theme.fg("accent", `/${pattern || ""}/`)) +
		theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
	if (glob) text += theme.fg("toolOutput", ` (${glob})`);
	if (limit !== undefined) text += theme.fg("toolOutput", ` limit ${limit}`);
	return text;
}

function formatGrepResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: GrepToolDetails;
	},
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	let text = "";
	if (output) {
		const lines = output.split("\n");
		const maxLines = options.expanded ? lines.length : 15;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
	}

	const matchLimit = result.details?.matchLimitReached;
	const truncation = result.details?.truncation;
	const linesTruncated = result.details?.linesTruncated;
	if (matchLimit || truncation?.truncated || linesTruncated) {
		const warnings: string[] = [];
		if (matchLimit) warnings.push(`${matchLimit} matches limit`);
		if (truncation?.truncated) warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
		if (linesTruncated) warnings.push("some lines truncated");
		text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

export function createGrepToolDefinition(
	cwd: string,
	options?: GrepToolOptions,
): ToolDefinition<typeof grepSchema, GrepToolDetails | undefined> {
	const customOps = options?.operations;
	return {
		name: "grep",
		label: "grep",
		description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
		promptSnippet: "Search file contents for patterns (respects .gitignore)",
		parameters: grepSchema,
		prepareArguments: prepareGrepArguments,
		async execute(
			_toolCallId,
			{
				pattern,
				path: searchDir,
				glob,
				ignoreCase,
				literal,
				context,
				limit,
			}: {
				pattern: string;
				path?: string;
				glob?: string;
				ignoreCase?: boolean;
				literal?: boolean;
				context?: number;
				limit?: number;
			},
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			return new Promise((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}
				let settled = false;
				const settle = (fn: () => void) => {
					if (!settled) {
						settled = true;
						fn();
					}
				};

				(async () => {
					try {
						const searchPath = resolveToCwd(searchDir || ".", cwd);
						const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
						const rgPath = await ensureTool("rg", true);
						if (!rgPath) {
							// grep(1) fallback: ripgrep could not be provisioned (offline
							// mode, Termux, failed download). Same output contract, with a
							// notice about the weaker ignore/gitignore behavior.
							const fallback = await runGrepFallback(
								{ pattern, ignoreCase, literal, glob, context },
								searchPath,
								effectiveLimit,
								signal,
							);
							const rawOutput = fallback.outputLines.join("\n");
							const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
							const details: GrepToolDetails = { grepFallbackUsed: true };
							let output = truncation.content;
							if (fallback.outputLines.length === 0) {
								output = "No matches found";
							} else {
								const notices: string[] = [
									"ripgrep unavailable \u2014 searched with grep (1); .gitignore not applied",
								];
								if (fallback.matchLimitReached) {
									notices.push(
										`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
									);
									details.matchLimitReached = effectiveLimit;
								}
								if (truncation.truncated) {
									notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
									details.truncation = truncation;
								}
								if (fallback.linesTruncated) {
									notices.push(
										`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
									);
									details.linesTruncated = true;
								}
								output += `\n\n[${notices.join(". ")}]`;
							}
							settle(() => resolve({ content: [{ type: "text", text: output }], details }));
							return;
						}

						const ops = customOps ?? defaultGrepOperations;
						let isDirectory: boolean;
						try {
							isDirectory = await ops.isDirectory(searchPath);
						} catch {
							settle(() => reject(new Error(`Path not found: ${searchPath}`)));
							return;
						}

						const contextValue = context && context > 0 ? context : 0;
						const formatPath = (filePath: string): string => {
							if (isDirectory) {
								const relative = path.relative(searchPath, filePath);
								if (relative && !relative.startsWith("..")) {
									return relative.replace(/\\/g, "/");
								}
							}
							return path.basename(filePath);
						};

						const fileCache = new Map<string, string[]>();
						const getFileLines = async (filePath: string): Promise<string[]> => {
							let lines = fileCache.get(filePath);
							if (!lines) {
								try {
									const content = await ops.readFile(filePath);
									lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
								} catch {
									lines = [];
								}
								fileCache.set(filePath, lines);
							}
							return lines;
						};

						const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"];
						if (ignoreCase) args.push("--ignore-case");
						if (literal) args.push("--fixed-strings");
						if (glob) args.push("--glob", glob);
						args.push("--", pattern, searchPath);

						const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
						const rl = createInterface({ input: child.stdout });
						let stderr = "";
						let matchCount = 0;
						let matchLimitReached = false;
						let linesTruncated = false;
						let aborted = false;
						let killedDueToLimit = false;
						const outputLines: string[] = [];

						const cleanup = () => {
							rl.close();
							signal?.removeEventListener("abort", onAbort);
						};
						const stopChild = (dueToLimit = false) => {
							if (!child.killed) {
								killedDueToLimit = dueToLimit;
								child.kill();
							}
						};
						const onAbort = () => {
							aborted = true;
							stopChild();
						};
						signal?.addEventListener("abort", onAbort, { once: true });
						child.stderr?.on("data", (chunk) => {
							stderr += chunk.toString();
						});

						const formatBlock = async (filePath: string, lineNumber: number): Promise<string[]> => {
							const relativePath = formatPath(filePath);
							const lines = await getFileLines(filePath);
							if (!lines.length) return [`${relativePath}:${lineNumber}: (unable to read file)`];
							const block: string[] = [];
							const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
							const end = contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;
							for (let current = start; current <= end; current++) {
								const lineText = lines[current - 1] ?? "";
								const sanitized = lineText.replace(/\r/g, "");
								const isMatchLine = current === lineNumber;
								// Truncate long lines so grep output stays compact.
								const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
								if (wasTruncated) linesTruncated = true;
								if (isMatchLine) block.push(`${relativePath}:${current}: ${truncatedText}`);
								else block.push(`${relativePath}-${current}- ${truncatedText}`);
							}
							return block;
						};

						// Collect matches during streaming, then format them after rg exits.
						const matches: Array<{ filePath: string; lineNumber: number; lineText?: string }> = [];
						rl.on("line", (line) => {
							if (!line.trim() || matchCount >= effectiveLimit) return;
							let event: any;
							try {
								event = JSON.parse(line);
							} catch {
								return;
							}
							if (event.type === "match") {
								matchCount++;
								const filePath = event.data?.path?.text;
								const lineNumber = event.data?.line_number;
								const lineText = event.data?.lines?.text;
								if (filePath && typeof lineNumber === "number")
									matches.push({ filePath, lineNumber, lineText });
								if (matchCount >= effectiveLimit) {
									matchLimitReached = true;
									stopChild(true);
								}
							}
						});

						child.on("error", (error) => {
							cleanup();
							settle(() => reject(new Error(`Failed to run ripgrep: ${error.message}`)));
						});
						child.on("close", async (code) => {
							cleanup();
							if (aborted) {
								settle(() => reject(new Error("Operation aborted")));
								return;
							}
							if (!killedDueToLimit && code !== 0 && code !== 1) {
								const errorMsg = stderr.trim() || `ripgrep exited with code ${code}`;
								settle(() => reject(new Error(errorMsg)));
								return;
							}
							if (matchCount === 0) {
								settle(() =>
									resolve({ content: [{ type: "text", text: "No matches found" }], details: undefined }),
								);
								return;
							}

							// Format matches after streaming finishes so custom readFile() backends can be async.
							for (const match of matches) {
								if (contextValue === 0 && match.lineText !== undefined) {
									const relativePath = formatPath(match.filePath);
									const sanitized = match.lineText
										.replace(/\r\n/g, "\n")
										.replace(/\r/g, "")
										.replace(/\n$/, "");
									const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
									if (wasTruncated) linesTruncated = true;
									outputLines.push(`${relativePath}:${match.lineNumber}: ${truncatedText}`);
								} else {
									const block = await formatBlock(match.filePath, match.lineNumber);
									outputLines.push(...block);
								}
							}

							const rawOutput = outputLines.join("\n");
							// Apply byte truncation. There is no line limit here because the match limit already capped rows.
							const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
							let output = truncation.content;
							const details: GrepToolDetails = {};
							// Build actionable notices for truncation and match limits.
							const notices: string[] = [];
							if (matchLimitReached) {
								notices.push(
									`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
								);
								details.matchLimitReached = effectiveLimit;
							}
							if (truncation.truncated) {
								notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
								details.truncation = truncation;
							}
							if (linesTruncated) {
								notices.push(
									`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
								);
								details.linesTruncated = true;
							}
							if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
							settle(() =>
								resolve({
									content: [{ type: "text", text: output }],
									details: Object.keys(details).length > 0 ? details : undefined,
								}),
							);
						});
					} catch (err) {
						settle(() => reject(err as Error));
					}
				})();
			});
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatGrepCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatGrepResult(result as any, options, theme, context.showImages));
			return text;
		},
	};
}

export function createGrepTool(cwd: string, options?: GrepToolOptions): AgentTool<typeof grepSchema> {
	return wrapToolDefinition(createGrepToolDefinition(cwd, options));
}

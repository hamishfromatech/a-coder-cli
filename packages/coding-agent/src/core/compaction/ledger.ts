/**
 * Durable session ledger and post-compaction handover.
 *
 * The ledger is deliberately not produced by the narrative summarizer. It is
 * rendered into the compaction summary as a deterministic block, stripped
 * before the next summarization pass, and merged back afterwards. That keeps
 * user constraints, locked decisions, and failed attempts stable across any
 * number of compactions.
 */

import { execFile } from "node:child_process";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface SessionLedgerDecision {
	id: string;
	text: string;
	rationale?: string;
	files?: string[];
}

export interface SessionLedgerFailure {
	command: string;
	error: string;
	count: number;
}

export interface SessionLedger {
	version: 1;
	epoch: number;
	constraints: string[];
	decisions: SessionLedgerDecision[];
	failedAttempts: SessionLedgerFailure[];
}

export interface SessionLedgerPatch {
	constraints: string[];
	decisions: SessionLedgerDecision[];
	failedAttempts: SessionLedgerFailure[];
}

export interface LedgerCandidates extends SessionLedgerPatch {
	/** True when a lightweight model pass is worth running for constraints/decisions. */
	needsModelExtraction: boolean;
}

const MAX_CONSTRAINTS = 40;
const MAX_DECISIONS = 30;
const MAX_FAILURES = 20;
const MAX_CONSTRAINT_CHARS = 600;
const MAX_ERROR_CHARS = 500;
const MAX_LEDGER_SOURCE_CHARS = 24_000;

const CONSTRAINT_CUE =
	/\b(don't|do not|never|always|must|only|avoid|remember|keep|prefer|from now on|actually|instead|stop|leave|no need|make sure|ensure)\b/i;
const USE_CONSTRAINT_CUE = /^\s*(?:please\s+)?(?:use|switch to|stick with)\b/i;
const DECISION_CUE =
	/\b(decided|decision|chose|choose|pivot|pivoted|switch(?:ed|ing)? to|we'll use|i'll use|going with|approach)\b/i;

function emptyLedger(epoch: number): SessionLedger {
	return { version: 1, epoch, constraints: [], decisions: [], failedAttempts: [] };
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function key(text: string): string {
	return normalizeText(text)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function clip(text: string, max: number): string {
	const normalized = normalizeText(text);
	return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function messageText(message: AgentMessage): string {
	if (!("content" in message)) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function isToolCallBlock(block: unknown): block is { type: "toolCall"; id: string; name: string; arguments: unknown } {
	if (typeof block !== "object" || block === null) return false;
	if (!("type" in block) || block.type !== "toolCall") return false;
	return "id" in block && "name" in block && "arguments" in block;
}

function formatToolCall(name: string, args: unknown): string {
	if (typeof args !== "object" || args === null) return name;
	const entries = Object.entries(args as Record<string, unknown>).map(
		([key, value]) => `${key}=${JSON.stringify(value)}`,
	);
	return `${name}(${entries.join(", ")})`;
}

/**
 * Pull high-signal candidates out of the turns that are about to be evicted.
 * Failed tool calls and explicit user constraints are deterministic; the model
 * pass is only needed when there are semantic candidates to resolve.
 */
export function extractLedgerCandidates(messages: AgentMessage[]): LedgerCandidates {
	const constraints: string[] = [];
	const decisions: SessionLedgerDecision[] = [];
	const failedAttempts: SessionLedgerFailure[] = [];
	const toolCalls = new Map<string, { name: string; args: unknown }>();
	let needsModelExtraction = false;

	for (const message of messages) {
		if (message.role === "user") {
			const text = normalizeText(messageText(message));
			if (text && (CONSTRAINT_CUE.test(text) || USE_CONSTRAINT_CUE.test(text))) {
				constraints.push(clip(text, MAX_CONSTRAINT_CHARS));
				needsModelExtraction = true;
			}
			continue;
		}

		if (message.role === "assistant") {
			const text = normalizeText(messageText(message));
			if (text && DECISION_CUE.test(text)) {
				needsModelExtraction = true;
			}
			if (!("content" in message) || !Array.isArray(message.content)) continue;
			for (const block of message.content) {
				if (isToolCallBlock(block)) {
					toolCalls.set(block.id, { name: block.name, args: block.arguments });
				}
			}
			continue;
		}

		if (message.role !== "toolResult") continue;
		const result = message as {
			toolCallId?: string;
			toolName?: string;
			isError?: boolean;
			content?: string | Array<{ type: string; text?: string }>;
		};
		if (!result.isError) continue;
		const call = result.toolCallId ? toolCalls.get(result.toolCallId) : undefined;
		const command = call ? formatToolCall(call.name, call.args) : (result.toolName ?? "tool");
		const error = clip(
			typeof result.content === "string"
				? result.content
				: (result.content ?? [])
						.filter((block): block is { type: "text"; text: string } => block.type === "text" && !!block.text)
						.map((block) => block.text)
						.join("\n"),
			MAX_ERROR_CHARS,
		);
		failedAttempts.push({ command, error: error || "tool failed without an error message", count: 1 });
	}

	return { constraints, decisions, failedAttempts, needsModelExtraction };
}

/** Serialize the evicted turns for the lightweight ledger extraction pass. */
export function serializeLedgerSource(messages: AgentMessage[]): string {
	const parts: string[] = [];
	const toolCalls = new Map<string, { name: string; args: unknown }>();

	for (const message of messages) {
		if (message.role === "user") {
			const text = messageText(message);
			if (text) parts.push(`[User]\n${text}`);
			continue;
		}
		if (message.role === "assistant") {
			const text = messageText(message);
			if (text) parts.push(`[Assistant]\n${text}`);
			if (!("content" in message) || !Array.isArray(message.content)) continue;
			for (const block of message.content) {
				if (!isToolCallBlock(block)) continue;
				toolCalls.set(block.id, { name: block.name, args: block.arguments });
				parts.push(`[Tool call] ${formatToolCall(block.name, block.arguments)}`);
			}
			continue;
		}
		if (message.role !== "toolResult") continue;
		const result = message as {
			toolCallId?: string;
			toolName?: string;
			isError?: boolean;
			content?: string | Array<{ type: string; text?: string }>;
		};
		const call = result.toolCallId ? toolCalls.get(result.toolCallId) : undefined;
		const text =
			typeof result.content === "string"
				? result.content
				: (result.content ?? [])
						.filter((block): block is { type: "text"; text: string } => block.type === "text" && !!block.text)
						.map((block) => block.text)
						.join("\n");
		if (!text) continue;
		const label = call ? formatToolCall(call.name, call.args) : (result.toolName ?? "tool");
		parts.push(`[Tool ${result.isError ? "error" : "result"}] ${label}\n${clip(text, 1_000)}`);
	}

	const source = parts.join("\n\n");
	if (source.length <= MAX_LEDGER_SOURCE_CHARS) return source;
	const head = source.slice(0, Math.floor(MAX_LEDGER_SOURCE_CHARS * 0.65));
	const tail = source.slice(-Math.floor(MAX_LEDGER_SOURCE_CHARS * 0.35));
	return `${head}\n\n[... middle of evicted history omitted ...]\n\n${tail}`;
}

export function mergeLedgers(base: SessionLedger | undefined, patch: SessionLedgerPatch, epoch: number): SessionLedger {
	const merged = base
		? {
				...base,
				constraints: [...base.constraints],
				decisions: [...base.decisions],
				failedAttempts: [...base.failedAttempts],
			}
		: emptyLedger(epoch);

	const seenConstraints = new Set(merged.constraints.map(key));
	for (const constraint of patch.constraints) {
		const normalized = normalizeText(constraint);
		const constraintKey = key(normalized);
		if (!normalized || seenConstraints.has(constraintKey)) continue;
		seenConstraints.add(constraintKey);
		merged.constraints.push(clip(normalized, MAX_CONSTRAINT_CHARS));
	}
	merged.constraints = merged.constraints.slice(-MAX_CONSTRAINTS);

	const seenDecisions = new Set(merged.decisions.map((decision) => key(decision.text)));
	for (const decision of patch.decisions) {
		const text = normalizeText(decision.text);
		const decisionKey = key(text);
		if (!text || seenDecisions.has(decisionKey)) continue;
		seenDecisions.add(decisionKey);
		merged.decisions.push({
			id: decision.id || `D${merged.decisions.length + 1}`,
			text: clip(text, MAX_CONSTRAINT_CHARS),
			...(decision.rationale ? { rationale: clip(decision.rationale, MAX_ERROR_CHARS) } : {}),
			...(decision.files && decision.files.length > 0
				? { files: decision.files.map(normalizeText).filter(Boolean) }
				: {}),
		});
	}
	merged.decisions = merged.decisions.slice(-MAX_DECISIONS);

	// The error signature is the stable identity. The command may be a generic
	// tool name in the deterministic pass and a concrete command in the model
	// pass, so merge on the error and prefer the more specific command.
	const failureIndex = new Map(
		merged.failedAttempts.map((failure, index) => [key(failure.error) || key(failure.command), index]),
	);
	for (const failure of patch.failedAttempts) {
		const command = normalizeText(failure.command);
		const error = clip(failure.error, MAX_ERROR_CHARS);
		if (!command && !error) continue;
		const failureKey = key(error) || key(command);
		const existingIndex = failureIndex.get(failureKey);
		if (existingIndex !== undefined) {
			const existing = merged.failedAttempts[existingIndex];
			existing.count += Math.max(1, failure.count || 1);
			if (command.length > existing.command.length) existing.command = command;
			continue;
		}
		failureIndex.set(failureKey, merged.failedAttempts.length);
		merged.failedAttempts.push({
			command: command || "tool",
			error: error || "failed",
			count: Math.max(1, failure.count || 1),
		});
	}
	merged.failedAttempts = merged.failedAttempts.slice(-MAX_FAILURES);
	merged.epoch = epoch;
	return merged;
}

function section(summary: string, heading: string): string {
	const start = summary.indexOf(heading);
	if (start < 0) return "";
	const bodyStart = summary.indexOf("\n", start);
	if (bodyStart < 0) return "";
	const nextHeading = summary.indexOf("\n## ", bodyStart + 1);
	return summary.slice(bodyStart + 1, nextHeading < 0 ? summary.length : nextHeading);
}

function parseLegacySummary(summary: string, epoch: number): SessionLedger | undefined {
	const constraints = section(summary, "## Constraints & Preferences")
		.split("\n")
		.map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
		.filter((line) => line && !/^\(none\)$/i.test(line));
	const decisions = section(summary, "## Key Decisions")
		.split("\n")
		.map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
		.filter((line) => line && !/^\(none\)$/i.test(line))
		.map((line, index) => {
			const match = line.match(/^\*\*(.+?)\*\*(?::\s*(.*))?$/);
			return {
				id: `D${index + 1}`,
				text: (match?.[1] ?? line).trim(),
				...(match?.[2] ? { rationale: match[2].trim() } : {}),
			};
		});
	if (constraints.length === 0 && decisions.length === 0) return undefined;
	return { version: 1, epoch, constraints, decisions, failedAttempts: [] };
}

function validStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
}

/** Parse the deterministic ledger block, falling back to legacy summary sections. */
export function parseSessionLedger(summary: string, epoch = 1): SessionLedger | undefined {
	const match = summary.match(/<session_ledger[^>]*>\s*([\s\S]*?)\s*<\/session_ledger>/i);
	if (match) {
		try {
			const parsed = JSON.parse(match[1]) as Partial<SessionLedger>;
			const constraints = validStringArray(parsed.constraints);
			const decisions = Array.isArray(parsed.decisions)
				? parsed.decisions
						.filter(
							(decision): decision is SessionLedgerDecision =>
								typeof decision === "object" && decision !== null && typeof decision.text === "string",
						)
						.map((decision, index) => ({
							id: typeof decision.id === "string" ? decision.id : `D${index + 1}`,
							text: decision.text,
							...(typeof decision.rationale === "string" ? { rationale: decision.rationale } : {}),
							...(validStringArray(decision.files).length > 0
								? { files: validStringArray(decision.files) }
								: {}),
						}))
				: [];
			const failedAttempts = Array.isArray(parsed.failedAttempts)
				? parsed.failedAttempts
						.filter(
							(failure): failure is SessionLedgerFailure =>
								typeof failure === "object" &&
								failure !== null &&
								typeof failure.command === "string" &&
								typeof failure.error === "string",
						)
						.map((failure) => ({ ...failure, count: typeof failure.count === "number" ? failure.count : 1 }))
				: [];
			return {
				version: 1,
				epoch: typeof parsed.epoch === "number" ? parsed.epoch : epoch,
				constraints,
				decisions,
				failedAttempts,
			};
		} catch {
			// Fall through to legacy parsing.
		}
	}
	return parseLegacySummary(summary, epoch);
}

/** Remove deterministic state blocks before handing a summary to the next LLM pass. */
export function stripCompactionState(summary: string): string {
	return summary
		.replace(/<session_ledger[^>]*>[\s\S]*?<\/session_ledger>/gi, "")
		.replace(/<workspace_state>[\s\S]*?<\/workspace_state>/gi, "")
		.replace(/<compaction_handover>[\s\S]*?<\/compaction_handover>/gi, "")
		.trim();
}

function escapeBlock(text: string): string {
	return text.replace(/<\//g, "<\\/");
}

export function renderSessionLedgerBlock(ledger: SessionLedger): string {
	const json = escapeBlock(JSON.stringify(ledger, null, 2));
	return `<session_ledger epoch="${ledger.epoch}">\n${json}\n</session_ledger>`;
}

export function renderHandover(epoch: number): string {
	return `<compaction_handover>
[Context Compacted — Epoch ${epoch}. Earlier turns and tool outputs before the retained recent window have been archived. Review <session_ledger> above for locked decisions, user constraints, and failed attempts before acting. Re-read a file before editing when exact line numbers are outside the retained recent window.]
</compaction_handover>`;
}

/**
 * Append deterministic state to the narrative summary. The next compaction
 * strips these blocks before summarization and merges the ledger again.
 */
export function appendCompactionState(summary: string, ledger: SessionLedger, workspaceState?: string): string {
	const blocks = [renderSessionLedgerBlock(ledger)];
	if (workspaceState) {
		blocks.push(`<workspace_state>\n${escapeBlock(workspaceState)}\n</workspace_state>`);
	}
	blocks.push(renderHandover(ledger.epoch));
	return `${summary.trimEnd()}\n\n${blocks.join("\n\n")}`;
}

export function parseLedgerPatch(text: string): SessionLedgerPatch | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		const parsed = JSON.parse(text.slice(start, end + 1)) as {
			constraints?: unknown;
			decisions?: unknown;
			failedAttempts?: unknown;
		};
		const constraints = validStringArray(parsed.constraints);
		const decisions = Array.isArray(parsed.decisions)
			? parsed.decisions
					.map((decision, index): SessionLedgerDecision | undefined => {
						if (typeof decision === "string") return { id: `D${index + 1}`, text: decision };
						if (typeof decision !== "object" || decision === null) return undefined;
						const value = decision as { id?: unknown; text?: unknown; rationale?: unknown; files?: unknown };
						if (typeof value.text !== "string") return undefined;
						return {
							id: typeof value.id === "string" ? value.id : `D${index + 1}`,
							text: value.text,
							...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
							...(validStringArray(value.files).length > 0 ? { files: validStringArray(value.files) } : {}),
						};
					})
					.filter((decision): decision is SessionLedgerDecision => decision !== undefined)
			: [];
		const failedAttempts = Array.isArray(parsed.failedAttempts)
			? parsed.failedAttempts
					.map((failure): SessionLedgerFailure | undefined => {
						if (typeof failure === "string") return { command: failure, error: "failed", count: 1 };
						if (typeof failure !== "object" || failure === null) return undefined;
						const value = failure as { command?: unknown; error?: unknown; count?: unknown };
						if (typeof value.command !== "string" || typeof value.error !== "string") return undefined;
						return {
							command: value.command,
							error: value.error,
							count: typeof value.count === "number" ? value.count : 1,
						};
					})
					.filter((failure): failure is SessionLedgerFailure => failure !== undefined)
			: [];
		if (constraints.length === 0 && decisions.length === 0 && failedAttempts.length === 0) return undefined;
		return { constraints, decisions, failedAttempts };
	} catch {
		return undefined;
	}
}

function runGit(cwd: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["-C", cwd, ...args],
			{ timeout: 3_000, maxBuffer: 512 * 1024, encoding: "utf8", windowsHide: true },
			(error, stdout) => {
				if (error) {
					resolve(undefined);
					return;
				}
				resolve(stdout);
			},
		);
	});
}

function capLines(text: string, maxLines: number): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length <= maxLines) return lines.join("\n");
	return `${lines.slice(0, maxLines).join("\n")}\n... (${lines.length - maxLines} more lines)`;
}

/** Capture live workspace truth at the compaction boundary. */
export async function readWorkspaceState(cwd: string): Promise<string | undefined> {
	const [status, diffStat] = await Promise.all([runGit(cwd, ["status", "--short"]), runGit(cwd, ["diff", "--stat"])]);
	if (status === undefined && diffStat === undefined) return undefined;
	const sections: string[] = [];
	sections.push(`git status --short:\n${status?.trim() ? capLines(status, 80) : "(clean)"}`);
	if (diffStat?.trim()) sections.push(`git diff --stat:\n${capLines(diffStat, 40)}`);
	return sections.join("\n\n");
}

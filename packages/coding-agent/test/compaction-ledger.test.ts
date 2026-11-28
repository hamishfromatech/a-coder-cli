import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendCompactionState,
	type CompactionPreparation,
	compact,
	extractLedgerCandidates,
	mergeLedgers,
	parseSessionLedger,
	readWorkspaceState,
	stripCompactionState,
} from "../src/core/compaction/index.ts";

const { completeSimpleMock } = vi.hoisted(() => ({
	completeSimpleMock: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-ai/compat")>();
	return {
		...actual,
		completeSimple: completeSimpleMock,
	};
});

function createModel(): Model<"anthropic-messages"> {
	return {
		id: "test-model",
		name: "Test Model",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8_192,
	};
}

function assistantText(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
		usage: {
			input: 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 20,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("session ledger", () => {
	beforeEach(() => {
		completeSimpleMock.mockReset();
	});

	it("extracts constraints and repeated tool failures without losing exact errors", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Use pnpm, never npm. Don't touch the legacy API.", timestamp: Date.now() },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "bash",
						arguments: { command: "pnpm test" },
					},
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 10,
					output: 10,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 20,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "bash",
				content: [{ type: "text", text: "ReferenceError: window is not defined" }],
				isError: true,
				timestamp: Date.now(),
			},
		];

		const candidates = extractLedgerCandidates(messages);

		expect(candidates.constraints).toEqual(["Use pnpm, never npm. Don't touch the legacy API."]);
		expect(candidates.needsModelExtraction).toBe(true);
		expect(candidates.failedAttempts).toEqual([
			{ command: 'bash(command="pnpm test")', error: "ReferenceError: window is not defined", count: 1 },
		]);
	});

	it("merges without duplicating constraints and increments repeated failures", () => {
		const base = mergeLedgers(
			undefined,
			{
				constraints: ["Use pnpm, never npm."],
				decisions: [{ id: "D1", text: "Switch auth to cookies" }],
				failedAttempts: [{ command: "pnpm test", error: "ReferenceError", count: 1 }],
			},
			1,
		);
		const merged = mergeLedgers(
			base,
			{
				constraints: ["use pnpm, NEVER npm"],
				decisions: [{ id: "D2", text: "Switch auth to cookies" }],
				failedAttempts: [{ command: "pnpm test", error: "ReferenceError", count: 2 }],
			},
			2,
		);

		expect(merged.epoch).toBe(2);
		expect(merged.constraints).toHaveLength(1);
		expect(merged.decisions).toHaveLength(1);
		expect(merged.failedAttempts).toHaveLength(1);
		expect(merged.failedAttempts[0]?.count).toBe(3);
	});

	it("round-trips deterministic state and strips it before the next summary", () => {
		const ledger = mergeLedgers(
			undefined,
			{
				constraints: ["Never use any in TypeScript."],
				decisions: [{ id: "D1", text: "Use session cookies", files: ["src/auth.ts"] }],
				failedAttempts: [{ command: "pnpm test", error: "window is not defined", count: 2 }],
			},
			4,
		);
		const summary = appendCompactionState("## Goal\nShip the fix.", ledger, "git status --short:\n(clean)");

		expect(stripCompactionState(summary)).toBe("## Goal\nShip the fix.");
		expect(parseSessionLedger(summary)).toMatchObject({
			epoch: 4,
			constraints: ["Never use any in TypeScript."],
			decisions: [{ id: "D1", text: "Use session cookies", files: ["src/auth.ts"] }],
			failedAttempts: [{ command: "pnpm test", error: "window is not defined", count: 2 }],
		});
	});

	it("keeps the ledger stable across five compaction epochs", () => {
		let ledger = mergeLedgers(
			undefined,
			{
				constraints: ["Never use any."],
				decisions: [{ id: "D1", text: "Use session cookies" }],
				failedAttempts: [{ command: "pnpm test", error: "window is not defined", count: 1 }],
			},
			1,
		);
		const narrative = "## Goal\nShip it.";
		for (let epoch = 2; epoch <= 6; epoch++) {
			const summary = appendCompactionState(narrative, ledger, "git status --short:\n(clean)");
			expect(stripCompactionState(summary)).toBe(narrative);
			const parsed = parseSessionLedger(summary);
			expect(parsed?.constraints).toEqual(["Never use any."]);
			expect(parsed?.decisions[0]?.text).toBe("Use session cookies");
			ledger = mergeLedgers(parsed, { constraints: [], decisions: [], failedAttempts: [] }, epoch);
		}
		expect(ledger.epoch).toBe(6);
		expect(ledger.constraints).toEqual(["Never use any."]);
		expect(ledger.decisions).toHaveLength(1);
	});

	it("captures live git status for the handover", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "a-coder-ledger-"));
		try {
			execFileSync("git", ["init", "-q", cwd]);
			writeFileSync(join(cwd, "note.txt"), "pending work\n");
			const state = await readWorkspaceState(cwd);
			expect(state).toContain("git status --short:");
			expect(state).toContain("?? note.txt");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("flushes constraints and writes an epoch handover before compaction", async () => {
		const model = createModel();
		const messages: AgentMessage[] = [
			{ role: "user", content: "Use pnpm, never npm.", timestamp: Date.now() },
			{
				role: "assistant",
				content: [{ type: "text", text: "I will switch the test runner." }],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 10,
					output: 10,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 20,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "bash",
				content: [{ type: "text", text: "ERR_PNPM_NO_SCRIPT" }],
				isError: true,
				timestamp: Date.now(),
			},
		];
		const preparation: CompactionPreparation = {
			firstKeptEntryId: "keep",
			messagesToSummarize: messages,
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 50_000,
			previousLedger: {
				version: 1,
				epoch: 2,
				constraints: ["Keep the public API stable."],
				decisions: [],
				failedAttempts: [],
			},
			compactionCount: 2,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000, autoContinue: false },
		};

		completeSimpleMock
			.mockResolvedValueOnce(
				assistantText(
					JSON.stringify({
						constraints: ["Use pnpm, never npm."],
						decisions: [{ text: "Use the pnpm test runner", rationale: "Project convention" }],
						failedAttempts: [{ command: "pnpm test", error: "ERR_PNPM_NO_SCRIPT" }],
					}),
				),
			)
			.mockResolvedValueOnce(assistantText("## Goal\nShip the fix."));

		const result = await compact(
			preparation,
			model,
			"test-key",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"/tmp",
		);

		expect(result.summary).toContain('<session_ledger epoch="3">');
		expect(result.summary).toContain("Keep the public API stable.");
		expect(result.summary).toContain("Use the pnpm test runner");
		expect(result.summary).toContain("[Context Compacted — Epoch 3.");
		expect(stripCompactionState(result.summary)).toBe("## Goal\nShip the fix.");
		expect(parseSessionLedger(result.summary)?.failedAttempts[0]).toMatchObject({
			command: "pnpm test",
			error: "ERR_PNPM_NO_SCRIPT",
			count: 2,
		});
		expect((result.details as { ledger?: { epoch: number; constraints: string[] } }).ledger).toMatchObject({
			epoch: 3,
			constraints: ["Keep the public API stable.", "Use pnpm, never npm."],
		});
	});
});

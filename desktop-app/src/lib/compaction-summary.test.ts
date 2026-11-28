import { describe, expect, it } from "vitest";
import { summarizeCompactionSummary } from "./compaction-summary";

describe("summarizeCompactionSummary", () => {
	it("strips deterministic blocks and reports ledger counts", () => {
		const summary = `## Goal
Ship the fix.

<session_ledger epoch="3">
{"version":1,"epoch":3,"constraints":["Never use any."],"decisions":[{"id":"D1","text":"Use cookies"}],"failedAttempts":[{"command":"pnpm test","error":"window is not defined","count":2}]}
</session_ledger>

<workspace_state>
git status --short:
 M src/auth.ts
</workspace_state>

<compaction_handover>
[Context Compacted — Epoch 3.]
</compaction_handover>`;

		expect(summarizeCompactionSummary(summary)).toEqual({
			narrative: "## Goal\nShip the fix.",
			epoch: 3,
			constraintCount: 1,
			decisionCount: 1,
			failureCount: 1,
			hasLedger: true,
		});
	});

	it("leaves a legacy summary untouched", () => {
		expect(summarizeCompactionSummary("## Goal\nLegacy").narrative).toBe("## Goal\nLegacy");
		expect(summarizeCompactionSummary("## Goal\nLegacy").hasLedger).toBe(false);
	});
});

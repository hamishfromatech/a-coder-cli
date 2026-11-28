/**
 * Compaction summaries carry deterministic ledger and handover blocks for the
 * model. The transcript should show the narrative and a compact ledger summary,
 * not the raw JSON/state blocks.
 */

export interface CompactionSummaryView {
	narrative: string;
	epoch?: number;
	constraintCount: number;
	decisionCount: number;
	failureCount: number;
	hasLedger: boolean;
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

export function summarizeCompactionSummary(summary: string): CompactionSummaryView {
	const ledgerMatch = summary.match(/<session_ledger[^>]*>\s*([\s\S]*?)\s*<\/session_ledger>/i);
	let epoch: number | undefined;
	let constraintCount = 0;
	let decisionCount = 0;
	let failureCount = 0;
	if (ledgerMatch) {
		try {
			const ledger = JSON.parse(ledgerMatch[1]) as {
				epoch?: unknown;
				constraints?: unknown;
				decisions?: unknown;
				failedAttempts?: unknown;
			};
			if (typeof ledger.epoch === "number") epoch = ledger.epoch;
			constraintCount = arrayLength(ledger.constraints);
			decisionCount = arrayLength(ledger.decisions);
			failureCount = arrayLength(ledger.failedAttempts);
		} catch {
			// Malformed state is still stripped from the transcript.
		}
	}

	const narrative = summary
		.replace(/<session_ledger[^>]*>[\s\S]*?<\/session_ledger>/gi, "")
		.replace(/<workspace_state>[\s\S]*?<\/workspace_state>/gi, "")
		.replace(/<compaction_handover>[\s\S]*?<\/compaction_handover>/gi, "")
		.trim();

	return {
		narrative,
		...(epoch !== undefined ? { epoch } : {}),
		constraintCount,
		decisionCount,
		failureCount,
		hasLedger: ledgerMatch !== null,
	};
}

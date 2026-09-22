/**
 * Secret redaction primitives (ported from strand-agent-tools' two-tier
 * security doctrine).
 *
 * Two independent layers, deliberately uncoupled:
 *
 * 1. **Consent** — whether a human approved an operation (permission prompts,
 *    bypass flags). A consent bypass NEVER disables redaction.
 * 2. **Redaction** — values whose *name* looks like a credential are masked
 *    before they are shown, logged, or exported, regardless of consent mode.
 *
 * Also ports the protected-environment-variable blocklist: names whose values
 * must never be replaced or unset on the theory that a hijacked process could
 * otherwise redirect execution (PATH, LD_PRELOAD, NODE_OPTIONS, ...).
 */

/**
 * Environment variables that must never be overridden or unset through
 * agent-controlled paths. Checked case-insensitively; on Windows, names are
 * matched case-insensitively by the same predicate.
 */
export const PROTECTED_ENV_VARS: readonly string[] = [
	"PATH",
	"SHELL",
	"HOME",
	"USERPROFILE",
	"PWD",
	"PYTHONPATH",
	"NODE_OPTIONS",
	"NODE_PATH",
	"LD_PRELOAD",
	"DYLD_INSERT_LIBRARIES",
	"DYLD_LIBRARY_PATH",
	"LD_LIBRARY_PATH",
	"IFS",
	"BYPASS_TOOL_CONSENT",
	"A_CODER_CLI_ANALYTICS",
];

/**
 * True when an environment-variable name carries credentials and its value
 * must be masked in any display/export path. Matches by name pattern — the
 * same heuristic strand uses (TOKEN | SECRET | PASSWORD | KEY | AUTH |
 * CREDENTIAL), plus common key-storage names.
 */
export function isSensitiveEnvKeyName(name: string): boolean {
	return /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|AUTH|CREDENTIAL)/i.test(name);
}

const MASK = "***";

/**
 * Mask a secret value for display: short values collapse to a fixed mask;
 * longer ones keep a recognizable prefix/suffix ("sk-...abcd").
 */
export function maskSensitiveValue(value: string): string {
	if (value.length === 0) return MASK;
	if (value.length <= 8) return MASK;
	return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

/**
 * Return a copy of a flat string record with sensitive values masked. Used
 * before config/env-like records are displayed, logged, or exported — the
 * redaction layer that no bypass flag disables.
 */
export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		out[key] = typeof value === "string" && isSensitiveEnvKeyName(key) ? maskSensitiveValue(value) : value;
	}
	return out;
}

/**
 * True when an env-var name is on the protected blocklist (case-insensitive,
 * Windows-tolerant).
 */
export function isProtectedEnvVar(name: string): boolean {
	return PROTECTED_ENV_VARS.includes(name.toUpperCase());
}

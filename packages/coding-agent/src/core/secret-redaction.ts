/**
 * Secret redaction for session exports.
 *
 * Transcripts routinely contain credentials: bash output, `cat .env`, curl
 * commands with Authorization headers, tool results from cloud CLIs. Exporting
 * them verbatim (`/export`, HTML/JSONL files) leaks those keys to whatever the
 * file is shared with. This runs before the write and replaces recognizable
 * secret shapes with `[REDACTED]`.
 *
 * Deliberately pattern-based, not entropy-based: a false positive mangles a
 * harmless string, a false negative leaks a key, so the patterns are specific
 * (known prefixes, key: value assignments) rather than "long random-looking".
 */

export interface RedactionResult {
	text: string;
	/** Number of replacements made. */
	redacted: number;
}

export const REDACTION_MARKER = "[REDACTED]";

interface RedactionPattern {
	pattern: RegExp;
	replace?: (match: string) => string;
}

const PATTERNS: RedactionPattern[] = [
	// PEM private keys (multiline — run before the single-line patterns).
	{
		pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
	},
	// Anthropic / OpenAI-style keys.
	{ pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g },
	// GitHub tokens.
	{ pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
	{ pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
	// Slack tokens.
	{ pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
	// AWS access key ids, Google API keys.
	{ pattern: /\bAKIA[0-9A-Z]{16}\b/g },
	{ pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
	// JWTs (three base64url segments).
	{ pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
	// Authorization headers: keep the scheme, drop the credential.
	{ pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace: () => `Bearer ${REDACTION_MARKER}` },
	// key: value / key=value assignments with a credential-shaped value.
	{
		pattern:
			/\b(?:api[_-]?key|secret|token|password|passwd|authorization|access[_-]?token|refresh[_-]?token)\b["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}["']?/gi,
		replace: (match) => {
			const separator = match.includes("=") ? "=" : ":";
			const key = match
				.slice(0, match.search(/[:=]/))
				.trim()
				.replace(/["']+$/, "");
			return `${key}${separator} ${REDACTION_MARKER}`;
		},
	},
];

/** Replace recognizable secrets. Safe to run on JSON strings and HTML. */
export function redactSecrets(text: string): RedactionResult {
	let output = text;
	let redacted = 0;
	for (const entry of PATTERNS) {
		output = output.replace(entry.pattern, (match: string) => {
			redacted += 1;
			return entry.replace ? entry.replace(match) : REDACTION_MARKER;
		});
	}
	return { text: output, redacted };
}

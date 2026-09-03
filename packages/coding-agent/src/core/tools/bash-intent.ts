/**
 * Bash intent classification for tool-card labels (easy-agent toolClassify
 * parity). A wall of `Bash(…)` cards reads better as a sequence of
 * recognizable actions, so the card title gains a small intent tag:
 *
 *   [Git] $ git status
 *   [Test] $ npm test
 *   [Build] $ tsc -p .
 *   [Search] $ rg "useState"
 *   [List] $ ls src
 *
 * The tag never replaces the command — the full command stays visible for
 * approval transparency. Unrecognized commands get no tag.
 */

const GIT_LIKE = new Set(["git", "gh", "glab"]);

const SEARCH_COMMANDS = new Set(["find", "grep", "rg", "ag", "ack", "locate", "which", "whereis"]);

/** Intent tag names shown on the card. */
export type BashIntent = "Git" | "Test" | "Build" | "Search" | "List";

const TEST_PATTERNS: RegExp[] = [
	/\b(vitest|jest|mocha|pytest|ava)\b/,
	/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/,
	/\bgo\s+test\b/,
	/\bcargo\s+test\b/,
	/\bpython\s+-m\s+pytest\b/,
];

const BUILD_PATTERNS: RegExp[] = [
	/\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b/,
	/\btsc\b/,
	/\bmake\b/,
	/\bcargo\s+build\b/,
	/\bgo\s+build\b/,
	/\bvite\s+build\b/,
	/\bwebpack\b/,
];

/** First word of the command (before any path/argument), lowercased. */
function baseCommandOf(command: string): string {
	const trimmed = command.trim();
	const match = /^(?:[./\\~]+[\w./-]*[\\/])?([\w.-]+)/.exec(trimmed);
	return match?.[1]?.toLowerCase() ?? "";
}

/**
 * Extract the quoted search pattern from a grep/find-style command, so the
 * tag target reads `Search("useState")` instead of the whole invocation.
 */
function extractSearchPattern(command: string): string | undefined {
	const quoted = /(['"])(.*?)\1/.exec(command);
	if (quoted?.[2]) return quoted[2];
	// Unquoted pattern: the second token, skipping option-looking arguments.
	const tokens = command.split(/\s+/).filter((t) => t.length > 0);
	for (let i = 2; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token.startsWith("-")) return token;
	}
	return undefined;
}

/**
 * Classify a bash command's intent. Returns undefined when the command does
 * not match a known category (the card then shows no tag).
 */
export function classifyBashIntent(command: string): BashIntent | undefined {
	const trimmed = command.trim();
	if (!trimmed) return undefined;
	const base = baseCommandOf(trimmed);

	if (GIT_LIKE.has(base)) return "Git";
	// Test takes precedence over build: `npm test` must not be mis-bucketed by
	// a stray "build" elsewhere in the command line.
	if (TEST_PATTERNS.some((p) => p.test(trimmed))) return "Test";
	if (BUILD_PATTERNS.some((p) => p.test(trimmed))) return "Build";
	if (SEARCH_COMMANDS.has(base)) return "Search";
	if (base === "ls" || base === "tree") return "List";
	return undefined;
}

/** Short target shown after the tag: the git subcommand, or the pattern. */
export function bashIntentTarget(command: string, intent: BashIntent): string | undefined {
	const trimmed = command.trim();
	if (intent === "Git") {
		const base = baseCommandOf(trimmed);
		const remainder = trimmed.slice(base.length).trim();
		return remainder ? remainder.split(/\s+/)[0] : undefined;
	}
	if (intent === "Search") {
		const pattern = extractSearchPattern(trimmed);
		return pattern ? `"${pattern.length > 40 ? `${pattern.slice(0, 39)}…` : pattern}"` : undefined;
	}
	return undefined;
}

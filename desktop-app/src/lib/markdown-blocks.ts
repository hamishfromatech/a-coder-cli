import { parseMarkdownIntoBlocks } from "@assistant-ui/react-streamdown";

// Block splitting for the streaming markdown pipeline, without re-lexing the
// whole message on every token flush. Ported from Hermes desktop's
// lib/markdown-blocks.ts.
//
// `parseMarkdownIntoBlocks` is a full `marked` lex of the entire text. During
// streaming every flush is a new string, so the stock splitter pays that
// O(full-text) cost ~30x/s on long replies. Two caches remove it:
//   1. Exact-string LRU — a message that remounts with unchanged text reuses
//      its parse outright.
//   2. Streaming-append cache — when the new text starts with a recently
//      parsed text, the previous parse's blocks are reused up to a settled
//      boundary and only the suffix is lexed.

const EXACT_CACHE_MAX = 64;
const EXACT_CACHE_MIN_LENGTH = 1024;
const exactCache = new Map<string, string[]>();

const APPEND_CACHE_MAX = 4;
const APPEND_CACHE_MIN_LENGTH = 2048;
const appendCache: { blocks: string[]; text: string }[] = [];

function rememberAppend(text: string, blocks: string[]): void {
	if (text.length < APPEND_CACHE_MIN_LENGTH) return;
	const index = appendCache.findIndex((entry) => text.startsWith(entry.text));
	if (index !== -1) appendCache.splice(index, 1);
	appendCache.push({ blocks, text });
	if (appendCache.length > APPEND_CACHE_MAX) appendCache.shift();
}

function lexIncrementally(text: string): null | string[] {
	const entry = appendCache.find(
		(cached) => text.length > cached.text.length && text.startsWith(cached.text),
	);
	if (!entry) return null;

	// Settled boundary: drop the last TWO content blocks (skipping whitespace-
	// only blocks). Dropping only the last is unsound: appended text can
	// retroactively merge the previous parse's last two blocks (a trailing
	// setext underline consumes the preceding paragraph). The block before the
	// last is the deepest an append can reach, so re-lexing the last two is
	// safe; earlier blocks are fenced off by settled blank lines.
	let keep = entry.blocks.length;
	for (let dropped = 0; dropped < 2 && keep > 0; dropped += 1) {
		while (keep > 0 && !entry.blocks[keep - 1].trim()) keep -= 1;
		if (keep > 0) keep -= 1;
	}
	if (keep === 0) return null;

	const settled = entry.blocks.slice(0, keep);
	let settledLength = 0;
	for (const block of settled) settledLength += block.length;
	if (settledLength > entry.text.length || !text.startsWith(entry.text.slice(0, settledLength), 0)) {
		return null;
	}
	return [...settled, ...parseMarkdownIntoBlocks(text.slice(settledLength))];
}

export function parseMarkdownIntoBlocksCached(markdown: string): string[] {
	if (markdown.length < EXACT_CACHE_MIN_LENGTH) {
		return parseMarkdownIntoBlocks(markdown);
	}

	const hit = exactCache.get(markdown);
	if (hit) {
		exactCache.delete(markdown);
		exactCache.set(markdown, hit);
		return hit;
	}

	const blocks = lexIncrementally(markdown) ?? parseMarkdownIntoBlocks(markdown);
	rememberAppend(markdown, blocks);
	exactCache.set(markdown, blocks);
	if (exactCache.size > EXACT_CACHE_MAX) {
		exactCache.delete(exactCache.keys().next().value as string);
	}
	return blocks;
}
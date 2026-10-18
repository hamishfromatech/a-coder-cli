/**
 * Speech text: turn an assistant reply into something worth listening to.
 *
 * Voice mode should never read the transcript verbatim — markdown syntax,
 * URLs, file paths, hashes and flags all sound like noise, and the listener
 * cannot skim past them. This is a pure transform applied to the *spoken* copy
 * only; the chat transcript, exports, and copied text stay untouched.
 *
 * Order matters:
 *   structure (fences/tables) → links → HTML → inline code → bare paths →
 *   identifiers → line markers → emphasis → emoji → whitespace/punctuation.
 *
 * Splitting into sentences happens *after* this, so URLs and paths are never
 * shredded mid-token.
 */

export type SpeechMode = "concise" | "verbatim";

export interface SpeechifyOptions {
	/** `concise` (default) applies every rule; `verbatim` returns the input. */
	mode?: SpeechMode;
	/** Spoken in place of the first dropped code block. Empty string disables. */
	codeMarker?: string;
	/** Spoken when the reply contains nothing speakable (e.g. only code). */
	fallback?: string;
}

const DEFAULT_CODE_MARKER = "with a code sample";
const DEFAULT_FALLBACK = "The reply is in the transcript.";

const FENCED_CODE = /```[^\n]*\n[\s\S]*?```/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\]\([^()\s]*(?:\s+"[^"]*")?\)/g;
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;
const INLINE_CODE = /`([^`]+)`/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HASH = /\b[0-9a-f]{32,}\b/gi;

/** Absolute, home-relative, Windows, and multi-segment relative paths. */
const PATH =
	/(?:~?\/[\w.@+-]+(?:\/[\w.@+-]+)+|\b[A-Za-z]:\\[^\s"']+|\b(?:\.{0,2}\/)?[\w.@+-]+(?:\/[\w.@+-]+)+\.\w+)/g;

const SOURCE_FILE =
	/^[\w.@+-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|py|rs|go|rb|java|kt|c|h|cpp|hpp|cs|swift|php|css|scss|html|sh|bash|zsh|yaml|yml|toml|ini|cfg|conf|sql|txt)$/i;

/** Does this inline-code span name a file/path rather than something readable? */
function isPathLike(code: string): boolean {
	if (/\s/.test(code)) return false;
	return code.includes("/") || code.includes("\\") || SOURCE_FILE.test(code);
}

/** Render an inline-code span for speech. */
function spokenInlineCode(raw: string): string {
	const code = raw.trim();
	if (!code) return "";
	if (isPathLike(code)) return "the file";
	if (UUID.test(code)) return "an identifier";
	UUID.lastIndex = 0;
	if (/^[0-9a-f]{32,}$/i.test(code)) return "a hash";
	// CLI flags and env-style assignments read as alphabet soup.
	const cleaned = code
		.replace(/(?:^|\s)--?[\w-]+(?:=\S+)?/g, "")
		.replace(/\b[A-Z0-9_]+=\S+/g, "")
		.replace(/^([\w.$-]+)\(\)$/i, "$1")
		.replace(/_/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned.length > 0 ? cleaned : "the command";
}

function stripLineMarkers(line: string): string {
	const trimmed = line.trim();
	// Table rows and separator rows: cells read as word salad.
	if (/^\|.*\|$/.test(trimmed)) return "";
	if (/^\|?[\s:-]*-{2,}[\s:|-]*\|?$/.test(trimmed)) return "";
	// Horizontal rules.
	if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return "";
	return line
		.replace(/^\s{0,3}#{1,6}\s+/, "")
		.replace(/^\s{0,3}>\s?/, "")
		.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/^\s*\[[ xX]\]\s+/, "");
}

/** Collapse the damage removals do: doubled spaces, dangling punctuation. */
function tidy(text: string): string {
	return text
		.replace(/[ \t]+/g, " ")
		.replace(/\s*\n\s*/g, " ")
		// Only sentence-final punctuation loses its leading space; ".NET" and
		// similar tokens must keep theirs.
		.replace(/\s+([.,!?;:])(?=\s|$)/g, "$1")
		.replace(/([.,!?;:])\1+/g, "$1")
		// A removed block can leave "here:" or "—" hanging at a sentence end.
		.replace(/[:;,–—-]\s*(?=[.!?]|$)/g, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

export function speechify(input: string, options: SpeechifyOptions = {}): string {
	if (options.mode === "verbatim") return input;

	const marker = options.codeMarker ?? DEFAULT_CODE_MARKER;
	const fallback = options.fallback ?? DEFAULT_FALLBACK;
	let text = input;

	// 1. Fenced code. Insert the marker once, only if the reply has prose that
	//    survives — a code-only reply gets the fallback instead.
	let markerInserted = false;
	// "Here is the fix:" followed by a block reads as "Here is the fix with a
	// code sample" — the colon introduces the block, so it goes with it.
	text = text.replace(/:\s*(```[^\n]*\n[\s\S]*?```)/g, " $1");
	text = text.replace(FENCED_CODE, () => {
		if (!markerInserted && marker) {
			markerInserted = true;
			return ` ${marker} `;
		}
		return " ";
	});

	// 2. Images and links keep their human label; bare URLs become "a link" so
	//    the surrounding sentence still parses.
	text = text.replace(IMAGE, (_match, alt: string) => (alt.trim() ? alt.trim() : "an image"));
	text = text.replace(LINK, (_match, label: string) => label.trim() || "a link");
	text = text.replace(BARE_URL, "a link");
	text = text.replace(EMAIL, "an email address");

	// 3. HTML wrappers.
	text = text.replace(HTML_TAG, "");

	// 4. Inline code, interpreted rather than blindly unwrapped.
	text = text.replace(INLINE_CODE, (_match, code: string) => spokenInlineCode(code));

	// 5. Bare paths in prose.
	text = text.replace(PATH, "the file");

	// 6. Machine identifiers.
	text = text.replace(UUID, "an identifier");
	text = text.replace(LONG_HASH, "a hash");

	// 7. Line-level markdown structure.
	text = text
		.split("\n")
		.map(stripLineMarkers)
		.join("\n");

	// 8. Emphasis (paired only — never a bare `*`, so `2 * 3` survives).
	text = text
		.replace(/\*\*([^*\n]+)\*\*/g, "$1")
		.replace(/__([^_\n]+)__/g, "$1")
		.replace(/~~([^~\n]+)~~/g, "$1")
		.replace(/(^|[\s("'])\*([^*\n]+)\*(?=[\s).,!?:;"']|$)/g, "$1$2")
		.replace(/(^|[\s("'])_([^_\n]+)_(?=[\s).,!?:;"']|$)/g, "$1$2");

	// 9. Emoji and variation selectors.
	text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "");

	text = tidy(text);

	// A reply that was only a code block reduces to the marker alone; that is
	// not a sentence, so point at the transcript instead of speaking it.
	if (marker && text.replace(/[.!?]+$/, "").toLowerCase() === marker.toLowerCase()) {
		return fallback;
	}
	return text || fallback;
}

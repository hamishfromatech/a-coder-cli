import type { SyntaxHighlighterProps } from "@assistant-ui/react-streamdown";
import { type FC, useMemo } from "react";
import { createJavaScriptRegexEngine, useShikiHighlighter } from "react-shiki";
import {
	CodeCard,
	CodeCardBody,
	CodeCardHeader,
	CodeCardIcon,
	CodeCardSubtitle,
	CodeCardTitle,
} from "./CodeCard";
import { CopyButton } from "./CopyButton";
import { ExpandableBlock } from "./ExpandableBlock";
import { isLikelyProseCodeBlock, sanitizeLanguageTag } from "../../lib/markdown-code";

// Shiki-backed fenced-code renderer. Adapted from Hermes' chat/shiki-highlighter.
//
// Two divergences from Hermes, both forced by the Tauri webview:
//   1. JS regex engine instead of oniguruma. The full `react-shiki` bundle
//      defaults to `createOnigurumaEngine(import("shiki/wasm"))`; although Vite
//      inlines the wasm as base64 bytes, instantiating it in the webview is an
//      extra async cost and a failure surface. `createJavaScriptRegexEngine`
//      needs no wasm and covers the common LLM languages; grammars that need
//      oniguruma-specific features throw, which the ShikiCode fallback catches.
//   2. We drive `useShikiHighlighter` directly and render `PlainCode` while the
//      highlighted tree is null (loading or rejected). The stock
//      `ShikiHighlighter` component renders an *empty* `<pre>` during that gap —
//      so when `defer` flips false on completion and we swap PlainCode → Shiki,
//      the code body would visibly blank out (and stay blank if the highlight
//      rejects). The fallback guarantees the body is never empty.

interface HermesSyntaxHighlighterProps extends SyntaxHighlighterProps {
	defer?: boolean;
}

// github-dark-dimmed is GitHub's lower-contrast dark palette — the vivid
// github-dark-default tokens read harsh at our small code size.
export const SHIKI_THEME = { dark: "github-dark-dimmed", light: "github-light-default" } as const;

// github-light-default colors comments #6e7781 (~4.2:1) — borderline
// unreadable at 11px, worst for shell snippets. Remap to #57606a (~6.4:1).
const SHIKI_COLOR_REPLACEMENTS: Record<string, Record<string, string>> = {
	"github-light-default": { "#6e7781": "#57606a" },
};

// JS regex engine — module-scope so the identity is stable across renders
// (the hook stores it in a ref and won't re-trigger the highlight effect).
const SHIKI_ENGINE = createJavaScriptRegexEngine();

const MAX_HIGHLIGHT_CHARS = 150_000;
const MAX_HIGHLIGHT_LINES = 3_000;
const CHUNK_LINES = 200;
const EST_LINE_PX = 16;

export function exceedsHighlightBudget(code: string): boolean {
	if (code.length > MAX_HIGHLIGHT_CHARS) return true;
	let lines = 1;
	let idx = code.indexOf("\n");
	while (idx !== -1) {
		if ((lines += 1) > MAX_HIGHLIGHT_LINES) return true;
		idx = code.indexOf("\n", idx + 1);
	}
	return false;
}

interface CodeChunk {
	text: string;
	lines: number;
}

export function chunkByLines(code: string, perChunk: number): CodeChunk[] {
	const lines = code.split("\n");
	if (lines.length <= perChunk) return [{ text: code, lines: lines.length }];
	const chunks: CodeChunk[] = [];
	for (let i = 0; i < lines.length; i += perChunk) {
		const slice = lines.slice(i, i + perChunk);
		chunks.push({ text: slice.join("\n"), lines: slice.length });
	}
	return chunks;
}

const PlainCode: FC<{ code: string }> = ({ code }) => {
	const chunks = useMemo(() => chunkByLines(code, CHUNK_LINES), [code]);
	if (chunks.length === 1) return <code className="block whitespace-pre">{code}</code>;
	return (
		<>
			{chunks.map((chunk, index) => (
				<code
					className="block whitespace-pre [content-visibility:auto]"
					key={index}
					style={{ containIntrinsicSize: `auto ${chunk.lines * EST_LINE_PX}px` }}
				>
					{chunk.text}
				</code>
			))}
		</>
	);
};

// Drives Shiki directly and falls back to PlainCode while the highlighted tree
// is null (initial mount, throttled delay, or a rejected highlight). The
// fallback is what keeps code visible across the streaming → completion swap.
const ShikiCode: FC<{ code: string; language: string }> = ({ code, language }) => {
	const highlighted = useShikiHighlighter(code, language, SHIKI_THEME, {
		colorReplacements: SHIKI_COLOR_REPLACEMENTS,
		defaultColor: "light-dark()",
		delay: 120,
		engine: SHIKI_ENGINE,
	});
	return <>{highlighted ?? <PlainCode code={code} />}</>;
};

export const SyntaxHighlighter: FC<HermesSyntaxHighlighterProps> = ({
	components: { Pre },
	language,
	code,
	defer = false,
}) => {
	const trimmed = (code ?? "").replace(/^\n+/, "").trimEnd();

	// Streaming may hand us empty/incomplete fences — render nothing rather
	// than a transient empty card.
	if (!trimmed.trim()) return null;

	if (isLikelyProseCodeBlock(language, trimmed)) {
		return <div className="aui-prose-fence whitespace-pre-wrap wrap-anywhere text-pi-text">{trimmed}</div>;
	}

	const cleanLanguage = sanitizeLanguageTag(language || "");
	const label = cleanLanguage && cleanLanguage !== "unknown" ? cleanLanguage : "";
	const plain = defer || exceedsHighlightBudget(trimmed);

	return (
		<CodeCard data-streaming={defer ? "true" : undefined}>
			<CodeCardHeader>
				<CodeCardTitle>
					<CodeCardIcon language={label} />
					Code
					{label && <CodeCardSubtitle> · {label}</CodeCardSubtitle>}
				</CodeCardTitle>
				<CopyButton className="-my-1 -mr-1 h-5 px-1 opacity-55 hover:opacity-100" iconClassName="size-2.5" text={trimmed} />
			</CodeCardHeader>
			<CodeCardBody>
				<ExpandableBlock>
					<Pre className="aui-shiki not-prose m-0 overflow-hidden bg-transparent p-0">
						{plain ? (
							<PlainCode code={trimmed} />
						) : (
							<ShikiCode code={trimmed} language={language || "text"} />
						)}
					</Pre>
				</ExpandableBlock>
			</CodeCardBody>
		</CodeCard>
	);
};
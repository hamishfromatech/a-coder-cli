import { TextMessagePartProvider, useMessagePartText } from "@assistant-ui/react";
import {
	type StreamdownTextComponents,
	StreamdownTextPrimitive,
	type SyntaxHighlighterProps,
	tailBoundedRemend,
} from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { type ComponentProps, memo, useMemo } from "react";
import { createMemoizedMathPlugin } from "../../lib/katex-memo";
import { parseMarkdownIntoBlocksCached } from "../../lib/markdown-blocks";
import { preprocessMarkdown } from "../../lib/markdown-preprocess";
import {
	ExternalLink,
	normalizeExternalUrl,
	PrettyLink,
	urlSlugTitleLabel,
} from "../../lib/external-link";
import { cn } from "../../lib/cn";
import { detectEmbed } from "./embeds/providers";
import { MarkdownAlert, extractAlert } from "./embeds/alert";
import { RICH_FENCE_LANGUAGES, RichCodeBlock } from "./embeds/registry";
import { UrlEmbed } from "./embeds/url-embed";
import { SyntaxHighlighter, chunkByLines } from "./ShikiHighlighter";
import { ZoomableImage } from "./ZoomableImage";

// Math rendering plugin (KaTeX), memoized so during streaming only changed
// equations re-render. singleDollarTextMath enables `$x^2$` inline math.
const mathPlugin = createMemoizedMathPlugin({ singleDollarTextMath: true });

// Replaces Streamdown's full-text incomplete-markdown repair with a
// tail-bounded repair over our preprocessed text. Module-scope so the prop
// identity is stable across renders.
function preprocessWithTailRepair(text: string): string {
	try {
		return tailBoundedRemend(preprocessMarkdown(text));
	} catch {
		return text;
	}
}

function childrenToText(children: unknown): string {
	if (typeof children === "string" || typeof children === "number") return String(children).trim();
	if (Array.isArray(children) && children.every((c) => typeof c === "string" || typeof c === "number")) {
		return children.join("").trim();
	}
	return "";
}

function MarkdownLink({ children, className, href, ...props }: ComponentProps<"a">) {
	const target = href ? normalizeExternalUrl(href) : href;
	if (!target || !/^https?:\/\//i.test(target)) {
		return (
			<a
				className={cn(
					"font-semibold text-pi-text underline underline-offset-4 decoration-pi-accent/30 wrap-anywhere",
					className,
				)}
				href={href}
				rel="noopener noreferrer"
				target="_blank"
				{...props}
			>
				{children}
			</a>
		);
	}

	const text = childrenToText(children);
	// Bare autolink -> inline rich embed when a provider matches. Labeled links
	// (`[watch](url)`) stay plain.
	if (text && normalizeExternalUrl(text) === target) {
		const embed = detectEmbed(target);
		if (embed) return <UrlEmbed descriptor={embed} />;
	}

	const fallbackLabel = text && normalizeExternalUrl(text) !== target ? text : undefined;
	return <PrettyLink className={cn("wrap-anywhere", className)} fallbackLabel={fallbackLabel} href={target} {...props} />;
}

// Headings shrink to chat scale rather than the prose default. Table-driven.
const HEADING_SIZES: Record<"h1" | "h2" | "h3" | "h4", string> = {
	h1: "text-[1rem] tracking-tight",
	h2: "text-[0.9375rem] tracking-tight",
	h3: "text-[0.875rem]",
	h4: "text-[0.8125rem]",
};

const MARKDOWN_CONTAINER_CLASS_NAME = cn(
	"aui-md prose dark:prose-invert w-full max-w-none overflow-hidden text-[length:var(--conversation-text-font-size)] leading-[var(--dt-line-height)] text-pi-text",
	"prose-p:leading-[var(--dt-line-height)] prose-li:leading-[var(--dt-line-height)]",
	"prose-headings:text-pi-text prose-strong:text-pi-text",
	"prose-a:break-words prose-p:[overflow-wrap:anywhere]",
	"prose-li:marker:text-pi-text-muted",
	"prose-code:rounded-[0.25rem] prose-code:px-[0.1875rem] prose-code:py-px prose-code:font-mono prose-code:text-[0.9em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>*+*]:mt-[var(--paragraph-gap)]",
);

const MAX_MARKDOWN_CHARS = 200_000;

function HugeTextFallback({ containerClassName, text }: { containerClassName?: string; text: string }) {
	const chunks = useMemo(() => chunkByLines(text, 200), [text]);
	return (
		<div
			className={cn(
				"aui-md w-full max-w-none overflow-hidden rounded-[0.625rem] border border-pi-border font-mono text-[0.7rem] leading-relaxed text-pi-text-secondary",
				containerClassName,
			)}
		>
			{chunks.map((chunk, index) => (
				<div className="[content-visibility:auto]" key={index} style={{ containIntrinsicSize: `auto ${chunk.lines * 16}px` }}>
					{chunk.text}
				</div>
			))}
		</div>
	);
}

function MarkdownTextSurface({
	containerClassName,
	containerProps,
	defer,
}: {
	containerClassName?: string;
	containerProps?: ComponentProps<"div">;
	defer?: boolean;
}) {
	const { status, text } = useMessagePartText();
	const isStreaming = status.type === "running";

	const plugins = useMemo(() => ({ math: mathPlugin, code }), []);

	const components = useMemo(
		() =>
			({
				h1: ({ className, ...props }: ComponentProps<"h1">) => (
					<h1 className={cn("my-1 font-semibold", HEADING_SIZES.h1, className)} {...props} />
				),
				h2: ({ className, ...props }: ComponentProps<"h2">) => (
					<h2 className={cn("my-1 font-semibold", HEADING_SIZES.h2, className)} {...props} />
				),
				h3: ({ className, ...props }: ComponentProps<"h3">) => (
					<h3 className={cn("my-1 font-semibold", HEADING_SIZES.h3, className)} {...props} />
				),
				h4: ({ className, ...props }: ComponentProps<"h4">) => (
					<h4 className={cn("my-1 font-semibold", HEADING_SIZES.h4, className)} {...props} />
				),
				p: ({ className, ...props }: ComponentProps<"p">) => (
					<p className={cn("wrap-anywhere leading-[var(--dt-line-height)]", className)} {...props} />
				),
				a: MarkdownLink,
				inlineCode: ({ className, ...props }: ComponentProps<"code">) => (
					<code className={className} dir="ltr" {...props} />
				),
				hr: () => <div aria-hidden className="my-3" />,
				blockquote: ({ children, className, ...props }: ComponentProps<"blockquote">) => {
					const alert = extractAlert(children);
					if (alert) return <MarkdownAlert type={alert.type}>{alert.body}</MarkdownAlert>;
					return (
						<blockquote
							className={cn("border-s-2 border-pi-border ps-3 text-pi-text-muted italic", className)}
							dir="auto"
							{...props}
						>
							{children}
						</blockquote>
					);
				},
				ul: ({ className, ...props }: ComponentProps<"ul">) => (
					<ul className={cn("my-1 gap-0", className)} dir="auto" {...props} />
				),
				ol: ({ className, ...props }: ComponentProps<"ol">) => (
					<ol className={cn("my-1 gap-0", className)} dir="auto" {...props} />
				),
				li: ({ className, ...props }: ComponentProps<"li">) => (
					<li className={cn("leading-[var(--dt-line-height)]", className)} {...props} />
				),
				table: ({ className, ...props }: ComponentProps<"table">) => (
					<div className="aui-md-table my-2 max-w-full overflow-x-auto rounded-[0.375rem] border border-pi-border">
						<table
							className={cn(
								"m-0 w-full min-w-[18rem] border-collapse text-[0.8125rem] [&_tr]:border-b [&_tr]:border-pi-border last:[&_tr]:border-0",
								className,
							)}
							{...props}
						/>
					</div>
				),
				thead: ({ className, ...props }: ComponentProps<"thead">) => (
					<thead className={cn("m-0 bg-pi-surface-raised/50 text-pi-text-muted", className)} {...props} />
				),
				th: ({ className, ...props }: ComponentProps<"th">) => (
					<th
						className={cn(
							"whitespace-nowrap px-2.5 py-1.5 text-left align-middle text-[0.75rem] font-medium text-pi-text-muted",
							className,
						)}
						{...props}
					/>
				),
				td: ({ className, ...props }: ComponentProps<"td">) => (
					<td className={cn("px-2.5 py-1.5 align-top text-[0.8125rem] leading-snug", className)} {...props} />
				),
				img: ZoomableImage,
				SyntaxHighlighter: (props: SyntaxHighlighterProps) => (
					<RichCodeBlock
						code={props.code}
						fallback={<SyntaxHighlighter {...props} defer={isStreaming} />}
						language={props.language}
						streaming={isStreaming}
					/>
				),
			}) as unknown as StreamdownTextComponents,
		[isStreaming],
	);

	if (text.length > MAX_MARKDOWN_CHARS) {
		return <HugeTextFallback containerClassName={containerClassName} text={text} />;
	}

	return (
		<StreamdownTextPrimitive
			components={components}
			containerClassName={cn(MARKDOWN_CONTAINER_CLASS_NAME, containerClassName)}
			containerProps={containerProps}
			defer={defer}
			lineNumbers={false}
			mode="streaming"
			parseIncompleteMarkdown={false}
			parseMarkdownIntoBlocksFn={parseMarkdownIntoBlocksCached}
			plugins={plugins}
			preprocess={preprocessWithTailRepair}
		/>
	);
}

export interface MarkdownTextContentProps {
	text: string;
	isRunning: boolean;
	containerClassName?: string;
	containerProps?: ComponentProps<"div">;
}

// Public entry: wraps the surface in a TextMessagePartProvider so the
// streaming-aware primitive can read the text + running status.
export function MarkdownTextContent({ isRunning, text, ...surfaceProps }: MarkdownTextContentProps) {
	return (
		<TextMessagePartProvider isRunning={isRunning} text={text}>
			<MarkdownTextSurface defer {...surfaceProps} />
		</TextMessagePartProvider>
	);
}

const MarkdownTextImpl = () => <MarkdownTextSurface defer />;
export const MarkdownText = memo(MarkdownTextImpl);

// Re-export for callers that build standalone external links outside markdown.
export { ExternalLink, urlSlugTitleLabel, RICH_FENCE_LANGUAGES };
import { lazy, type LazyExoticComponent, type ComponentType, Suspense, type ReactNode } from "react";
import { RichBoundary } from "./rich-boundary";
import type { RichFenceProps } from "./types";

// Root renderer for fenced code blocks: language -> lazy-renderer table. Each
// renderer is its own split chunk (mermaid pulls in mermaid, svg pulls in
// DOMPurify), loaded only when a block of that language appears.
const LAZY_FENCE: Record<string, LazyExoticComponent<ComponentType<RichFenceProps>>> = {
	mermaid: lazy(() => import("./mermaid-embed")),
	svg: lazy(() => import("./svg-embed")),
};

export const RICH_FENCE_LANGUAGES: ReadonlySet<string> = new Set(Object.keys(LAZY_FENCE));

interface RichCodeBlockProps extends RichFenceProps {
	fallback: ReactNode;
	language?: string;
}

export function RichCodeBlock({ code, fallback, language, streaming }: RichCodeBlockProps) {
	const Renderer = language ? LAZY_FENCE[language.toLowerCase()] : undefined;
	if (!Renderer) return <>{fallback}</>;
	return (
		<RichBoundary fallback={fallback} resetKey={code}>
			<Suspense fallback={fallback}>
				<Renderer code={code} streaming={streaming} />
			</Suspense>
		</RichBoundary>
	);
}
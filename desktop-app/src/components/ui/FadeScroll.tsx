import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll container with masked edges: content fades under the top/bottom edge
 * only while there is more to scroll that way. The mask is what tells the eye
 * "this continues" without drawing a border or a scrollbar.
 *
 * Nested scrollers hand vertical scroll back at the edges (`overscroll-auto`)
 * so a short list inside a longer panel doesn't trap the wheel.
 */

const DEFAULT_FADE = 14;

export interface FadeScrollProps {
	children: ReactNode;
	className?: string;
	/** Fade depth in px. */
	fade?: number;
	/** Extra props passthrough for the scroll element. */
	onScroll?: () => void;
}

export function FadeScroll({ children, className, fade = DEFAULT_FADE, onScroll }: FadeScrollProps) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [fadeTop, setFadeTop] = useState(false);
	const [fadeBottom, setFadeBottom] = useState(false);

	const update = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		const top = el.scrollTop > 2;
		const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
		setFadeTop(top);
		setFadeBottom(bottom);
		onScroll?.();
	}, [onScroll]);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		update();
		el.addEventListener("scroll", update, { passive: true });
		const observer = new ResizeObserver(update);
		observer.observe(el);
		for (const child of Array.from(el.children)) observer.observe(child);
		return () => {
			el.removeEventListener("scroll", update);
			observer.disconnect();
		};
	}, [update, children]);

	const mask = (() => {
		if (fadeTop && fadeBottom) {
			return `linear-gradient(to bottom, transparent 0, black ${fade}px, black calc(100% - ${fade}px), transparent 100%)`;
		}
		if (fadeTop) return `linear-gradient(to bottom, transparent 0, black ${fade}px)`;
		if (fadeBottom) return `linear-gradient(to bottom, black calc(100% - ${fade}px), transparent 100%)`;
		return undefined;
	})();

	return (
		<div
			ref={ref}
			className={`overscroll-auto ${className ?? ""}`}
			style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
		>
			{children}
		</div>
	);
}

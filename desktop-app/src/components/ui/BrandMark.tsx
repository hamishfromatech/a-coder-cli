import { cn } from "../../lib/cn";

// The A-Coder mark: the app icon's nested-triangle vortex, redrawn as crisp
// SVG so it stays sharp from the 20px titlebar tile up. Every ring shrinks
// toward an off-center eye with a slight twist — long rays left, tight rays
// right — ending in a solid core, matching the application icon.

const MARK_POINTS = "32,7 54.5,46 9.5,46";
/** The vortex eye (convergence point) in the 64-unit viewbox. */
const EYE_X = 37;
const EYE_Y = 33.5;
const RING_SCALE = 0.8;
const RING_TWIST_DEG = 2.5;
const RING_COUNT = 10;

function TriangleMark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 64 64" className={className} aria-hidden="true">
			{Array.from({ length: RING_COUNT }, (_, i) => (
				<polygon
					key={i}
					points={MARK_POINTS}
					fill="none"
					stroke="currentColor"
					strokeWidth={Math.max(0.9, 2.4 - i * 0.16)}
					strokeLinejoin="round"
					transform={`rotate(${i * RING_TWIST_DEG} ${EYE_X} ${EYE_Y}) translate(${EYE_X} ${EYE_Y}) scale(${(RING_SCALE ** i).toFixed(4)}) translate(${-EYE_X} ${-EYE_Y})`}
				/>
			))}
			<polygon
				points={MARK_POINTS}
				fill="currentColor"
				transform={`rotate(${RING_COUNT * RING_TWIST_DEG} ${EYE_X} ${EYE_Y}) translate(${EYE_X} ${EYE_Y}) scale(${(RING_SCALE ** RING_COUNT).toFixed(4)}) translate(${-EYE_X} ${-EYE_Y})`}
			/>
		</svg>
	);
}

// Brand badge: the A-Coder triangle mark on a white tile, identical in
// light/dark. Fills the tile (softly rounded); size via className (default size-8).
export function BrandMark({
	className,
	children,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white text-[#334155]",
				className,
			)}
			{...props}
		>
			{children ?? <TriangleMark className="size-[76%]" />}
		</span>
	);
}
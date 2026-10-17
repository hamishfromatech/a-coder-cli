/** Shimmering status text — CSS-only port of ElevenLabs UI's ShimmeringText
 *  (the band sweeping across the text). Uses the .shimmer-text rule in
 *  index.css; no motion dependency. */
export function ShimmeringText({ text, className }: { text: string; className?: string }) {
	const spread = Math.min(320, Math.max(48, text.length * 8));
	return (
		<span
			className={`shimmer-text select-none ${className ?? ""}`}
			style={{ ["--shimmer-spread" as string]: `${spread}px` }}
		>
			{text}
		</span>
	);
}
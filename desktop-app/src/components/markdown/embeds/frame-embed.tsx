import { type CSSProperties } from "react";
import type { FrameEmbed } from "./providers/types";
import { ScrollGate } from "./scroll-gate";
import { useIsDark } from "./use-is-dark";

const ALLOW = "autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen";

// Plain iframes: a non-scrollable cross-origin iframe lets the wheel chain to
// the transcript. Maps are interactive, so a ScrollGate blocks them until ⌘.
export default function FrameEmbedRenderer({ descriptor }: { descriptor: FrameEmbed }) {
	const isDark = useIsDark();
	const isMap = descriptor.provider === "googlemaps" || descriptor.provider === "openstreetmap";
	const colorScheme = isDark ? "dark" : "light";
	const style: CSSProperties = descriptor.aspectRatio
		? { aspectRatio: descriptor.aspectRatio, colorScheme }
		: { colorScheme, height: descriptor.height };

	if (isMap) {
		return (
			<div className="relative w-full overflow-hidden" style={style}>
				<iframe
					allow={ALLOW}
					className="absolute inset-0 size-full border-0 bg-transparent"
					loading="lazy"
					referrerPolicy="strict-origin-when-cross-origin"
					src={descriptor.embedUrl}
					style={{ colorScheme }}
					title={`${descriptor.label} embed`}
				/>
				<ScrollGate />
			</div>
		);
	}

	return (
		<iframe
			allow={ALLOW}
			allowFullScreen
			className="block w-full border-0 bg-transparent"
			loading="lazy"
			referrerPolicy="strict-origin-when-cross-origin"
			scrolling="no"
			src={descriptor.embedUrl}
			style={style}
			title={`${descriptor.label} embed`}
		/>
	);
}
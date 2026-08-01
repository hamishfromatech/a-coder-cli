import { useMemo } from "react";
import type { FrameEmbed } from "./providers/types";
import { useIsDark } from "./use-is-dark";

const YOUTUBE_ALLOW =
	"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";

function youtubeSrc(embedUrl: string): string {
	const url = new URL(embedUrl);
	if (
		typeof window !== "undefined" &&
		(window.location.protocol === "http:" || window.location.protocol === "https:") &&
		window.location.origin &&
		window.location.origin !== "null"
	) {
		url.searchParams.set("origin", window.location.origin);
	}
	return url.toString();
}

export default function YouTubeEmbedRenderer({ descriptor }: { descriptor: FrameEmbed }) {
	const isDark = useIsDark();
	const src = useMemo(() => youtubeSrc(descriptor.embedUrl), [descriptor.embedUrl]);
	return (
		<iframe
			allow={YOUTUBE_ALLOW}
			allowFullScreen
			className="block aspect-video w-full border-0 bg-transparent"
			loading="lazy"
			referrerPolicy="strict-origin-when-cross-origin"
			scrolling="no"
			src={src}
			style={{ colorScheme: isDark ? "dark" : "light" }}
			title="YouTube embed"
		/>
	);
}
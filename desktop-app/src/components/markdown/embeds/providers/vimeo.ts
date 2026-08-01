import { bareHost, type EmbedMatcher } from "./types";

export const vimeo: EmbedMatcher = (url) => {
	const host = bareHost(url.hostname);
	if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
	const id = url.pathname
		.split("/")
		.filter(Boolean)
		.reverse()
		.find((segment) => /^\d+$/.test(segment));
	if (!id) return null;
	return {
		aspectRatio: 16 / 9,
		embedUrl: `https://player.vimeo.com/video/${id}`,
		id: `vimeo:${id}`,
		label: "Vimeo",
		maxWidth: 640,
		provider: "vimeo",
		renderer: "frame",
		sourceUrl: url.toString(),
	};
};
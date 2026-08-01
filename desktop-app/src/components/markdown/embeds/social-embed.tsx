import { useEffect, useRef } from "react";
import { escapeHtml } from "./escape-html";
import type { EmbedDescriptor } from "./providers/types";
import { useIsDark } from "./use-is-dark";

// Render the official blockquote in-document and let the provider's script
// swap it for a correctly-sized iframe (same approach as
// react-social-media-embed). A sandboxed srcDoc iframe gives a null origin and
// makes the scripts bail, so we render in this document. The container is
// height:auto so it grows to whatever the provider renders.

type EmbedWindow = Window &
	typeof globalThis & {
		instgrm?: { Embeds?: { process?: () => void } };
		twttr?: { widgets?: { load?: (el?: HTMLElement) => void } };
	};

const SCRIPT: Record<string, { id: string; src: string }> = {
	instagram: { id: "a-coder-ig-embed", src: "https://www.instagram.com/embed.js" },
	tiktok: { id: "a-coder-tt-embed", src: "https://www.tiktok.com/embed.js" },
	twitter: { id: "a-coder-tw-embed", src: "https://platform.twitter.com/widgets.js" },
};

const PROCESS_DELAYS_MS = [0, 300, 800, 1600, 3000];

function markup(descriptor: EmbedDescriptor, theme: "dark" | "light"): string {
	const url = escapeHtml(descriptor.sourceUrl);
	switch (descriptor.provider) {
		case "instagram":
			return `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14" style="margin:0;width:100%;min-width:0;max-width:100%"></blockquote>`;
		case "tiktok": {
			const id = escapeHtml(descriptor.id.replace(/^tiktok:/, ""));
			return `<blockquote class="tiktok-embed" cite="${url}" data-video-id="${id}" style="margin:0;max-width:100%"><section></section></blockquote>`;
		}
		case "twitter":
			return `<blockquote class="twitter-tweet" data-dnt="true" data-theme="${theme}" data-chrome="transparent"><a href="${url}"></a></blockquote>`;
		default:
			return "";
	}
}

function loadScript(provider: string): Promise<void> {
	const { id, src } = SCRIPT[provider];
	if (provider === "tiktok") {
		document.getElementById(id)?.remove();
	} else if (document.getElementById(id)) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const script = document.createElement("script");
		script.async = true;
		script.id = id;
		script.onload = () => resolve();
		script.onerror = () => resolve();
		script.src = src;
		document.body.appendChild(script);
	});
}

function processEmbed(provider: string, container: HTMLElement): void {
	const win = window as EmbedWindow;
	if (provider === "instagram") win.instgrm?.Embeds?.process?.();
	else if (provider === "twitter") win.twttr?.widgets?.load?.(container);
}

export default function SocialEmbedRenderer({ descriptor }: { descriptor: EmbedDescriptor }) {
	const isDark = useIsDark();
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const container = ref.current;
		if (!container) return;
		let cancelled = false;
		const timers: number[] = [];
		container.innerHTML = markup(descriptor, isDark ? "dark" : "light");
		void loadScript(descriptor.provider).then(() => {
			for (const delay of PROCESS_DELAYS_MS) {
				timers.push(
					window.setTimeout(() => !cancelled && processEmbed(descriptor.provider, container), delay),
				);
			}
		});
		return () => {
			cancelled = true;
			for (const timer of timers) clearTimeout(timer);
			container.innerHTML = "";
		};
	}, [descriptor, isDark]);

	return (
		<div
			className="w-full [&_.instagram-media]:!min-w-0 [&_iframe]:!m-0 [&_iframe]:!max-w-full [&_iframe]:[color-scheme:light]"
			ref={ref}
		/>
	);
}
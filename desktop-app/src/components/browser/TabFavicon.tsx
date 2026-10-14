// A session tab's favicon, derived from the page origin (plain img against
// /favicon.ico; the store mirrors only urls from the Rust side, so nothing
// more exotic is available). While the image is loading — or when the site
// has no favicon and the request fails — the globe stays visible, so a tab
// never shows a broken-image glyph.

import { useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "../../lib/cn";

/** The origin-rooted favicon URL for a tab, or null when it cannot have one. */
function faviconUrlOf(tabUrl: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(tabUrl);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
	// Keep http on http origins (localhost dev servers serve favicons there).
	return `${parsed.origin}/favicon.ico`;
}

export function TabFavicon({ url }: { url: string }) {
	const favicon = useMemo(() => faviconUrlOf(url), [url]);
	const [loaded, setLoaded] = useState(false);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		setLoaded(false);
		setFailed(false);
	}, [favicon]);

	if (!favicon || failed) {
		return <Globe className="h-3 w-3 shrink-0 text-pi-text-muted" />;
	}
	return (
		<span className="relative flex h-3 w-3 shrink-0">
			<Globe
				className={cn("h-3 w-3 text-pi-text-muted transition-opacity", loaded && "opacity-0")}
			/>
			<img
				src={favicon}
				alt=""
				loading="lazy"
				referrerPolicy="no-referrer"
				draggable={false}
				onLoad={() => setLoaded(true)}
				onError={() => setFailed(true)}
				className={cn("absolute inset-0 h-3 w-3 rounded-[2px]", loaded ? "opacity-100" : "opacity-0")}
			/>
		</span>
	);
}
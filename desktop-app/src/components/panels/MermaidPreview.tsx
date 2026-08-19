import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useDarkMode } from "../../hooks/useDarkMode";
import { renderMermaidSvg } from "../markdown/embeds/mermaid-embed";
import { Zoomable } from "../markdown/Zoomable";
import { cn } from "../../lib/cn";

// Standalone mermaid source (.mmd / .mermaid) preview for the file artifact
// panel. Renders the diagram full-height with a click-to-zoom lightbox; falls
// back to the raw source on parse failure. Reuses the shared render path with
// the in-chat ```mermaid renderer so theme/init stay consistent.
export function MermaidPreview({ code }: { code: string }) {
	const isDark = useDarkMode();
	const [svg, setSvg] = useState("");
	const [status, setStatus] = useState<"loading" | "ok" | "failed">("loading");
	const [error, setError] = useState<string>("");

	useEffect(() => {
		let cancelled = false;
		setStatus("loading");
		setSvg("");
		setError("");
		void (async () => {
			try {
				const rendered = await renderMermaidSvg(code, isDark);
				if (!cancelled) {
					setSvg(rendered);
					setStatus("ok");
				}
			} catch (e) {
				// Surface the real error so CSP / parse / DOM failures are
				// diagnosable in the webview (no devtools in the shipped DMG).
				const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
				const stack = e instanceof Error && e.stack ? `\n${e.stack}` : "";
				// eslint-disable-next-line no-console
				console.error("[MermaidPreview] render failed:", e);
				if (!cancelled) {
					setError((msg + stack).slice(0, 1200));
					setStatus("failed");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [code, isDark]);

	if (status === "loading") {
		return (
			<div className="flex h-full items-center justify-center gap-2 text-2xs text-pi-text-muted">
				<Loader2 className="h-3 w-3 animate-spin" /> Rendering diagram…
			</div>
		);
	}

	if (status === "failed" || !svg) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
				<p className="text-2xs text-pi-error">Couldn&apos;t render the diagram.</p>
				{error && (
					<pre className="mt-1 max-h-[40%] w-full overflow-auto rounded-md border border-pi-border bg-pi-surface p-3 text-left font-mono text-3xs leading-relaxed text-pi-text-muted whitespace-pre-wrap wrap-anywhere">
						{error}
					</pre>
				)}
				<pre className="mt-2 max-h-[45%] w-full overflow-auto rounded-md border border-pi-border bg-pi-surface p-3 text-left font-mono text-2xs leading-relaxed text-pi-text-secondary whitespace-pre-wrap wrap-anywhere">
					{code}
				</pre>
			</div>
		);
	}

	return (
		<div className="h-full overflow-auto bg-pi-bg p-4">
			<Zoomable
				label="Open diagram"
				overlay={
					<div
						className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-[85vh] [&_svg]:max-w-[90vw]"
						dangerouslySetInnerHTML={{ __html: svg }}
					/>
				}
			>
				<div
					className={cn(
						"flex min-h-full items-center justify-center [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:max-w-full",
					)}
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
			</Zoomable>
		</div>
	);
}
export default MermaidPreview;

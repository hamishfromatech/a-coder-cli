import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { cn } from "../../../lib/cn";
import { Zoomable } from "../Zoomable";
import type { RichFenceProps } from "./types";
import { useIsDark } from "./use-is-dark";

let lastTheme: "dark" | "default" | null = null;

function ensureInit(dark: boolean) {
	const theme = dark ? "dark" : "default";
	if (theme === lastTheme) return;
	mermaid.initialize({ fontFamily: "inherit", securityLevel: "strict", startOnLoad: false, theme });
	lastTheme = theme;
}

// Tolerant front-matter stripping. Mermaid line comments are `%%`, but .mmd
// files commonly start with a markdown-style `# Title` heading (or blank/
// `%%` lines) before the actual diagram. A leading `#` line is not valid
// mermaid syntax and makes the parser throw `UnknownDiagramError`, so we drop
// leading blank / `#` / `%%` lines until the first real diagram line. We stop at
// anything else (including `---` YAML front-matter, which mermaid handles).
function stripLeadingMermaidComments(code: string): string {
	const lines = code.split("\n");
	let i = 0;
	while (i < lines.length) {
		const trimmed = lines[i].trim();
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("%%")) {
			i++;
			continue;
		}
		break;
	}
	return lines.slice(i).join("\n").trim();
}

// Shared render path used by both the chat fence renderer and the artifact
// preview panel. Ensures the singleton is initialized for the current theme
// and returns the rendered SVG string. Throws on parse failure (callers
// catch and fall back to source).
export async function renderMermaidSvg(code: string, isDark: boolean): Promise<string> {
	ensureInit(isDark);
	const source = stripLeadingMermaidComments(code);
	const id = `mmd-${Math.random().toString(36).slice(2)}`;
	const result = await mermaid.render(id, source);
	return result.svg;
}

function SourcePreview({ code, muted }: { code: string; muted?: boolean }) {
	return (
		<pre
			className={cn(
				"overflow-auto p-3 font-mono text-[0.7rem] leading-relaxed whitespace-pre-wrap wrap-anywhere",
				muted ? "text-pi-text-muted" : "text-pi-text-secondary",
			)}
		>
			{code}
		</pre>
	);
}

// Renders ```mermaid fences as diagrams; shows the source while the message
// streams (partial syntax throws) and falls back to source on parse failure.
export default function MermaidRenderer({ code, streaming }: RichFenceProps) {
	const isDark = useIsDark();
	const [svg, setSvg] = useState("");
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (streaming) return;
		let cancelled = false;
		setFailed(false);
		void (async () => {
			try {
				const svg = await renderMermaidSvg(code, isDark);
				if (!cancelled) setSvg(svg);
			} catch {
				if (!cancelled) {
					setFailed(true);
					setSvg("");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [code, isDark, streaming]);

	if (streaming) return <SourcePreview code={code} muted />;
	if (failed) return <SourcePreview code={code} />;
	if (!svg) return <SourcePreview code={code} muted />;

	return (
		<Zoomable
			label="Open diagram"
			overlay={
				<div
					className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-[80vh] [&_svg]:max-w-[85vw]"
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
			}
		>
			<div
				className="overflow-hidden p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-[33dvh] [&_svg]:max-w-full"
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
		</Zoomable>
	);
}
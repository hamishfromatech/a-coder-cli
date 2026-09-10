import {
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";
import {
	ArrowLeft,
	ExternalLink,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	Volume2,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
	canPreview,
	canShowRaw,
	getFileKind,
	getLanguage,
	isTextFile,
} from "../../lib/files";
import { openInEditor, readTextFile } from "../../lib/rpc";

/** URL that streams a local file through Tauri's asset protocol — works for
 *  any size (no base64-over-IPC), supports Range requests for video seeking,
 *  and renders PDFs natively in WKWebView/WebView2. */
function localFileUrl(fullPath: string): string {
	return convertFileSrc(fullPath);
}
import { useUiStore } from "../../stores/ui-store";
import { useDarkMode } from "../../hooks/useDarkMode";
import { MarkdownTextContent } from "../markdown/MarkdownText";
import { lazy, Suspense } from "react";

// Lazy: pulls mermaid (~600KB) only when a .mmd/.mermaid file is previewed.
const MermaidPreview = lazy(() => import("./MermaidPreview"));

interface Props {
	projectPath: string | null;
	path: string;
}

export function ArtifactViewer({ projectPath, path }: Props) {
	const { setSelectedArtifactPath, selectedArtifactViewMode, setSelectedArtifactViewMode } =
		useUiStore();
	const [content, setContent] = useState<string | null>(null);
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const kind = getFileKind(path);
	const fullPath = projectPath ? `${projectPath}/${path}` : null;

	const load = async () => {
		if (!fullPath) return;
		setLoading(true);
		setError(null);
		setContent(null);
		setDataUrl(null);
		try {
			const mode = selectedArtifactViewMode;
			if (mode === "preview" && (kind === "image" || kind === "svg" || kind === "audio" || kind === "video" || kind === "pdf")) {
				// Binary media streams straight off disk through the asset protocol:
				// no size cap, and video seeking works via Range requests.
				setDataUrl(localFileUrl(fullPath));
			} else if (mode === "preview" && kind === "csv") {
				setContent(await readTextFile(fullPath));
			} else if (isTextFile(kind)) {
				// Preview mode renders text kinds as rich content; raw mode as code.
				setContent(await readTextFile(fullPath));
			} else {
				setError("This file can't be previewed.");
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fullPath, selectedArtifactViewMode, kind]);

	const showRaw = canShowRaw(kind);
	const showPreview = canPreview(kind);
	const canToggle = showRaw && showPreview;

	return (
		<div className="flex h-full w-full min-w-0 flex-col">
			{/* Header */}
			<div className="flex items-center gap-2 border-b border-pi-border px-2 py-1.5">
				<button
					onClick={() => setSelectedArtifactPath(null)}
					className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
aria-label="Back to files"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
				</button>

				<div className="min-w-0 flex-1 truncate font-mono text-2xs text-pi-text">
					{path}
				</div>

				{canToggle && (
					<div className="flex items-center rounded-md border border-pi-border bg-pi-surface-raised p-0.5">
						<ToggleButton
							active={selectedArtifactViewMode === "raw"}
							onClick={() => setSelectedArtifactViewMode("raw")}
							label="Raw"
						/>
						<ToggleButton
							active={selectedArtifactViewMode === "preview"}
							onClick={() => setSelectedArtifactViewMode("preview")}
							label="Preview"
						/>
					</div>
				)}

				<button
					onClick={() => void load()}
					className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
aria-label="Refresh"
					disabled={loading}
				>
					{loading ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<RefreshCw className="h-3 w-3" />
					)}
				</button>

				<button
					onClick={() => fullPath && void openInEditor(fullPath)}
					className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
aria-label="Open in editor"
				>
					<ExternalLink className="h-3 w-3" />
				</button>
			</div>

			{/* Body */}
			<div className="flex-1 min-h-0 overflow-hidden bg-pi-bg">
				{loading && (
					<div className="flex h-full items-center justify-center gap-2 text-2xs text-pi-text-muted">
						<Loader2 className="h-3 w-3 animate-spin" /> Loading file…
					</div>
				)}

				{!loading && error && (
					<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
						<p className="text-2xs text-pi-error">{error}</p>
						{fullPath && (
							<button
								onClick={() => void openInEditor(fullPath)}
								className="text-2xs text-pi-accent underline underline-offset-2 hover:text-pi-accent-hover"
							>
								Open in editor
							</button>
						)}
					</div>
				)}

				{!loading && !error && selectedArtifactViewMode === "preview" && (
					<PreviewBody path={path} kind={kind} fullPath={fullPath} content={content} dataUrl={dataUrl} />
				)}

				{!loading && !error && selectedArtifactViewMode === "raw" && (
					<RawBody path={path} content={content} />
				)}
			</div>
		</div>
	);
}

function ToggleButton({
	active,
	onClick,
	label,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			onClick={onClick}
			className={`rounded px-2 py-0.5 text-3xs font-medium transition-hover focus-visible:shadow-focus focus-visible:outline-none ${
				active
					? "bg-pi-accent text-white shadow-sm"
					: "text-pi-text-muted hover:bg-pi-surface-overlay hover:text-pi-text"
			}`}
		>
			{label}
		</button>
	);
}

function RawBody({ path, content }: { path: string; content: string | null }) {
	if (content === null) {
		return (
			<div className="flex h-full items-center justify-center text-2xs text-pi-text-faint">
				No content.
			</div>
		);
	}
	return <CodeFileView path={path} content={content} />;
}

function PreviewBody({
	path,
	kind,
	fullPath,
	content,
	dataUrl,
}: {
	path: string;
	kind: ReturnType<typeof getFileKind>;
	fullPath: string | null;
	content: string | null;
	dataUrl: string | null;
}) {
	if (kind === "html" && content !== null) {
		return <HtmlPreview html={content} />;
	}

	if (kind === "markdown" && content !== null) {
		return (
			<div className="h-full overflow-auto bg-pi-bg p-4">
				<MarkdownTextContent text={content} isRunning={false} />
			</div>
		);
	}

	if ((kind === "image" || kind === "svg") && dataUrl !== null) {
		return (
			<div className="flex h-full items-center justify-center overflow-auto bg-pi-bg p-4">
				<img
					src={dataUrl}
					alt=""
					className="max-h-full max-w-full object-contain"
				/>
			</div>
		);
	}

	if ((kind === "audio" || kind === "video") && dataUrl !== null) {
		return <MediaPlayer kind={kind} src={dataUrl} title={path} fullPath={fullPath} />;
	}

	if (kind === "pdf" && dataUrl !== null) {
		return <PdfPreview src={dataUrl} fullPath={fullPath} />;
	}

	if (kind === "csv" && content !== null) {
		return <CsvPreview text={content} delimiter={path.toLowerCase().endsWith(".tsv") ? "\t" : ","} />;
	}

	if (kind === "mermaid" && content !== null) {
		return (
			<Suspense
				fallback={
					<div className="flex h-full items-center justify-center gap-2 text-2xs text-pi-text-muted">
						<Loader2 className="h-3 w-3 animate-spin" /> Loading…
					</div>
				}
			>
				<MermaidPreview code={content} />
			</Suspense>
		);
	}

	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-2xs text-pi-text-faint">
			<p>No preview available for this file type.</p>
		</div>
	);
}

// Renders an HTML artifact in an isolated iframe via a blob: URL. A blob
// document does not inherit the app's strict CSP, so external CDNs (Tailwind,
// fonts, etc.) load and run; the sandbox keeps the iframe at an opaque origin
// (no `allow-same-origin`) so it cannot touch the app's storage.
function HtmlPreview({ html }: { html: string }) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		const blob = new Blob([html], { type: "text/html;charset=utf-8" });
		const blobUrl = URL.createObjectURL(blob);
		setUrl(blobUrl);
		return () => URL.revokeObjectURL(blobUrl);
	}, [html]);
	if (!url) return null;
	return (
		<iframe
			title="HTML preview"
			src={url}
			sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
			className="h-full w-full border-0 bg-pi-bg"
		/>
	);
}

/** PDF preview: the webview's native PDF renderer in a sandboxed iframe (no
 *  scripts). Asset URLs stream any file size. If the viewer can't render it,
 *  fall back to opening the file externally. */
function PdfPreview({ src, fullPath }: { src: string; fullPath: string | null }) {
	const [failed, setFailed] = useState(false);
	return (
		<div className="relative h-full w-full bg-pi-bg">
			{failed ? (
				<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-2xs text-pi-text-faint">
					<p>This PDF can't be displayed in-app.</p>
					{fullPath && (
						<button
							onClick={() => void openInEditor(fullPath)}
							className="text-2xs text-pi-accent underline underline-offset-2 hover:text-pi-accent-hover"
						>
							Open with system viewer
						</button>
					)}
				</div>
			) : (
				<iframe
					title="PDF preview"
					src={src}
					sandbox=""
					className="h-full w-full border-0 bg-pi-bg"
					// PDFs render without scripts; an onerror-free but blank frame is
					// indistinguishable from success, so offer the escape hatch after
					// a load timeout instead of guessing.
					onError={() => setFailed(true)}
				/>
			)}
		</div>
	);
}

/** CSV/TSV preview: parsed into a sticky-header table. Caps rows/columns so a
 *  100MB export doesn't try to render a million DOM cells. */
const CSV_MAX_ROWS = 300;
const CSV_MAX_COLS = 32;

function parseDelimited(text: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === delimiter) {
			row.push(field);
			field = "";
			if (row.length >= CSV_MAX_COLS) {
				// Overwide row: truncate the tail silently (noted by the renderer).
				row.length = CSV_MAX_COLS - 1;
				row.push("…");
			}
		} else if (ch === "\n") {
			row.push(field);
			field = "";
			rows.push(row);
			row = [];
			if (rows.length >= CSV_MAX_ROWS) return rows;
		} else if (ch === "\r") {
			// normalize CRLF: skip, \n handles it
		} else {
			field += ch;
		}
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

function CsvPreview({ text, delimiter }: { text: string; delimiter: string }) {
	const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
	if (rows.length === 0) {
		return <div className="flex h-full items-center justify-center text-2xs text-pi-text-faint">Empty file.</div>;
	}
	const [header, ...body] = rows;
	const truncated = body.length >= CSV_MAX_ROWS || rows.some((r) => r.at(-1) === "…");
	return (
		<div className="h-full overflow-auto bg-pi-bg">
			<table className="border-collapse text-xs">
				<thead className="sticky top-0 z-10">
					<tr>
						{header!.map((cell, i) => (
							<th
								key={i}
								className="border-b border-pi-border bg-pi-surface px-3 py-1.5 text-left font-semibold text-pi-text"
							>
								{cell}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{body.map((row, r) => (
						<tr key={r} className={r % 2 === 0 ? "bg-pi-bg" : "bg-pi-surface/40"}>
							{row.map((cell, c) => (
								<td key={c} className="max-w-64 truncate border-b border-pi-border/50 px-3 py-1 font-mono text-3xs text-pi-text-secondary">
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{truncated && (
				<p className="px-3 py-2 text-3xs text-pi-text-faint">
					Preview truncated at {CSV_MAX_ROWS} rows / {CSV_MAX_COLS} columns.
				</p>
			)}
		</div>
	);
}

function MediaPlayer({ kind, src, title, fullPath }: { kind: "audio" | "video"; src: string; title: string; fullPath: string | null }) {
	const ref = useRef<HTMLAudioElement | HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);
	const [volume, setVolume] = useState(1);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [failed, setFailed] = useState(false);

	const onMediaError = () => {
		// WebKit/WebView2 can't decode every container (MKV, AVI, WMV, FLV…).
		// Surface that instead of a silent player.
		setFailed(true);
	};

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const onPlay = () => setPlaying(true);
		const onPause = () => setPlaying(false);
		const onEnded = () => setPlaying(false);
		const onTime = () => setCurrentTime(el.currentTime);
		const onLoaded = () => setDuration(el.duration || 0);

		el.addEventListener("play", onPlay);
		el.addEventListener("pause", onPause);
		el.addEventListener("ended", onEnded);
		el.addEventListener("timeupdate", onTime);
		el.addEventListener("loadedmetadata", onLoaded);
		return () => {
			el.removeEventListener("play", onPlay);
			el.removeEventListener("pause", onPause);
			el.removeEventListener("ended", onEnded);
			el.removeEventListener("timeupdate", onTime);
			el.removeEventListener("loadedmetadata", onLoaded);
		};
	}, []);

	const toggle = () => {
		const el = ref.current;
		if (!el) return;
		if (el.paused) void el.play();
		else el.pause();
	};

	const fmt = (n: number) => {
		if (!Number.isFinite(n)) return "0:00";
		const m = Math.floor(n / 60);
		const s = Math.floor(n % 60)
			.toString()
			.padStart(2, "0");
		return `${m}:${s}`;
	};

	if (failed) {
		return (
			<div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-pi-bg p-4 text-center text-2xs text-pi-text-faint">
				<p>
					This {kind === "video" ? "video" : "audio"} format can't be played in-app ({title.split(".").pop()?.toUpperCase()}).
				</p>
				{fullPath && (
					<button
						onClick={() => void openInEditor(fullPath)}
						className="text-2xs text-pi-accent underline underline-offset-2 hover:text-pi-accent-hover"
					>
						Open with system player
					</button>
				)}
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-pi-bg p-4">
			{kind === "video" ? (
				<video
					ref={ref as React.RefObject<HTMLVideoElement>}
					src={src}
					title={title}
					controls={false}
					className="max-h-[70%] max-w-full rounded-lg border border-pi-border bg-black"
					preload="metadata"
					onError={onMediaError}
				/>
			) : (
				<audio ref={ref as React.RefObject<HTMLAudioElement>} src={src} preload="metadata" onError={onMediaError} />
			)}
			<div className="flex w-full max-w-md items-center gap-2 rounded-lg border border-pi-border bg-pi-surface p-2">
				<button
					onClick={toggle}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent transition-hover hover:bg-pi-accent hover:text-white"
					aria-label={playing ? "Pause" : "Play"}
				>
					{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
				</button>
				<span className="w-16 text-center font-mono text-2xs text-pi-text-secondary">
					{fmt(currentTime)} / {fmt(duration)}
				</span>
				<input
					type="range"
					min={0}
					max={duration || 1}
					step={0.1}
					value={Math.min(currentTime, duration || 0)}
					onChange={(e) => {
						const el = ref.current;
						if (!el) return;
						el.currentTime = Number(e.target.value);
					}}
					className="h-1 flex-1 pi-range"
				/>
				<Volume2 className="h-3.5 w-3.5 text-pi-text-muted" />
				<input
					type="range"
					min={0}
					max={1}
					step={0.01}
					value={volume}
					onChange={(e) => {
						const v = Number(e.target.value);
						setVolume(v);
						if (ref.current) ref.current.volume = v;
					}}
					className="h-1 w-20 pi-range"
				/>
			</div>
		</div>
	);
}

function CodeFileView({ path, content }: { path: string; content: string }) {
	const isDark = useDarkMode();
	const style = isDark ? vscDarkPlus : oneLight;
	const language = getLanguage(path);

	if (!language) {
		return (
			<pre className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed text-pi-text">
				{content}
			</pre>
		);
	}

	return (
		<div className="h-full overflow-auto">
			<SyntaxHighlighter
				language={language}
				style={style}
				showLineNumbers
				lineNumberStyle={{ minWidth: "2.5em", paddingRight: "1em", color: "var(--pi-text-faint)" }}
				customStyle={{
					margin: 0,
					padding: "1rem",
					background: "transparent",
					fontSize: "12px",
					lineHeight: "1.6",
					minHeight: "100%",
				}}
				codeTagProps={{
					style: {
						fontFamily:
							'"JetBrains Mono", "Geist Mono", ui-monospace, monospace',
					},
				}}
			>
				{content}
			</SyntaxHighlighter>
		</div>
	);
}

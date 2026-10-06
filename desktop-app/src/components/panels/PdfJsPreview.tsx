import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { readFileBase64 } from "../../lib/rpc";
import { cn } from "../../lib/cn";

// One shared worker for the whole app; pdf.js reuses it across documents.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

interface Props {
	/** Absolute file path — bytes stream in through the binary read command. */
	fullPath: string;
	/** Called to hand the escape hatch (system viewer) to the parent UI. */
	onOpenExternal?: () => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

/** Zoom presets — plain numbers are exact scale multiples. */
function stepZoom(zoom: number, dir: 1 | -1): number {
	const next = zoom + dir * 0.25;
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
}

/**
 * In-app PDF preview rendered by pdf.js to a canvas: works identically in
 * WKWebView (macOS — which cannot render PDFs in iframes at all) and WebView2
 * (Windows — where the built-in viewer is blocked by the strict preview
 * sandbox). Bytes arrive via the file-read command (8MB cap; larger files fall
 * back to the system-viewer escape hatch).
 */
export function PdfJsPreview({ fullPath, onOpenExternal }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
	const [page, setPage] = useState(1);
	const [zoom, setZoom] = useState(1);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Load the document once per file. The loading task owns the connection
	// (pdf.js 6 moved destroy off the document proxy), so it's what we cancel.
	const taskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
	useEffect(() => {
		let cancelled = false;

		const load = async () => {
			setLoading(true);
			setError(null);
			setDoc(null);
			setPage(1);
			try {
				const { content } = await readFileBase64(fullPath);
				const binary = atob(content);
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i++) {
					bytes[i] = binary.charCodeAt(i);
				}
				const task = pdfjsLib.getDocument({ data: bytes });
				taskRef.current = task;
				const loaded = await task.promise;
				if (cancelled) return;
				setDoc(loaded);
			} catch (e) {
				if (!cancelled) {
					const message = e instanceof Error ? e.message : String(e);
					setError(message);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void load();

		return () => {
			cancelled = true;
			void taskRef.current?.destroy();
		};
	}, [fullPath]);

	// Render the active page.
	useEffect(() => {
		if (!doc || !canvasRef.current) return;
		let cancelled = false;
		const render = async () => {
			const canvas = canvasRef.current;
			if (!canvas) return;
			try {
				const pdfPage = await doc.getPage(page);
				if (cancelled) return;

				// Size the canvas to the container width * zoom, in device pixels.
				const container = canvas.parentElement;
				const available = container ? container.clientWidth - 24 : 800;
				const dpr = window.devicePixelRatio || 1;
				const base = pdfPage.getViewport({ scale: 1 });
				const scale = Math.max(MIN_ZOOM, (available / base.width) * zoom) * dpr;
				const viewport = pdfPage.getViewport({ scale });
				canvas.width = Math.floor(viewport.width);
				canvas.height = Math.floor(viewport.height);
				canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
				canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

				const task = pdfPage.render({ canvas, viewport });
				await task.promise;
			} catch (e) {
				if (!cancelled && e instanceof Error && !e.message.includes("RenderingCancelled")) {
					setError(e.message);
				}
			}
		};
		void render();
		return () => {
			cancelled = true;
		};
	}, [doc, page, zoom]);

	return (
		<div className="flex h-full flex-col bg-pi-bg">
			{/* Toolbar */}
			<div className="flex shrink-0 items-center justify-center gap-2 border-b border-pi-border bg-pi-surface px-3 py-1.5">
				<button
					type="button"
					className="rounded p-1 text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:opacity-40"
					onClick={() => setPage((p) => Math.max(1, p - 1))}
					disabled={!doc || page <= 1}
					aria-label="Previous page"
				>
					<ChevronUp className="h-3.5 w-3.5" />
				</button>
				<span className="min-w-14 text-center font-mono pi-tabular text-2xs text-pi-text-secondary">
					{page} / {doc?.numPages ?? "…"}
				</span>
				<button
					type="button"
					className="rounded p-1 text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:opacity-40"
					onClick={() => setPage((p) => Math.min(doc?.numPages ?? 1, p + 1))}
					disabled={!doc || page >= doc.numPages}
					aria-label="Next page"
				>
					<ChevronDown className="h-3.5 w-3.5" />
				</button>
				<span className="mx-1 h-4 w-px bg-pi-border" />
				<button
					type="button"
					className="rounded px-1 font-mono text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:opacity-40"
					onClick={() => setZoom((z) => stepZoom(z, -1))}
					disabled={zoom <= MIN_ZOOM}
					aria-label="Zoom out"
				>
					−
				</button>
				<span
					className="min-w-10 text-center font-mono pi-tabular text-2xs text-pi-text-secondary"
					aria-live="polite"
				>
					{Math.round(zoom * 100)}%
				</span>
				<button
					type="button"
					className="rounded px-1 font-mono text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:opacity-40"
					onClick={() => setZoom((z) => stepZoom(z, 1))}
					disabled={zoom >= MAX_ZOOM}
					aria-label="Zoom in"
				>
					+
				</button>
			</div>

			{/* Page canvas */}
			<div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-3">
				{loading && (
					<div className="flex items-center gap-2 self-center text-2xs text-pi-text-faint">
						<Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading PDF…
					</div>
				)}
				{error && !loading && (
					<div className="flex flex-col items-center gap-2 self-center p-4 text-center text-2xs text-pi-text-faint">
						<p>This PDF can't be displayed in-app.</p>
						<p className="max-w-72 break-words text-pi-text-faint opacity-70">{error}</p>
						{onOpenExternal && (
							<button
								type="button"
								onClick={onOpenExternal}
								className="text-2xs text-pi-accent underline underline-offset-2 hover:text-pi-accent-hover"
							>
								Open with system viewer
							</button>
						)}
					</div>
				)}
				<canvas
					ref={canvasRef}
					className={cn("shadow-card", !loading && !error ? "block" : "hidden")}
				/>
			</div>
		</div>
	);
}
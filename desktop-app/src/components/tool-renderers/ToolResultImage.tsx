import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { inlineDataUrl, loadAttachmentDataUrl } from "../../lib/attachment-cache";
import { ModalBackdrop } from "../ui/Modal";
import type { ResultImageRef } from "./toolResult";

/**
 * One image block from a tool result (screenshots from `computer capture` /
 * `zoom`). Handles both inline base64 and the history path's attachment refs,
 * and opens a lightbox on click.
 */
export function ToolResultImage({ image, index }: { image: ResultImageRef; index: number }) {
	const [src, setSrc] = useState<string | undefined>(() =>
		image.data ? inlineDataUrl(image.mimeType ?? "image/png", image.data) : undefined,
	);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (src || !image.attachment) return;
		let cancelled = false;
		void loadAttachmentDataUrl(image.attachment)
			.then((url) => {
				if (!cancelled) setSrc(url);
			})
			.catch(() => {
				// Leave the placeholder: the transcript stays readable without the image.
			});
		return () => {
			cancelled = true;
		};
	}, [src, image.attachment]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<>
			<button
				type="button"
				onClick={() => src && setOpen(true)}
				disabled={!src}
				aria-label={`Open result image ${index + 1}`}
				className="group relative overflow-hidden rounded-md border border-pi-border bg-pi-bg/60 transition-smooth hover:border-pi-accent/40 focus-visible:shadow-focus focus-visible:outline-none"
			>
				{src ? (
					<img
						src={src}
						alt={`Tool result ${index + 1}`}
						loading="lazy"
						className="block max-h-44 w-auto max-w-full object-contain transition-smooth group-hover:brightness-110"
					/>
				) : (
					<div className="h-24 w-36 animate-pulse bg-pi-surface-overlay" />
				)}
				<span className="absolute bottom-1 right-1 rounded bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
					<ImageIcon className="h-3 w-3" />
				</span>
			</button>
			{open && src && (
				<ModalBackdrop
					className="z-zoom bg-black/85"
					onClick={() => setOpen(false)}
				>
					<img
						src={src}
						alt={`Tool result ${index + 1} full size`}
						className="max-h-full max-w-full rounded-lg shadow-overlay"
						onClick={(event) => event.stopPropagation()}
					/>
				</ModalBackdrop>
			)}
		</>
	);
}

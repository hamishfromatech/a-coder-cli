import { type ComponentProps, useState } from "react";
import { cn } from "../../lib/cn";

// Image that opens a fullscreen lightbox on click. Adapted from Hermes'
// chat/zoomable-image.

function MarkdownImage({ className, src, alt, ...props }: ComponentProps<"img">) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				className="my-2 block w-fit max-w-full cursor-zoom-in"
				onClick={() => setOpen(true)}
				type="button"
			>
				<img
					alt={alt}
					className={cn(
						"m-0 block h-auto w-auto max-h-[var(--pi-image-preview-height)] max-w-[min(100%,var(--pi-image-preview-max-width))] rounded-lg object-contain shadow-card",
						className,
					)}
					loading="lazy"
					src={src}
					{...props}
				/>
			</button>
			{open && (
				<div
					className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
					onClick={() => setOpen(false)}
				>
					<img
						alt={alt ?? "Attached full size"}
						className="max-h-full max-w-full rounded-lg shadow-overlay"
						onClick={(e) => e.stopPropagation()}
						src={src}
					/>
				</div>
			)}
		</>
	);
}

export const ZoomableImage = MarkdownImage;
import { type ReactNode, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

// Click-to-enlarge wrapper: inline children render capped, clicking opens a
// fullscreen overlay with wheel zoom. Simplified from Hermes' ui/zoomable (no
// copy-as-PNG / pan gestures).

interface ZoomableProps {
	children: ReactNode;
	className?: string;
	overlay?: ReactNode;
	label?: string;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 3.0;
const STEP = 0.2;

export function Zoomable({ children, className, overlay, label = "Open" }: ZoomableProps) {
	const [open, setOpen] = useState(false);
	const [scale, setScale] = useState(1);
	return (
		<>
			<button
				className={cn("block w-full cursor-zoom-in", className)}
				onClick={() => setOpen(true)}
				aria-label={label}
				type="button"
			>
				{children}
			</button>
			{open && (
				<div
					className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
					onClick={() => setOpen(false)}
				>
					<button
						className="absolute right-3 top-3 rounded-md bg-black/50 p-1.5 text-white transition-smooth hover:bg-black/70"
						onClick={() => setOpen(false)}
						type="button"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
					<div
						className="max-h-full max-w-full overflow-auto"
						onClick={(e) => e.stopPropagation()}
						onWheel={(e) => {
							e.preventDefault();
							const delta = e.deltaY > 0 ? -STEP : STEP;
							setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta)));
						}}
						style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
					>
						{overlay ?? children}
					</div>
				</div>
			)}
		</>
	);
}
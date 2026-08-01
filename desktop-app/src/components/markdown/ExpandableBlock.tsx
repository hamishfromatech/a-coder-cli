import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

// Expandable collapse for code bodies / large pre blocks. Collapses to ~7.5rem
// with a gradient "expand" affordance; expands to 40dvh. Ported from Hermes.

interface ExpandableBlockProps {
	children: ReactNode;
	className?: string;
}

export function ExpandableBlock({ children, className }: ExpandableBlockProps) {
	const innerRef = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [overflowing, setOverflowing] = useState(false);

	const measure = useCallback(() => {
		const el = innerRef.current;
		if (el) setOverflowing(el.scrollHeight > 121);
	}, []);

	useEffect(() => {
		const el = innerRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => measure());
		ro.observe(el);
		measure();
		return () => ro.disconnect();
	}, [measure]);

	return (
		<div className="relative">
			<div
				className={cn("overflow-y-auto", expanded ? "max-h-[40dvh]" : "max-h-[7.5rem]", className)}
				ref={innerRef}
			>
				{children}
			</div>
			{overflowing && (
				<button
					aria-expanded={expanded}
					aria-label={expanded ? "Collapse" : "Expand"}
					className="absolute inset-x-0 bottom-0 flex h-7 cursor-pointer items-end justify-center bg-gradient-to-t from-pi-bg to-transparent pb-1 text-pi-text-muted transition-smooth hover:text-pi-text"
					onClick={() => setExpanded((v) => !v)}
					type="button"
				>
					<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
				</button>
			)}
		</div>
	);
}
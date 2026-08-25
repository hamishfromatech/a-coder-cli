import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "../../lib/cn";

// The single canonical error glyph. Use everywhere an error is surfaced
// (boundaries, dialogs, banners) so failures read identically.
export function ErrorIcon({
	className,
	size = "1.5rem",
}: {
	className?: string;
	size?: string;
}) {
	return (
		<AlertCircle
			className={cn("text-pi-error", className)}
			style={{ width: size, height: size }}
		/>
	);
}

export interface ErrorStateProps {
	children?: ReactNode;
	className?: string;
	description?: ReactNode;
	icon?: ReactNode;
	title: ReactNode;
}

// Shared, presentation-only error layout: the canonical ErrorIcon over a
// centered title + body, with an optional actions stack.
export function ErrorState({
	children,
	className,
	description,
	icon,
	title,
}: ErrorStateProps) {
	return (
		<div className={cn("grid gap-5", className)}>
			<div className="flex flex-col items-center gap-3 text-center">
				{icon ?? <ErrorIcon />}

				{typeof title === "string" ? (
					<h2 className="text-center text-lg font-semibold tracking-tight">{title}</h2>
				) : (
					title
				)}

				{typeof description === "string" ? (
					<p className="max-w-prose text-center text-xs leading-5 text-pi-text-muted">
						{description}
					</p>
				) : (
					description
				)}
			</div>

			{children && <div className="grid gap-2">{children}</div>}
		</div>
	);
}

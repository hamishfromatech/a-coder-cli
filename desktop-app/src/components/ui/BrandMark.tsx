import { Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";

// Brand badge: Nous mark on a white tile, identical in light/dark.
// Fills the tile (softly rounded); size via className (default size-8).
export function BrandMark({
	className,
	children,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white text-pi-accent",
				className,
			)}
			{...props}
		>
			{children ?? <Sparkles className="size-4" />}
		</span>
	);
}

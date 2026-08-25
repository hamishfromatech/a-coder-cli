import { cn } from "../../lib/cn";

export function EmptyState({
	title,
	description,
	className,
}: {
	title: string;
	description?: string;
	className?: string;
}) {
	return (
		<div className={cn("grid min-h-48 place-items-center text-center", className)}>
			<div>
				<div className="text-sm font-medium">{title}</div>
				{description && (
					<div className="mt-1 text-xs text-pi-text-muted">{description}</div>
				)}
			</div>
		</div>
	);
}

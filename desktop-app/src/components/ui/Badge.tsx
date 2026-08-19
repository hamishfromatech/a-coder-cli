import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export type BadgeVariant =
	| "default"
	| "accent"
	| "success"
	| "error"
	| "warning"
	| "muted"
	| "outline";

const variantClasses: Record<BadgeVariant, string> = {
	default:
		"bg-pi-surface-overlay text-pi-text-secondary border-pi-border",
	accent: "bg-pi-accent-soft text-pi-accent border-transparent",
	success: "bg-pi-success/10 text-pi-success border-transparent",
	error: "bg-pi-error/10 text-pi-error border-transparent",
	warning: "bg-amber-500/10 text-amber-500 border-transparent",
	muted: "bg-pi-surface-raised text-pi-text-muted border-transparent",
	outline:
		"bg-transparent text-pi-text-muted border-pi-border hover:border-pi-border/80",
};

const sizeClasses = {
	sm: "px-1 py-0.5 text-4xs gap-0.5",
	md: "px-1.5 py-0.5 text-3xs gap-1",
	lg: "px-2 py-1 text-2xs gap-1",
};

export const Badge = forwardRef<
	HTMLSpanElement,
	{
		children: React.ReactNode;
		variant?: BadgeVariant;
		size?: "sm" | "md" | "lg";
		className?: string;
		icon?: React.ComponentType<{ className?: string }>;
	} & React.HTMLAttributes<HTMLSpanElement>
>(function Badge({ children, variant = "default", size = "md", className, icon: Icon, ...props }, ref) {
	const { ...rest } = props;
	return (
		<span
			ref={ref}
			className={cn(
				"inline-flex shrink-0 items-center rounded border font-medium uppercase tracking-wide",
				variantClasses[variant],
				sizeClasses[size],
				className,
			)}
			{...rest}
		>
			{Icon && (
				<Icon
					className={cn(
						"shrink-0",
						size === "sm" ? "h-2.5 w-2.5" : size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3",
					)}
				/>
			)}
			{children}
		</span>
	);
});
Badge.displayName = "Badge";

export function StatusDot({
	variant = "accent",
	className,
}: {
	variant?: Exclude<BadgeVariant, "outline">;
	className?: string;
}) {
	const tone = {
		default: "bg-pi-text-secondary",
		accent: "bg-pi-accent",
		success: "bg-pi-success",
		error: "bg-pi-error",
		warning: "bg-amber-500",
		muted: "bg-pi-text-muted",
	}[variant];
	return (
		<span
			className={cn(
				"inline-block h-1.5 w-1.5 rounded-full",
				tone,
				className,
			)}
		/>
	);
}

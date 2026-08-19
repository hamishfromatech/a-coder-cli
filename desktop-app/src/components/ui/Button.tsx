import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { triggerHaptic } from "../../lib/haptics";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ghost-danger";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
	icon?: React.ComponentType<{ className?: string }>;
	children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const variantClasses: Record<ButtonVariant, string> = {
	primary:
		"bg-pi-accent text-white shadow-ring-accent hover:bg-pi-accent-hover",
	secondary:
		"bg-pi-surface-raised text-pi-text shadow-ring hover:bg-pi-surface-overlay",
	ghost: "text-pi-text-secondary hover:bg-pi-surface-raised hover:text-pi-text",
	danger:
		"bg-pi-error text-white shadow-[0_0_0_1px_var(--pi-error)] hover:bg-pi-error/90",
	"ghost-danger":
		"text-pi-text-secondary hover:bg-pi-error-soft hover:text-pi-error",
};

const sizeClasses: Record<ButtonSize, string> = {
	sm: "h-7 gap-1 rounded-md px-2.5 text-2xs font-medium",
	md: "h-8 gap-1.5 rounded-md px-3 text-xs font-medium",
	lg: "h-9 gap-2 rounded-lg px-4 text-xs font-semibold",
};

export function Button({
	variant = "secondary",
	size = "md",
	loading = false,
	icon: Icon,
	children,
	className,
	disabled,
	onClick,
	...props
}: ButtonProps) {
	const IconCmp = loading ? Loader2 : Icon;
	return (
		<button
			type="button"
			disabled={disabled || loading}
			onClick={(e) => {
				triggerHaptic("selection");
				onClick?.(e);
			}}
			className={cn(
				"inline-flex shrink-0 items-center justify-center transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none",
				"disabled:cursor-not-allowed disabled:opacity-50",
				loading && "cursor-wait opacity-80",
				variantClasses[variant],
				sizeClasses[size],
				className,
			)}
			{...props}
		>
			{IconCmp && (
				<IconCmp
					className={cn(
						"shrink-0",
						size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5",
						loading && "animate-spin",
					)}
				/>
			)}
			{children}
		</button>
	);
}

type IconButtonProps = {
	size?: "sm" | "md" | "lg";
	variant?: ButtonVariant;
	icon: React.ComponentType<{ className?: string }>;
	"aria-label": string;
	loading?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

const iconButtonSizeClasses: Record<ButtonVariant, Record<"sm" | "md" | "lg", string>> = {
	primary: {
		sm: "h-7 w-7 rounded-md",
		md: "h-8 w-8 rounded-md",
		lg: "h-9 w-9 rounded-lg",
	},
	secondary: {
		sm: "h-7 w-7 rounded-md",
		md: "h-8 w-8 rounded-md",
		lg: "h-9 w-9 rounded-lg",
	},
	ghost: {
		sm: "h-7 w-7 rounded-md",
		md: "h-8 w-8 rounded-md",
		lg: "h-9 w-9 rounded-lg",
	},
	danger: {
		sm: "h-7 w-7 rounded-md",
		md: "h-8 w-8 rounded-md",
		lg: "h-9 w-9 rounded-lg",
	},
	"ghost-danger": {
		sm: "h-7 w-7 rounded-md",
		md: "h-8 w-8 rounded-md",
		lg: "h-9 w-9 rounded-lg",
	},
};

export function IconButton({
	size = "md",
	variant = "ghost",
	icon: Icon,
	loading,
	className,
	disabled,
	onClick,
	...props
}: IconButtonProps) {
	const IconCmp = loading ? Loader2 : Icon;
	return (
		<button
			type="button"
			disabled={disabled || loading}
			onClick={(e) => {
				triggerHaptic("selection");
				onClick?.(e);
			}}
			className={cn(
				"inline-flex shrink-0 items-center justify-center transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none",
				"disabled:cursor-not-allowed disabled:opacity-50",
				loading && "cursor-wait opacity-80",
				variantClasses[variant],
				iconButtonSizeClasses[variant][size],
				className,
			)}
			{...props}
		>
			<IconCmp
				className={cn(
					"shrink-0",
					size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5",
					loading && "animate-spin",
				)}
			/>
		</button>
	);
}

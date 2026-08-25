import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { triggerHaptic } from "../../lib/haptics";

export type ButtonVariant =
	| "default"
	| "primary"
	| "secondary"
	| "outline"
	| "ghost"
	| "link"
	| "text"
	| "textStrong"
	| "danger"
	| "destructive"
	| "ghost-danger";

export type ButtonSize =
	| "xs"
	| "sm"
	| "md"
	| "lg"
	| "inline"
	| "icon-sm"
	| "icon"
	| "icon-lg";

type ButtonProps = {
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
	icon?: React.ComponentType<{ className?: string }>;
	children?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const variantClasses: Record<ButtonVariant, string> = {
	default:
		"bg-pi-accent text-white shadow-ring-accent hover:bg-pi-accent-hover",
	primary:
		"bg-pi-accent text-white shadow-ring-accent hover:bg-pi-accent-hover",
	secondary:
		"bg-pi-surface-raised text-pi-text shadow-ring hover:bg-pi-surface-overlay",
	outline:
		"bg-transparent text-pi-text-secondary shadow-ring hover:bg-pi-surface-raised hover:text-pi-text",
	ghost: "text-pi-text-secondary hover:bg-pi-surface-raised hover:text-pi-text",
	link: "text-pi-accent hover:underline underline-offset-4",
	text: "text-pi-text-secondary hover:text-pi-text underline-offset-4 hover:underline",
	textStrong:
		"font-semibold text-pi-text-secondary underline underline-offset-4 hover:text-pi-text",
	danger:
		"bg-pi-error text-white shadow-[0_0_0_1px_var(--pi-error)] hover:bg-pi-error/90",
	destructive:
		"bg-pi-error text-white shadow-[0_0_0_1px_var(--pi-error)] hover:bg-pi-error/90",
	"ghost-danger":
		"text-pi-text-secondary hover:bg-pi-error-soft hover:text-pi-error",
};

const sizeClasses: Record<ButtonSize, string> = {
	xs: "h-6 gap-1 rounded-md px-2 text-2xs font-medium",
	sm: "h-7 gap-1 rounded-md px-2.5 text-2xs font-medium",
	md: "h-8 gap-1.5 rounded-md px-3 text-xs font-medium",
	lg: "h-9 gap-2 rounded-lg px-4 text-xs font-semibold",
	inline: "h-auto gap-1 p-0",
	"icon-sm": "h-7 w-7 rounded-md",
	icon: "h-8 w-8 rounded-md",
	"icon-lg": "h-9 w-9 rounded-lg",
};

function iconSizeFor(buttonSize: ButtonSize): string {
	switch (buttonSize) {
		case "xs":
			return "h-3 w-3";
		case "icon-sm":
			return "h-3.5 w-3.5";
		case "icon":
			return "h-4 w-4";
		case "icon-lg":
			return "h-4.5 w-4.5";
		case "lg":
			return "h-4 w-4";
		default:
			return "h-3.5 w-3.5";
	}
}

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
				"inline-flex shrink-0 cursor-pointer items-center justify-center transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none",
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
						iconSizeFor(size),
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
	variant?: Exclude<ButtonVariant, "link" | "text" | "textStrong">;
	icon: React.ComponentType<{ className?: string }>;
	"aria-label": string;
	loading?: boolean;
	children?: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

const iconSizeToButtonSize: Record<"sm" | "md" | "lg", ButtonSize> = {
	sm: "icon-sm",
	md: "icon",
	lg: "icon-lg",
};

export function IconButton({
	size = "md",
	variant = "ghost",
	icon,
	loading,
	children,
	className,
	...props
}: IconButtonProps) {
	return (
		<Button
			variant={variant}
			size={iconSizeToButtonSize[size]}
			icon={icon}
			loading={loading}
			className={className}
			{...props}
		>
			{children}
		</Button>
	);
}

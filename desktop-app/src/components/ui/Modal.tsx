import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export const ModalBackdrop = forwardRef<
	HTMLDivElement,
	{
		children: React.ReactNode;
		className?: string;
		position?: "center" | "top";
		onClick?: (e: React.MouseEvent) => void;
	}
>(function ModalBackdrop({ children, className, position = "center", onClick }, ref) {
	return (
		<div
			ref={ref}
			role="dialog"
			aria-modal="true"
			onClick={onClick}
			className={cn(
				"fixed inset-0 z-50 flex bg-black/60 p-4 backdrop-blur-sm transition-opacity duration-300 ease-out",
				position === "center" ? "items-center justify-center" : "items-start justify-center",
				className,
			)}
		>
			{children}
		</div>
	);
});
ModalBackdrop.displayName = "ModalBackdrop";

export function ModalPanel({
	children,
	className,
	centered = true,
	onClick,
}: {
	children: React.ReactNode;
	className?: string;
	centered?: boolean;
	onClick?: (e: React.MouseEvent) => void;
}) {
	return (
		<div
			onClick={onClick}
			className={cn(
				"flex w-full flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay transition-all duration-300 ease-out",
				centered ? "max-h-overlay" : "",
				className,
			)}
		>
			{children}
		</div>
	);
}

import { forwardRef, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export const ModalBackdrop = forwardRef<
	HTMLDivElement,
	{
		children: React.ReactNode;
		className?: string;
		position?: "center" | "top";
		appear?: boolean;
		onClick?: (e: React.MouseEvent) => void;
	}
>(function ModalBackdrop({ children, className, position = "center", appear = true, onClick }, ref) {
	const [visible, setVisible] = useState(!appear);
	const localRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		// Force a layout so the browser sees the initial opacity before transitioning.
		void localRef.current?.offsetHeight;
		requestAnimationFrame(() => setVisible(true));
	}, []);

	return (
		<div
			ref={(node) => {
				localRef.current = node;
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
			}}
			role="dialog"
			aria-modal="true"
			onClick={onClick}
			className={cn(
				"fixed inset-0 z-50 flex bg-black/60 p-4 backdrop-blur-sm transition-opacity duration-300 ease-out",
				position === "center" ? "items-center justify-center" : "items-start justify-center",
				visible ? "opacity-100" : "opacity-0",
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
	appear = true,
	onClick,
}: {
	children: React.ReactNode;
	className?: string;
	centered?: boolean;
	appear?: boolean;
	onClick?: (e: React.MouseEvent) => void;
}) {
	const [visible, setVisible] = useState(!appear);

	useEffect(() => {
		requestAnimationFrame(() => setVisible(true));
	}, []);

	return (
		<div
			onClick={onClick}
			className={cn(
				"flex w-full flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay transition-all duration-300 ease-out",
				centered ? "max-h-overlay" : "",
				visible
					? "translate-y-0 scale-100 opacity-100"
					: "translate-y-2 scale-[0.98] opacity-0",
				className,
			)}
		>
			{children}
		</div>
	);
}

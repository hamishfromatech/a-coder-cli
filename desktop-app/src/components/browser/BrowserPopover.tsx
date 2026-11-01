// Small anchored menu for the browser chrome: popovers hang off their trigger
// inside the panel and, in layered mode, carry `data-browser-input` so their
// rects are handed to the native input router (clicks land here, not the page
// underneath). Escape closes the top layer only, sharing the app's ordering.

import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../../lib/escape-layers";

export function BrowserPopover({
	open,
	onClose,
	align = "right",
	label,
	className,
	children,
}: {
	open: boolean;
	onClose: () => void;
	align?: "left" | "right";
	label: string;
	className?: string;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.contextMenu);
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (!isTopEscapeLayer(ESCAPE_PRIORITY.contextMenu)) return;
			event.preventDefault();
			onClose();
		};
		const onDown = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) onClose();
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("mousedown", onDown);
		return () => {
			unregister();
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onDown);
		};
	}, [open, onClose]);

	if (!open) return null;
	return (
		<div
			ref={ref}
			role="menu"
			aria-label={label}
			data-browser-input
			className={cn(
				"absolute top-full z-popover mt-1.5 rounded-lg border border-pi-border bg-pi-surface-overlay p-1 shadow-overlay",
				align === "right" ? "right-0" : "left-0",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function MenuRow({
	icon: Icon,
	label,
	hint,
	disabled,
	selected,
	danger,
	onClick,
}: {
	icon: ComponentType<{ className?: string }>;
	label: string;
	hint?: string;
	disabled?: boolean;
	selected?: boolean;
	danger?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-hover focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default disabled:opacity-40",
				danger
					? "text-pi-text-secondary hover:bg-pi-error-soft hover:text-pi-error"
					: "text-pi-text hover:bg-pi-surface-raised",
			)}
		>
			<Icon className={cn("h-3.5 w-3.5 shrink-0", danger ? "text-pi-error" : "text-pi-text-muted")} />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{selected && <Check className="h-3 w-3 shrink-0 text-pi-accent" />}
			{hint && (
				<kbd className="shrink-0 rounded border border-pi-border bg-pi-surface-raised px-1 py-px font-mono text-3xs text-pi-text-muted">
					{hint}
				</kbd>
			)}
		</button>
	);
}

export function MenuSeparator() {
	return <div className="my-1 h-px bg-pi-border" role="separator" />;
}

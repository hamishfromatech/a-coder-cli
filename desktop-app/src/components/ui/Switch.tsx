import { cn } from "../../lib/cn";
import { triggerHaptic } from "../../lib/haptics";

export function Switch({
	id,
	checked,
	onChange,
	disabled,
	ariaLabel,
	size = "md",
}: {
	id?: string;
	checked: boolean;
	onChange: () => void;
	disabled?: boolean;
	ariaLabel?: string;
	size?: "sm" | "md";
}) {
	const isSm = size === "sm";
	return (
		<button
			type="button"
			id={id}
			disabled={disabled}
			onClick={() => {
				triggerHaptic("selection");
				onChange();
			}}
			aria-pressed={checked}
			aria-label={ariaLabel}
			className={cn(
				"relative inline-flex shrink-0 items-center rounded-full active-press transition-smooth",
				"focus-visible:shadow-focus focus-visible:outline-none",
				isSm ? "h-[18px] w-7" : "h-5 w-8",
				disabled && "opacity-50 cursor-not-allowed",
				checked
					? "bg-pi-accent hover:bg-pi-accent-hover"
					: "bg-pi-surface-raised shadow-ring hover:bg-pi-surface-overlay",
			)}
		>
			<span
				className={cn(
					"absolute top-0.5 rounded-full bg-white/90 shadow-sm transition-transform",
					isSm ? "h-3.5 w-3.5" : "h-4 w-4",
					checked ? (isSm ? "translate-x-3" : "translate-x-3") : "translate-x-0.5",
				)}
			/>
		</button>
	);
}

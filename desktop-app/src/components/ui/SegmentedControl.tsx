import { cn } from "../../lib/cn";

interface Option<T extends string> {
	value: T;
	label: string;
}

interface SegmentedControlProps<T extends string> {
	options: Option<T>[];
	value: T;
	onChange: (value: T) => void;
	label?: string;
	className?: string;
}

// Compact mutually-exclusive choice control. Use for small option sets where
// every choice is visible (e.g. thinking level, display mode).
export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
	label,
	className,
}: SegmentedControlProps<T>) {
	return (
		<div
			className={cn(
				"inline-flex items-center gap-0.5 rounded-md border border-pi-border bg-pi-surface-raised p-0.5",
				className,
			)}
			role="radiogroup"
			aria-label={label}
		>
			{label && (
				<span className="px-1.5 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
					{label}
				</span>
			)}
			{options.map((option) => {
				const active = value === option.value;
				return (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={active}
						onClick={() => onChange(option.value)}
						className={cn(
							"rounded px-1.5 font-mono text-3xs uppercase tracking-wide transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none",
							active
								? "bg-pi-accent-soft text-pi-accent"
								: "text-pi-text-muted hover:bg-pi-surface-overlay hover:text-pi-text",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

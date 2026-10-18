import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * Borderless search field: underline appears on focus, a clear affordance
 * appears only when there is text, and the whole field disappears when the
 * list it filters is empty (nothing to search). Keeps list headers quiet.
 */
export interface SearchFieldProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	ariaLabel: string;
	/** Hide the field entirely (e.g. an empty list). */
	visible?: boolean;
	className?: string;
	autoFocus?: boolean;
	/** Called on ArrowDown/Enter so a list can hand focus to its rows. */
	onSubmit?: () => void;
}

export function SearchField({
	value,
	onChange,
	placeholder = "Search…",
	ariaLabel,
	visible = true,
	className,
	autoFocus,
	onSubmit,
}: SearchFieldProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	if (!visible) return null;

	return (
		<div
			className={`flex min-w-0 items-center gap-1.5 border-b border-transparent px-1 py-1 transition-colors focus-within:border-pi-border-strong ${className ?? ""}`}
		>
			<Search className="h-3 w-3 shrink-0 text-pi-text-faint" aria-hidden />
			<input
				ref={inputRef}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "Enter") {
						if (!onSubmit) return;
						e.preventDefault();
						onSubmit();
					}
				}}
				placeholder={placeholder}
				className="min-w-0 flex-1 bg-transparent text-2xs text-pi-text placeholder:text-pi-text-faint focus:outline-none"
				aria-label={ariaLabel}
				spellCheck={false}
				autoComplete="off"
			/>
			{value && (
				<button
					type="button"
					onClick={() => onChange("")}
					className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-pi-text-faint transition-hover hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					aria-label="Clear search"
				>
					<X className="h-2.5 w-2.5" />
				</button>
			)}
		</div>
	);
}

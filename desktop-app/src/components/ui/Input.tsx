import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

const baseInputClasses =
	"w-full rounded-md bg-pi-surface-raised text-pi-text shadow-ring transition-smooth placeholder:text-pi-text-faint focus:shadow-focus focus:outline-none disabled:opacity-50";

export type InputSize = "sm" | "md";

const sizeClasses: Record<InputSize, string> = {
	sm: "px-2.5 py-1.5 text-2xs",
	md: "px-3 py-1.5 text-xs",
};

type InputProps = {
	scale?: InputSize;
	mono?: boolean;
	error?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>;

export function Input({
	scale = "md",
	mono,
	error,
	className,
	...props
}: InputProps) {
	return (
		<input
			className={cn(
				baseInputClasses,
				sizeClasses[scale],
				mono && "font-mono",
				error && "shadow-ring-error",
				className,
			)}
			{...props}
		/>
	);
}

type TextareaProps = {
	scale?: InputSize;
	mono?: boolean;
	error?: boolean;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({
	scale = "md",
	mono,
	error,
	className,
	...props
}: TextareaProps) {
	return (
		<textarea
			className={cn(
				baseInputClasses,
				scale === "sm" ? "p-2 text-2xs" : "p-3 text-xs",
				mono && "font-mono",
				error && "shadow-ring-error",
				className,
			)}
			{...props}
		/>
	);
}

type SelectProps = {
	scale?: InputSize;
	error?: boolean;
} & React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({
	scale = "md",
	error,
	className,
	children,
	...props
}: SelectProps) {
	return (
		<div className="relative inline-block">
			<select
				className={cn(
					baseInputClasses,
					"appearance-none",
					sizeClasses[scale],
					error && "shadow-ring-error",
					className,
				)}
				{...props}
			>
				{children}
			</select>
			<ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-pi-text-muted transition-smooth" />
		</div>
	);
}

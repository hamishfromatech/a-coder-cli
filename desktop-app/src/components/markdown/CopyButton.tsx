import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";

// Compact copy button used in code-card headers. Adapted from Hermes'
// ui/copy-button (trimmed to the inline appearance we need).

interface CopyButtonProps {
	text: string;
	label?: string;
	className?: string;
	iconClassName?: string;
}

export function CopyButton({ text, label = "Copy", className, iconClassName }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	const onCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		} catch {
			// ignore
		}
	};
	return (
		<button
			className={cn(
				"flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-pi-text-muted transition-smooth hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none",
				className,
			)}
			onClick={onCopy}
			title={label}
			type="button"
		>
			{copied ? <Check className={cn("h-3 w-3 text-pi-success", iconClassName)} /> : <Copy className={cn("h-3 w-3", iconClassName)} />}
		</button>
	);
}
import { useSessionStore } from "../stores/session-store";
import { X, CornerDownLeft } from "lucide-react";
import { Badge } from "./ui/Badge";

export interface QueuePanelProps {
	/** Called when the user clicks a queued item to send it now. */
	onSend?: (text: string) => void;
}

export function QueuePanel({ onSend }: QueuePanelProps) {
	const { steering, followUp } = useSessionStore();
	const items = [
		...steering.map((text) => ({ text, kind: "steering" as const })),
		...followUp.map((text) => ({ text, kind: "followUp" as const })),
	];

	if (items.length === 0) return null;

	return (
		<div className="flex flex-col gap-1 border-b border-pi-border bg-pi-surface/40 px-3 py-2">
			{items.map((item, idx) => (
				<button
					key={`${item.kind}-${idx}`}
					onClick={() => onSend?.(item.text)}
					className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-hover hover:bg-pi-surface-raised"
					title="Click to send now"
				>
					<Badge
						variant={item.kind === "steering" ? "accent" : "success"}
						size="sm"
					>
						{item.kind === "steering" ? "steer" : "follow-up"}
					</Badge>
					<span className="min-w-0 flex-1 truncate text-2xs text-pi-text-secondary">
						{item.text}
					</span>
					<CornerDownLeft className="h-3 w-3 shrink-0 text-pi-text-faint opacity-0 transition-smooth group-hover:opacity-100" />
					<X className="h-3 w-3 shrink-0 text-pi-text-faint opacity-0 transition-smooth hover:text-pi-error group-hover:opacity-100" />
				</button>
			))}
		</div>
	);
}

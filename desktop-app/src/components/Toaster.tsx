import { X } from "lucide-react";
import { useToastStore } from "../stores/toast-store";

const kindClasses: Record<string, string> = {
	info: "border-l-pi-accent bg-pi-surface-overlay",
	success: "border-l-pi-success bg-pi-surface-overlay",
	warning: "border-l-pi-warning bg-pi-surface-overlay",
	error: "border-l-pi-error bg-pi-surface-overlay",
};

export function Toaster() {
	const toasts = useToastStore((s) => s.toasts);
	const dismiss = useToastStore((s) => s.dismiss);

	if (toasts.length === 0) return null;

	return (
		<div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
			{toasts.map((t) => (
				<div
					key={t.id}
					className={`flex min-w-[16rem] max-w-[24rem] items-start gap-2 rounded-lg border border-pi-border border-l-4 p-3 shadow-overlay ${kindClasses[t.kind] ?? kindClasses.info}`}
				>
					<div className="min-w-0 flex-1">
						<div className="text-xs font-semibold text-pi-text">{t.title}</div>
						{t.message && (
							<div className="mt-0.5 text-2xs text-pi-text-secondary">{t.message}</div>
						)}
					</div>
					<button
						onClick={() => dismiss(t.id)}
						className="shrink-0 rounded p-1 text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						aria-label="Dismiss"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			))}
		</div>
	);
}

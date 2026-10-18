import { Check, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useConfirmStore } from "../../stores/confirm-store";

/**
 * The single confirmation host. Mount once per window; every `confirm()` call
 * renders here, so confirmations can never stack two dialogs on top of one
 * another, and keyboard ownership follows the dialog (Esc closes the topmost
 * surface only because there is only ever one).
 */
export function ConfirmHost() {
	const request = useConfirmStore((s) => s.request);
	const pending = useConfirmStore((s) => s.pending);
	const done = useConfirmStore((s) => s.done);
	const error = useConfirmStore((s) => s.error);
	const confirm = useConfirmStore((s) => s.confirm);
	const cancel = useConfirmStore((s) => s.cancel);
	const runSecondary = useConfirmStore((s) => s.runSecondary);
	const confirmRef = useRef<HTMLButtonElement | null>(null);

	// Focus Confirm at open: the primary action should be one Enter away.
	useEffect(() => {
		if (request) confirmRef.current?.focus();
	}, [request?.id]);

	useEffect(() => {
		if (!request) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				cancel();
			} else if (e.key === "Enter") {
				// Never steal Enter from a focused secondary/cancel button.
				const target = e.target as HTMLElement | null;
				if (target?.dataset?.confirmRole === "cancel" || target?.dataset?.confirmRole === "secondary") return;
				e.preventDefault();
				e.stopPropagation();
				void confirm();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [request, confirm, cancel]);

	if (!request) return null;

	return (
		<div className="fixed inset-0 z-backdrop flex items-center justify-center bg-black/60 p-4">
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="confirm-title"
				aria-describedby={request.message ? "confirm-message" : undefined}
				className="w-full max-w-sm rounded-xl border border-pi-border bg-pi-surface-overlay p-4 shadow-overlay"
			>
				<h2 id="confirm-title" className="text-sm font-medium text-pi-text">
					{request.title}
				</h2>
				{request.message && (
					<p id="confirm-message" className="mt-1.5 text-xs leading-relaxed text-pi-text-secondary">
						{request.message}
					</p>
				)}
				{request.detail && (
					<p className="mt-1.5 font-mono text-3xs leading-relaxed text-pi-text-faint">{request.detail}</p>
				)}
				{error && (
					<p role="alert" className="mt-2 rounded-md bg-pi-error-soft px-2 py-1.5 text-2xs text-pi-error">
						{error}
					</p>
				)}
				<div className="mt-4 flex items-center justify-end gap-2">
					{request.secondaryAction && (
						<button
							type="button"
							data-confirm-role="secondary"
							onClick={runSecondary}
							disabled={pending || done}
							className="rounded-md px-2.5 py-1.5 text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-50"
						>
							{request.secondaryAction.label}
						</button>
					)}
					<button
						type="button"
						data-confirm-role="cancel"
						onClick={cancel}
						disabled={pending || done}
						className="rounded-md px-2.5 py-1.5 text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-50"
					>
						{request.cancelLabel ?? "Cancel"}
					</button>
					<button
						ref={confirmRef}
						type="button"
						onClick={() => void confirm()}
						disabled={pending || done}
						className={`flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-2xs font-medium transition-hover focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-60 ${
							request.danger
								? "bg-pi-error text-white hover:brightness-110"
								: "bg-pi-accent text-pi-bg hover:bg-pi-accent-hover"
						}`}
					>
						{pending ? (
							<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
						) : done ? (
							<Check className="h-3 w-3" aria-hidden />
						) : null}
						{done ? "Done" : (request.confirmLabel ?? "Confirm")}
					</button>
				</div>
			</div>
		</div>
	);
}

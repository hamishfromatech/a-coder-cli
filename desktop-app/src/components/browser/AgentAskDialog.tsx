// The permission gate's decision dialog: an agent tool parked on a host the
// user has not yet approved. Allow hands the parked call through (the ordinary
// host may also be remembered for future agent visits); deny answers it
// rejected. Sensitive hosts (the built-in list) ask every time, so the
// remember option stays hidden for them.

import { useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "../ui/Button";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { useModalA11y } from "../../hooks/useModalA11y";
import { triggerHaptic } from "../../lib/haptics";
import { useBrowserStore } from "../../stores/browser-store";

export function AgentAskDialog() {
	const ask = useBrowserStore((state) => state.agentAsks[0] ?? null);
	const decide = useBrowserStore((state) => state.decideAgentAsk);
	const open = Boolean(ask);
	const backdropRef = useRef<HTMLDivElement | null>(null);

	// Escape denies, with the standard modal open/close haptics.
	useModalA11y(backdropRef, open, () => ask && void decide(ask.id, false, false));

	if (!ask) return null;
	return (
		<ModalBackdrop ref={backdropRef} onClick={() => void decide(ask.id, false, false)}>
			<ModalPanel className="max-w-sm">
				<div className="flex items-center gap-2 border-b border-pi-border px-4 py-2.5">
					<ShieldAlert className="h-4 w-4 shrink-0 text-pi-text-secondary" />
					<span className="text-sm font-medium text-pi-text">Let the agent drive this site?</span>
				</div>
				<div className="px-4 py-3 text-xs">
					<p className="text-pi-text-secondary">
						The agent's tool <code className="rounded bg-pi-surface-overlay px-1 py-0.5 font-mono">{ask.op}</code> wants to
						act on a page at <span className="font-medium text-pi-text">{ask.host}</span>.
					</p>
					<p className="mt-2 break-all rounded border border-pi-border bg-pi-surface-raised px-2.5 py-1.5 font-mono text-[11px] text-pi-text">
						{ask.url}
					</p>
					{!ask.sensitive && (
						<label className="mt-3 flex cursor-pointer select-none items-center gap-2 text-pi-text-muted">
							<input
								type="checkbox"
								id="agent-ask-remember"
								defaultChecked
								className="h-3.5 w-3.5 accent-[var(--pi-accent,theme(colors.pi.accent))]"
							/>
							<span className="text-2xs">Remember for future agent visits to this site</span>
						</label>
					)}
					<p className="mt-3 text-2xs leading-relaxed text-pi-text-faint">
						Approval applies to this site's pages. Bank and email domains ask every time.
					</p>
				</div>
				<div className="flex justify-end gap-2 border-t border-pi-border px-4 py-2.5">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => void decide(ask.id, false, false)}
					>
						Deny
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => {
								const box = document.querySelector<HTMLInputElement>("#agent-ask-remember");
								const remember = !ask.sensitive && Boolean(box?.checked);
							triggerHaptic("submit");
							void decide(ask.id, true, remember);
						}}
					>
						Allow
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
// Handoff confirmation: a page asked the panel to open a URL it cannot host
// itself (mailto:, tel:, files, app schemes). The user confirms before the
// URL leaves for the system handler; a plain web handoff stays automatic and
// never reaches this dialog.

import { useRef } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "../ui/Button";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { useModalA11y } from "../../hooks/useModalA11y";
import { useBrowserStore } from "../../stores/browser-store";
import { shortHostLabel } from "../../lib/external-link";

export function ExternalHandoffDialog() {
	const prompt = useBrowserStore((state) => state.externalPrompt);
	const decide = useBrowserStore((state) => state.decideExternalPrompt);
	const open = Boolean(prompt);
	const backdropRef = useRef<HTMLDivElement | null>(null);

	// Escape closes (decline) with the standard modal open/close haptics.
	useModalA11y(backdropRef, open, () => decide(false));

	if (!prompt) return null;
	return (
		<ModalBackdrop ref={backdropRef} onClick={() => decide(false)}>
			<ModalPanel className="max-w-sm">
				<div className="flex items-center gap-2 border-b border-pi-border px-4 py-2.5">
					<ExternalLink className="h-4 w-4 shrink-0 text-pi-text-secondary" />
					<span className="text-sm font-medium text-pi-text">Open externally?</span>
				</div>
				<div className="px-4 py-3 text-xs">
					<p className="text-pi-text-secondary">
						{shortHostLabel(prompt.url)} is asking to open outside the browser panel
						(this is not a plain web address):
					</p>
					<p className="mt-2 break-all rounded border border-pi-border bg-pi-surface-raised px-2.5 py-1.5 font-mono text-[11px] text-pi-text">
						{prompt.url}
					</p>
					<p className="mt-2 text-pi-text-muted">
						Approving hands this URL to the system handler (email client, file
						opener or another app). Only approve links you trust.
					</p>
				</div>
				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-4 py-3">
					<Button variant="ghost" size="md" onClick={() => decide(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="md"
						icon={ExternalLink}
						onClick={() => decide(true)}
					>
						Open
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
/**
 * Floating approval stack: one card at a time with a position counter and
 * same-tool bulk actions. Queued requests stay in the store; resolving one
 * advances to the next without mounting overlapping modals.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSessionStore, type UiRequest } from "../stores/session-store";
import { triggerHaptic } from "../lib/haptics";
import { ToolApprovalBar } from "./ToolApprovalBar";

export function ApprovalCardStack({ requests }: { requests: UiRequest[] }) {
	const resolveUiRequest = useSessionStore((s) => s.resolveUiRequest);
	const [index, setIndex] = useState(0);

	useEffect(() => {
		setIndex((current) => Math.min(current, Math.max(0, requests.length - 1)));
	}, [requests.length]);

	if (requests.length === 0) return null;
	const current = requests[Math.min(index, requests.length - 1)];
	if (!current) return null;
	const sameTool = current.toolName
		? requests.filter((request) => request.toolName === current.toolName)
		: [current];

	const resolveAll = (confirmed: boolean) => {
		triggerHaptic(confirmed ? "submit" : "cancel");
		for (const request of sameTool) {
			resolveUiRequest(request.id, { confirmed });
		}
	};

	return (
		<div className="mt-2" data-slot="approval-card-stack">
			{requests.length > 1 && (
				<div className="mb-1 flex items-center gap-1.5 text-2xs text-pi-text-muted">
					<span className="font-medium text-pi-text">
						Approval {Math.min(index + 1, requests.length)} of {requests.length}
					</span>
					{current.toolName && <span className="font-mono text-pi-text-faint">{current.toolName}</span>}
					<span className="ml-auto flex items-center gap-0.5">
						<button
							type="button"
							aria-label="Previous approval"
							className="rounded p-0.5 transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:opacity-30"
							disabled={index === 0}
							onClick={() => setIndex((value) => Math.max(0, value - 1))}
						>
							<ChevronLeft className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							aria-label="Next approval"
							className="rounded p-0.5 transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:opacity-30"
							disabled={index >= requests.length - 1}
							onClick={() => setIndex((value) => Math.min(requests.length - 1, value + 1))}
						>
							<ChevronRight className="h-3.5 w-3.5" />
						</button>
					</span>
				</div>
			)}
			<ToolApprovalBar request={current} surface="floating" />
			{sameTool.length > 1 && (
				<div className="mt-1 flex items-center gap-3 text-2xs">
					<button
						type="button"
						className="text-pi-text-muted underline-offset-2 hover:text-pi-text hover:underline"
						onClick={() => resolveAll(true)}
					>
						Allow all {sameTool.length} {current.toolName ?? "requests"}
					</button>
					<button
						type="button"
						className="text-pi-text-muted underline-offset-2 hover:text-pi-text hover:underline"
						onClick={() => resolveAll(false)}
					>
						Deny all
					</button>
				</div>
			)}
		</div>
	);
}

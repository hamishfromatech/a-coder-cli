/**
 * Coworker detail: aggregate stats plus the canonical sessions this coworker
 * has run in. Opening a session routes through the normal tab switch so the
 * office panel hands off to the transcript.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Face } from "./Face";
import { officeCoworkerDetails, type OfficeCoworker, type OfficeCoworkerDetails } from "../../lib/rpc";
import { openSessionFile } from "../../lib/open-session";

function relativeTime(ms: number | undefined): string {
	if (!ms) return "never";
	const delta = Date.now() - ms;
	if (delta < 60_000) return "now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return `${Math.floor(delta / 86_400_000)}d ago`;
}

function formatTokens(tokens: number): string {
	return Intl.NumberFormat(undefined, { notation: tokens >= 10_000 ? "compact" : "standard" }).format(tokens);
}

export function CoworkerDetails({
	coworker,
	onClose,
}: {
	coworker: OfficeCoworker;
	onClose: () => void;
}) {
	const [details, setDetails] = useState<OfficeCoworkerDetails | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [opening, setOpening] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void officeCoworkerDetails(coworker.id)
			.then((result) => {
				if (!cancelled) setDetails(result);
			})
			.catch((reason) => {
				if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
			});
		return () => {
			cancelled = true;
		};
	}, [coworker.id]);

	const open = async (path: string) => {
		setOpening(path);
		const ok = await openSessionFile(path);
		if (ok) onClose();
		else setOpening(null);
	};

	return (
		<ModalBackdrop onClick={onClose}>
			<ModalPanel className="w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<div className="flex min-w-0 items-center gap-2.5">
						<Face handle={coworker.handle} name={coworker.name} face={coworker.face} size={32} />
						<div className="min-w-0">
							<div className="truncate text-sm font-semibold text-pi-text">{coworker.name}</div>
							<div className="truncate text-2xs text-pi-text-muted">
								@{coworker.handle}
								{coworker.title ? ` · ${coworker.title}` : ""}
							</div>
						</div>
					</div>
					<Button variant="ghost" size="xs" onClick={onClose}>
						Close
					</Button>
				</div>

				<div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-3">
					{error && <div className="rounded-md bg-pi-surface-raised p-2 text-2xs text-pi-error">{error}</div>}
					{!details && !error && (
						<div className="flex items-center gap-2 text-2xs text-pi-text-muted">
							<Loader2 className="h-3 w-3 animate-spin" />
							Loading stats…
						</div>
					)}
					{details && (
						<>
							<div className="grid grid-cols-3 gap-2">
								{[
									["Turns", String(details.totals.turns)],
									["Tokens", formatTokens(details.totals.tokens)],
									["Sessions", String(details.totals.sessions)],
								].map(([label, value]) => (
									<div key={label} className="rounded-lg bg-pi-surface-raised px-2.5 py-2">
										<div className="text-2xs uppercase tracking-wide text-pi-text-faint">{label}</div>
										<div className="mt-0.5 text-sm font-semibold text-pi-text">{value}</div>
									</div>
								))}
							</div>
							<div className="text-2xs text-pi-text-muted">
								Last activity {relativeTime(details.totals.lastActivity)}
							</div>

							<div>
								<div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">
									Sessions
								</div>
								{details.sessions.length === 0 && (
									<div className="rounded-md border border-dashed border-pi-border p-3 text-2xs text-pi-text-faint">
										No sessions yet. Send this coworker a message to start one.
									</div>
								)}
								<div className="space-y-1">
									{details.sessions.map((session) => (
										<div
											key={session.path}
											className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-hover hover:bg-pi-surface-raised"
										>
											<div className="min-w-0 flex-1">
												<div className="truncate text-xs font-medium text-pi-text">
													{session.name || session.cwd.split(/[/\\]/).pop() || "Session"}
												</div>
												<div className="truncate text-2xs text-pi-text-faint">
													{session.turns} turns · {formatTokens(session.tokens)} tokens ·{" "}
													{relativeTime(session.lastActivity)}
												</div>
											</div>
											<Button
												variant="secondary"
												size="xs"
												loading={opening === session.path}
												onClick={() => void open(session.path)}
											>
												Open
											</Button>
										</div>
									))}
								</div>
							</div>
						</>
					)}
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

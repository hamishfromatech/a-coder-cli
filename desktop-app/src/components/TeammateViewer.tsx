import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Users, X } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useSessionStore } from "../stores/session-store";
import * as rpc from "../lib/rpc";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/Button";
import { Badge, type BadgeVariant } from "./ui/Badge";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface TeammateViewerProps {
	open: boolean;
	onClose: () => void;
}

const TEAM_LEAD_NAME = "team-lead";

function formatJoined(ms: number): string {
	return new Date(ms).toLocaleString();
}

function formatAge(ms: number): string {
	const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	return `${Math.floor(hr / 24)}d ago`;
}

export function TeammateViewer({ open, onClose }: TeammateViewerProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const [teams, setTeams] = useState<rpc.TeamFile[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [viewingMember, setViewingMember] = useState<string | null>(null);
	/** Live in-process sub-agent records (subagents_update events). */
	const subAgents = useSessionStore((s) => s.subAgents);
	useModalA11y(modalRef, open, onClose);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const files = await rpc.readTeams();
			files.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
			setTeams(files);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) {
			void load();
		} else {
			setViewingMember(null);
		}
	}, [open, load]);

	if (!open) return null;

	return (
		<ModalBackdrop ref={modalRef} aria-label="Agent Teams" onClick={onClose}>
			<ModalPanel className="max-w-lg" centered={false} onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<div className="flex items-center gap-2">
						<Users className="h-4 w-4 text-pi-accent" />
						<h2 className="text-[13px] font-semibold tracking-tight text-pi-text">Agent Teams</h2>
					</div>
					<div className="flex items-center gap-2">
						<IconButton
							variant="ghost"
							size="sm"
							icon={RefreshCw}
							loading={loading}
							onClick={() => void load()}
							aria-label="Refresh"
						/>
						<IconButton variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />
					</div>
				</div>

				<div className="flex-1 overflow-auto px-4 py-3">
					{loading && teams.length === 0 ? (
						<div className="flex h-24 items-center justify-center text-xs text-pi-text-muted">
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Loading teams…
						</div>
					) : error ? (
						<p className="py-6 text-center text-xs text-pi-error">{error}</p>
					) : teams.length === 0 ? (
						<div className="py-10 text-center">
							<p className="text-[13px] font-medium text-pi-text-secondary">No active team</p>
							<p className="mt-2 text-2xs leading-relaxed text-pi-text-muted">
								Agent Teams lets the lead coordinate long-running parallel roles.
								Ask the assistant to create a team and spawn teammates, and they will show up here.
							</p>
						</div>
					) : (
						<div className="space-y-4">
							{teams.map((team) => (
								<section key={team.name}>
									<header className="mb-2 flex items-baseline justify-between gap-2">
										<div className="min-w-0">
											<span className="text-sm font-semibold text-pi-text">{team.name}</span>
											{team.description && (
												<p className="mt-0.5 text-2xs text-pi-text-secondary">{team.description}</p>
											)}
										</div>
										<span className="shrink-0 text-3xs text-pi-text-faint">
											created {formatAge(team.createdAt)}
										</span>
									</header>
									<ul className="space-y-1.5">
										{team.members.map((member) => {
											const isLead = member.name === TEAM_LEAD_NAME;
											const variant: BadgeVariant = member.isActive ? "accent" : "muted";
											const live = subAgents.find((a) => a.teammateName === member.name);
											const isViewing = viewingMember === member.agentId;
											return (
												<li
													key={member.agentId}
													className={`rounded-lg bg-pi-surface-raised p-2.5 shadow-ring ${live ? "cursor-pointer hover:bg-pi-surface-overlay" : ""}`}
												onClick={live ? () => setViewingMember(isViewing ? null : member.agentId) : undefined}
												>
													<div className="flex items-center justify-between gap-2">
														<div className="flex min-w-0 flex-1 items-center gap-2">
															<span className="truncate text-xs font-medium text-pi-text">
																{member.name}
															</span>
															{isLead ? (
																<Badge variant="success" size="sm">
																	Lead
																</Badge>
															) : (
																<Badge variant={variant} size="sm">
																	{member.isActive ? "Working" : "Idle"}
																</Badge>
															)}
															{(member.unread ?? 0) > 0 && (
																<Badge variant="warning" size="sm">
																	{member.unread} new
																</Badge>
															)}
														</div>
														{member.agentType && member.agentType !== TEAM_LEAD_NAME && (
															<span className="shrink-0 font-mono text-3xs text-pi-text-muted">
																{member.agentType}
															</span>
														)}
													</div>
													{(member.worktreePath || member.joinedAt) && (
														<div className="mt-1 space-y-0.5 font-mono text-3xs text-pi-text-faint">
															{member.worktreePath && (
																<p className="truncate">worktree: {member.worktreePath}</p>
															)}
															<p>joined {formatJoined(member.joinedAt)}</p>
														</div>
													)}
													{live && isViewing && (
														<div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-pi-border bg-pi-surface px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
															<div className="mb-1 flex items-center gap-2 font-mono text-3xs text-pi-text-faint">
																<span>
																	{live.toolUseCount} tools · {live.turnCount} turns
																	{live.totalTokens ? ` · ${live.totalTokens} tok` : ""}
																</span>
																<span className="ml-auto">live</span>
															</div>
															{(live.timeline ?? []).slice(-10).map((event, i) => (
																<p key={i} className="whitespace-pre-wrap font-mono text-3xs leading-snug">
																	{event.type === "text"
																		? event.text.slice(0, 300)
																		: event.type === "tool_use_start"
																			? `→ ${event.toolName}`
																			: event.type === "tool_use_done"
																				? `${event.isError ? "✗" : "✓"} ${event.toolName}${event.resultPreview ? ` ⎿ ${event.resultPreview}` : ""}`
																				: event.type === "turn_complete"
																					? `— turn ${event.turnCount}${event.usage ? ` · ${event.usage.totalTokens.toLocaleString()} tok` : ""}`
																					: event.type === "completed"
																						? `— completed (${event.toolUseCount} tools)`
																						: "— aborted"}
																</p>
															))}
															{(live.timeline ?? []).length === 0 && (
																<p className="font-mono text-3xs text-pi-text-faint">(no events yet)</p>
															)}
														</div>
													)}
													{live && !isViewing && (
													<p className="mt-1 text-3xs text-pi-text-faint">click to view live transcript</p>
													)}
												</li>
											);
										})}
									</ul>
								</section>
							))}
						</div>
					)}
				</div>

				<div className="flex shrink-0 items-center justify-between border-t border-pi-border px-4 py-3">
					<span className="text-2xs text-pi-text-faint">
						{teams.length > 0
							? `${teams.length} team${teams.length === 1 ? "" : "s"} on disk`
							: "No teams on disk"}
					</span>
					<Button variant="ghost" size="md" onClick={onClose}>
						Close
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
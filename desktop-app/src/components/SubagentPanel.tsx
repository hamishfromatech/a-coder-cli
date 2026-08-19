import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import * as rpc from "../lib/rpc";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface SubagentPanelProps {
	open: boolean;
	onClose: () => void;
}

type SubagentStatus = "pending" | "running" | "completed" | "failed" | "killed";

const STATUS_LABEL: Record<SubagentStatus, string> = {
	pending: "Waiting",
	running: "Running",
	completed: "Done",
	failed: "Failed",
	killed: "Stopped",
};

const STATUS_TONE: Record<SubagentStatus, string> = {
	pending: "bg-pi-surface-raised text-pi-text-muted",
	running: "bg-pi-accent/10 text-pi-accent",
	completed: "bg-pi-success/10 text-pi-success",
	failed: "bg-pi-error/10 text-pi-error",
	killed: "bg-pi-surface-raised text-pi-text-muted",
};

export function SubagentPanel({ open, onClose }: SubagentPanelProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const [agents, setAgents] = useState<rpc.SubagentRecord[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useModalA11y(modalRef, open, onClose);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const records = await rpc.readSubagentsFile();
			// Newest first.
			records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
			setAgents(records);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) {
			void load();
		}
	}, [open, load]);

	if (!open) return null;

	const running = agents.filter((a) => a.status === "running" || a.status === "pending");

	return (
		<ModalBackdrop
			ref={modalRef}
			aria-label="Subagents"
			onClick={onClose}
		>
			<ModalPanel
				className="max-w-lg"
				centered={false}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<div className="flex items-center gap-2">
						<Sparkles className="h-4 w-4 text-pi-accent" />
						<h2 className="text-[13px] font-semibold tracking-tight text-pi-text">Subagents</h2>
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
						<IconButton
							variant="ghost"
							size="sm"
							icon={X}
							onClick={onClose}
							aria-label="Close"
						/>
					</div>
				</div>

				<div className="flex-1 overflow-auto px-4 py-3">
					{loading && agents.length === 0 ? (
						<div className="flex h-24 items-center justify-center text-xs text-pi-text-muted">
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Loading subagents…
						</div>
					) : error ? (
						<p className="py-6 text-center text-xs text-pi-error">{error}</p>
					) : agents.length === 0 ? (
						<div className="py-10 text-center">
							<p className="text-[13px] font-medium text-pi-text-secondary">No subagents yet</p>
							<p className="mt-2 text-2xs leading-relaxed text-pi-text-muted">
								Subagents are background helpers that work on tasks in parallel.
								Ask the assistant to delegate a task and it will show up here.
							</p>
						</div>
					) : (
						<ul className="space-y-2">
							{agents.map((agent) => (
								<li
									key={agent.id}
									className="rounded-lg bg-pi-surface-raised p-3 shadow-ring"
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span
													className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-3xs font-semibold ${STATUS_TONE[agent.status]}`}
												>
													{STATUS_LABEL[agent.status]}
												</span>
												<span className="truncate text-xs font-medium text-pi-text">
													{agent.config.id}
												</span>
											</div>
											<p className="mt-1.5 text-2xs leading-relaxed text-pi-text-secondary">
												{agent.config.task}
											</p>
											{(agent.config.model || agent.config.provider) && (
												<p className="mt-1 font-mono text-3xs text-pi-text-muted">
													{agent.config.provider ? `${agent.config.provider}/` : ""}
													{agent.config.model ?? ""}
												</p>
											)}
											{agent.error && (
												<p className="mt-1.5 rounded bg-pi-error/10 px-2 py-1 text-2xs text-pi-error">
													{agent.error}
												</p>
											)}
											{agent.lastOutput && agent.status === "running" && (
												<pre className="mt-2 max-h-24 overflow-auto rounded bg-pi-bg p-2 font-mono text-3xs leading-relaxed text-pi-text-muted whitespace-pre-wrap">
													{agent.lastOutput}
												</pre>
											)}
										</div>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className="flex shrink-0 items-center justify-between border-t border-pi-border px-4 py-3">
					<span className="text-2xs text-pi-text-faint">
						{running.length > 0
							? `${running.length} active`
							: `${agents.length} total`}
					</span>
					<Button variant="ghost" size="md" onClick={onClose}>
						Close
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

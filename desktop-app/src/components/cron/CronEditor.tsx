/**
 * Cron create/edit dialog — a scheduled task for the main coding agent:
 * interval, daily, or one-shot. The job fires into this project's active
 * session (or a background session when the project isn't open), so the
 * result lands right in the conversation or the session tree.
 */

import { useState } from "react";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useCronStore } from "../../stores/cron-store";
import { cronCreate, cronUpdate, type CronJob } from "../../lib/rpc";

export function CronEditor({ job, onClose }: { job?: CronJob; onClose: () => void }) {
	const refresh = useCronStore((s) => s.refresh);
	const [name, setName] = useState(job?.name ?? "");
	const [prompt, setPrompt] = useState(job?.prompt ?? "");
	const [kind, setKind] = useState<CronJob["schedule"]["kind"]>(job?.schedule.kind ?? "every");
	const [minutes, setMinutes] = useState(job?.schedule.kind === "every" ? String(job.schedule.minutes) : "60");
	const [dailyTime, setDailyTime] = useState(job?.schedule.kind === "daily" ? job.schedule.time : "09:00");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		if (!name.trim() || !prompt.trim() || busy) return;
		setBusy(true);
		setError(null);
		try {
			const schedule =
				kind === "every"
					? ({ kind: "every", minutes: Math.max(5, Number.parseInt(minutes, 10) || 60) } as const)
					: kind === "daily"
						? ({ kind: "daily", time: dailyTime } as const)
						: ({ kind: "once", at: job?.schedule.kind === "once" ? job.schedule.at : Date.now() + 60_000 } as const);
			if (job) {
				await cronUpdate(job.id, { name: name.trim(), prompt: prompt.trim(), schedule });
			} else {
				await cronCreate({ name: name.trim(), prompt: prompt.trim(), schedule });
			}
			await refresh();
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModalBackdrop onClick={onClose}>
			<ModalPanel className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<span className="text-sm font-semibold text-pi-text">{job ? "Edit scheduled task" : "New scheduled task"}</span>
					<Button variant="ghost" size="xs" onClick={onClose}>
						Cancel
					</Button>
				</div>

				<div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3">
					<Input
						placeholder="Task name (e.g. Morning CI triage)"
						value={name}
						onChange={(e) => setName(e.target.value)}
						autoFocus
					/>
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						rows={4}
						placeholder="What should the agent do at each run?"
						className="w-full resize-y rounded-md bg-pi-surface-raised px-2.5 py-1.5 text-xs text-pi-text shadow-ring transition-smooth placeholder:text-pi-text-faint focus:shadow-focus focus:outline-none"
					/>

					<div className="flex items-center gap-1.5">
						{(["every", "daily", "once"] as const).map((scheduleKind) => (
							<Button
								key={scheduleKind}
								variant={kind === scheduleKind ? "secondary" : "outline"}
								size="sm"
								onClick={() => setKind(scheduleKind)}
							>
								{scheduleKind === "every" ? "Every" : scheduleKind === "daily" ? "Daily" : "Once"}
							</Button>
						))}
						{kind === "every" && (
							<span className="flex items-center gap-1 text-2xs text-pi-text-muted">
								<Input
									scale="sm"
									mono
									className="w-14"
									value={minutes}
									onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ""))}
								/>
								min (min 5)
							</span>
						)}
						{kind === "daily" && (
							<Input
								scale="sm"
								mono
								type="time"
								className="w-24"
								value={dailyTime}
								onChange={(e) => setDailyTime(e.target.value)}
							/>
						)}
					</div>
					{kind === "once" && !job && (
						<div className="text-2xs text-pi-text-faint">
							One-shot tasks run about a minute from now (pause or edit before then to change it).
						</div>
					)}

					{error && <div className="text-2xs text-pi-error">{error}</div>}
				</div>

				<div className="flex justify-end gap-2 border-t border-pi-border px-4 py-3">
					<Button
						variant="primary"
						size="sm"
						loading={busy}
						disabled={!name.trim() || !prompt.trim()}
						onClick={() => void submit()}
					>
						{job ? "Save task" : "Schedule task"}
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
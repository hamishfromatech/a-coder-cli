/**
 * Cron create/edit dialog — a scheduled task for the main coding agent:
 * interval, daily, weekly, one-shot, or event-triggered. The job fires into this
 * project's active session (or a background session when the project isn't
 * open), so the result lands right in the conversation or the session tree.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useCronStore } from "../../stores/cron-store";
import {
	cronCreate,
	cronUpdate,
	type CronCatchUpPolicy,
	type CronConcurrencyPolicy,
	type CronEventTrigger,
	type CronJob,
	type CronVariable,
} from "../../lib/rpc";

const WEEKDAYS = [
	{ day: 1, label: "Mo" },
	{ day: 2, label: "Tu" },
	{ day: 3, label: "We" },
	{ day: 4, label: "Th" },
	{ day: 5, label: "Fr" },
	{ day: 6, label: "Sa" },
	{ day: 0, label: "Su" },
];

export function CronEditor({ job, onClose }: { job?: CronJob; onClose: () => void }) {
	const refresh = useCronStore((s) => s.refresh);
	const [name, setName] = useState(job?.name ?? "");
	const [prompt, setPrompt] = useState(job?.prompt ?? "");
	const [concurrencyPolicy, setConcurrencyPolicy] = useState<CronConcurrencyPolicy>(
		job?.concurrencyPolicy ?? "coalesce_if_active",
	);
	const [catchUpPolicy, setCatchUpPolicy] = useState<CronCatchUpPolicy>(job?.catchUpPolicy ?? "run_once");
	const [variables, setVariables] = useState<CronVariable[]>(job?.variables ?? []);
	const [isolated, setIsolated] = useState(job?.isolated ?? true);
	const [kind, setKind] = useState<CronJob["schedule"]["kind"]>(job?.schedule.kind ?? "every");
	const [minutes, setMinutes] = useState(job?.schedule.kind === "every" ? String(job.schedule.minutes) : "60");
	const [dailyTime, setDailyTime] = useState(job?.schedule.kind === "daily" ? job.schedule.time : "09:00");
	const [weeklyDays, setWeeklyDays] = useState<number[]>(
		job?.schedule.kind === "weekly" ? job.schedule.days : [1, 2, 3, 4, 5],
	);
	const [weeklyTime, setWeeklyTime] = useState(job?.schedule.kind === "weekly" ? job.schedule.time : "09:00");
	const [trigger, setTrigger] = useState<CronEventTrigger>(
		job?.schedule.kind === "event" ? job.schedule.trigger : "turn_end",
	);
	const [cooldown, setCooldown] = useState(
		job?.schedule.kind === "event" && job.schedule.cooldownMinutes !== undefined
			? String(job.schedule.cooldownMinutes)
			: "",
	);
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
						: kind === "weekly"
							? ({ kind: "weekly", days: [...weeklyDays].sort((a, b) => a - b), time: weeklyTime } as const)
							: kind === "event"
							? ({
									kind: "event",
									trigger,
									...(cooldown.trim() ? { cooldownMinutes: Math.max(5, Number.parseInt(cooldown, 10) || 30) } : {}),
								} as const)
							: ({ kind: "once", at: job?.schedule.kind === "once" ? job.schedule.at : Date.now() + 60_000 } as const);
			const cleanVariables = variables
				.map((variable) => ({ name: variable.name.trim(), value: variable.value }))
				.filter((variable) => variable.name.length > 0);
			if (job) {
				await cronUpdate(job.id, {
					name: name.trim(),
					prompt: prompt.trim(),
					schedule,
					concurrencyPolicy,
					catchUpPolicy,
					variables: cleanVariables,
					isolated,
				});
			} else {
				await cronCreate({
					name: name.trim(),
					prompt: prompt.trim(),
					schedule,
					concurrencyPolicy,
					catchUpPolicy,
					variables: cleanVariables,
					isolated,
				});
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

					<div className="grid gap-2 sm:grid-cols-2">
						<label className="space-y-1">
							<span className="text-2xs font-medium text-pi-text-muted">If a run is already active</span>
							<select
								value={concurrencyPolicy}
								onChange={(e) => setConcurrencyPolicy(e.target.value as CronConcurrencyPolicy)}
								className="w-full rounded-md bg-pi-surface-raised px-2 py-1 text-xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
							>
								<option value="coalesce_if_active">Queue one follow-up</option>
								<option value="skip_if_active">Skip the new trigger</option>
								<option value="always_enqueue">Queue every trigger</option>
							</select>
						</label>
						<label className="space-y-1">
							<span className="text-2xs font-medium text-pi-text-muted">If windows were missed</span>
							<select
								value={catchUpPolicy}
								onChange={(e) => setCatchUpPolicy(e.target.value as CronCatchUpPolicy)}
								className="w-full rounded-md bg-pi-surface-raised px-2 py-1 text-xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
							>
								<option value="run_once">Run once after startup</option>
								<option value="skip_missed">Skip stale windows</option>
							</select>
						</label>
					</div>

					<label className="flex items-start gap-2 rounded-md border border-pi-border/70 px-2.5 py-2">
						<input
							type="checkbox"
							checked={isolated}
							onChange={(event) => setIsolated(event.target.checked)}
							className="mt-0.5"
						/>
						<span>
							<span className="block text-xs text-pi-text">Run in an isolated subagent</span>
							<span className="block text-2xs leading-relaxed text-pi-text-faint">
								Each fire gets a separate context and turn budget. Progress appears in the session card; the final result returns to the chat.
							</span>
						</span>
					</label>

					<div className="space-y-1.5 rounded-md border border-pi-border/70 px-2.5 py-2">
						<div className="flex items-center justify-between gap-2">
							<span className="text-2xs font-medium text-pi-text-muted">Inputs</span>
							<Button
								variant="ghost"
								size="xs"
								onClick={() => setVariables((current) => [...current, { name: "", value: "" }])}
							>
								Add variable
							</Button>
						</div>
						{variables.length === 0 ? (
							<p className="text-2xs leading-relaxed text-pi-text-faint">
								Optional non-secret inputs substituted into the task as <code>{"{{name}}"}</code>.
							</p>
						) : (
							variables.map((variable, index) => (
								<div key={index} className="flex items-center gap-1.5">
									<Input
										scale="sm"
										mono
										placeholder="target"
										value={variable.name}
										onChange={(e) =>
											setVariables((current) =>
												current.map((entry, i) => (i === index ? { ...entry, name: e.target.value } : entry)),
											)
										}
									/>
									<Input
										scale="sm"
										placeholder="main"
										value={variable.value}
										onChange={(e) =>
											setVariables((current) =>
												current.map((entry, i) => (i === index ? { ...entry, value: e.target.value } : entry)),
											)
										}
									/>
									<Button
										variant="ghost"
										size="icon-sm"
										icon={X}
										aria-label={`Remove variable ${variable.name || index + 1}`}
										onClick={() => setVariables((current) => current.filter((_, i) => i !== index))}
									/>
								</div>
							))
						)}
					</div>

					<div className="flex items-center gap-1.5">
						{(["every", "daily", "weekly", "once", "event"] as const).map((scheduleKind) => (
							<Button
								key={scheduleKind}
								variant={kind === scheduleKind ? "secondary" : "outline"}
								size="sm"
								onClick={() => setKind(scheduleKind)}
							>
								{scheduleKind === "every"
									? "Every"
									: scheduleKind === "daily"
										? "Daily"
										: scheduleKind === "weekly"
											? "Weekly"
											: scheduleKind === "event"
												? "On event"
												: "Once"}
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
					{kind === "weekly" && (
						<div className="flex flex-wrap items-center gap-1.5">
							{WEEKDAYS.map(({ day, label }, index) => (
								<Button
									key={`${day}-${index}`}
									variant={weeklyDays.includes(day) ? "secondary" : "outline"}
									size="xs"
									onClick={() =>
										setWeeklyDays((current) =>
											current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
										)
									}
									aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}
								>
									{label}
								</Button>
							))}
							<Input
								scale="sm"
								mono
								type="time"
								className="w-24"
								value={weeklyTime}
								onChange={(e) => setWeeklyTime(e.target.value)}
							/>
						</div>
					)}
					{kind === "event" && (
						<div className="flex items-center gap-1.5">
							<select
								value={trigger}
								onChange={(e) => setTrigger(e.target.value as CronEventTrigger)}
								className="rounded-md bg-pi-surface-raised px-2 py-1 text-xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
							>
								<option value="turn_end">when the agent finishes a turn</option>
								<option value="git_commit">when a commit lands</option>
							</select>
							{trigger === "turn_end" && (
								<span className="flex items-center gap-1 text-2xs text-pi-text-muted">
									<Input
										scale="sm"
										mono
										className="w-14"
										placeholder="30"
										value={cooldown}
										onChange={(e) => setCooldown(e.target.value.replace(/[^0-9]/g, ""))}
									/>
									min cooldown (min 5)
								</span>
							)}
						</div>
					)}
					{kind === "once" && !job && (
						<div className="text-2xs text-pi-text-faint">
							One-shot tasks run about a minute from now (pause or edit before then to change it).
						</div>
					)}
					{kind === "event" && (
						<div className="text-2xs text-pi-text-faint">
							{trigger === "turn_end"
								? "Runs after the agent finishes a turn in this project (quiet period applies so the task's own runs don't loop)."
								: "Runs once per new commit in this project (multiple commits between checks coalesce into one run)."}
						</div>
					)}

					{error && <div className="text-2xs text-pi-error">{error}</div>}
				</div>

				<div className="flex justify-end gap-2 border-t border-pi-border px-4 py-3">
					<Button
						variant="primary"
						size="sm"
						loading={busy}
						disabled={!name.trim() || !prompt.trim() || (kind === "weekly" && weeklyDays.length === 0)}
						onClick={() => void submit()}
					>
						{job ? "Save task" : "Schedule task"}
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
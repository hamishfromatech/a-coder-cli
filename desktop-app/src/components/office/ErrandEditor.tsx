/**
 * Errand create dialog: a scheduled job for one coworker — interval, daily,
 * or one-shot — with continuity (run in the coworker's own session so it
 * learns between runs) and a delivery target (DM or a huddle).
 */

import { useState } from "react";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useOfficeStore } from "../../stores/office-store";
import { officeSaveErrand } from "../../lib/rpc";
import { Face } from "./Face";

export function ErrandEditor({ onClose }: { onClose: () => void }) {
	const snapshot = useOfficeStore((s) => s.snapshot);
	const refresh = useOfficeStore((s) => s.refresh);
	const [coworkerId, setCoworkerId] = useState(snapshot?.coworkers[0]?.id ?? "");
	const [name, setName] = useState("");
	const [prompt, setPrompt] = useState("");
	const [kind, setKind] = useState<"every" | "daily" | "once">("every");
	const [minutes, setMinutes] = useState("60");
	const [dailyTime, setDailyTime] = useState("09:00");
	const [continuity, setContinuity] = useState(true);
	const [delivery, setDelivery] = useState<"dm" | "huddle">("dm");
	const [huddleId, setHuddleId] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const huddles = (snapshot?.huddles ?? []).filter((h) => !h.id.startsWith("dm:"));

	const submit = async () => {
		if (!name.trim() || !prompt.trim() || !coworkerId || busy) return;
		setBusy(true);
		setError(null);
		try {
			const schedule =
				kind === "every"
					? { kind: "every" as const, minutes: Math.max(5, Number.parseInt(minutes, 10) || 60) }
					: kind === "daily"
						? { kind: "daily" as const, time: dailyTime }
						: { kind: "once" as const, at: Date.now() + 60_000 };
			await officeSaveErrand({
				coworkerId,
				name: name.trim(),
				prompt: prompt.trim(),
				schedule,
				continuity,
				delivery,
				huddleId: delivery === "huddle" ? huddleId || undefined : undefined,
			});
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
					<span className="text-sm font-semibold text-pi-text">New errand</span>
					<Button variant="ghost" size="xs" onClick={onClose}>
						Cancel
					</Button>
				</div>

				<div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3">
					{(snapshot?.coworkers.length ?? 0) > 0 ? (
						<div className="flex flex-wrap gap-1.5">
							{snapshot?.coworkers.map((coworker) => (
								<button
									key={coworker.id}
									type="button"
									onClick={() => setCoworkerId(coworker.id)}
									className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-2xs transition-smooth ${
										coworkerId === coworker.id
											? "bg-pi-accent-soft text-pi-text shadow-ring"
											: "text-pi-text-muted hover:bg-pi-surface-raised"
									}`}
								>
									<Face handle={coworker.handle} name={coworker.name} face={coworker.face} size={18} />
									@{coworker.handle}
								</button>
							))}
						</div>
					) : (
						<div className="text-2xs text-pi-text-faint">Hire a coworker first.</div>
					)}

					<Input placeholder="Errand name (e.g. Morning sweep)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						rows={4}
						placeholder="What should this coworker do each run?"
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

					<label className="flex items-center gap-2 text-2xs text-pi-text-secondary">
						<input type="checkbox" checked={continuity} onChange={(e) => setContinuity(e.target.checked)} />
						Continuity — run in this coworker's own session so it learns between runs
					</label>

					<div className="flex items-center gap-1.5">
						<Button variant={delivery === "dm" ? "secondary" : "outline"} size="sm" onClick={() => setDelivery("dm")}>
							Deliver to DM
						</Button>
						<Button variant={delivery === "huddle" ? "secondary" : "outline"} size="sm" onClick={() => setDelivery("huddle")}>
							Deliver to huddle
						</Button>
						{delivery === "huddle" && (
							<select
								value={huddleId}
								onChange={(e) => setHuddleId(e.target.value)}
								className="rounded-md bg-pi-surface-raised px-2 py-1 text-2xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
							>
								<option value="">Pick a huddle…</option>
								{huddles.map((huddle) => (
									<option key={huddle.id} value={huddle.id}>
										{huddle.name}
									</option>
								))}
							</select>
						)}
					</div>

					{error && <div className="text-2xs text-pi-error">{error}</div>}
				</div>

				<div className="flex justify-end gap-2 border-t border-pi-border px-4 py-3">
					<Button
						variant="primary"
						size="sm"
						loading={busy}
						disabled={!name.trim() || !prompt.trim() || !coworkerId || (delivery === "huddle" && !huddleId)}
						onClick={() => void submit()}
					>
						Schedule errand
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
/**
 * Huddle create dialog: name + seated coworkers (max 6, matching the engine
 * seat cap).
 */

import { useState } from "react";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useOfficeStore } from "../../stores/office-store";
import { officeDeleteHuddle, officeSaveHuddle, type OfficeHuddleSummary } from "../../lib/rpc";
import { Face } from "./Face";

const MAX_MEMBERS = 6;

export function HuddleEditor({
	editing,
	onClose,
}: {
	editing?: OfficeHuddleSummary | undefined;
	onClose: () => void;
}) {
	const snapshot = useOfficeStore((s) => s.snapshot);
	const refresh = useOfficeStore((s) => s.refresh);
	const openHuddle = useOfficeStore((s) => s.openHuddle);
	const [name, setName] = useState(editing?.name ?? "");
	const [members, setMembers] = useState<string[]>(editing?.members ?? []);
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const toggle = (id: string) => {
		setMembers((current) => {
			if (current.includes(id)) return current.filter((m) => m !== id);
			if (current.length >= MAX_MEMBERS) return current;
			return [...current, id];
		});
	};

	const submit = async () => {
		if (!name.trim() || members.length === 0 || busy) return;
		setBusy(true);
		setError(null);
		try {
			const { huddleId } = await officeSaveHuddle({ name: name.trim(), members });
			await refresh();
			await openHuddle(huddleId);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModalBackdrop onClick={onClose}>
			<ModalPanel className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<span className="text-sm font-semibold text-pi-text">
						{editing ? "Edit huddle" : "New huddle"}
					</span>
					<Button variant="ghost" size="xs" onClick={onClose}>
						Cancel
					</Button>
				</div>

				<div className="space-y-3 px-4 py-3">
					<Input placeholder="Huddle name (e.g. Launch room)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
					<div>
						<div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">
							Seated ({members.length}/{MAX_MEMBERS})
						</div>
						<div className="space-y-1">
							{(snapshot?.coworkers ?? []).map((coworker) => (
								<label
									key={coworker.id}
									className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 transition-hover hover:bg-pi-surface-raised"
								>
									<input
										type="checkbox"
										checked={members.includes(coworker.id)}
										onChange={() => toggle(coworker.id)}
									/>
									<Face handle={coworker.handle} name={coworker.name} face={coworker.face} size={22} />
									<span className="min-w-0 flex-1 truncate text-xs text-pi-text-secondary">
										{coworker.name}
										{coworker.title ? ` · ${coworker.title}` : ""}
									</span>
								</label>
							))}
							{(snapshot?.coworkers.length ?? 0) === 0 && (
								<div className="py-2 text-2xs text-pi-text-faint">Hire a coworker first.</div>
							)}
						</div>
					</div>
					{error && <div className="text-2xs text-pi-error">{error}</div>}
				</div>

				<div className="flex justify-between gap-2 border-t border-pi-border px-4 py-3">
					{editing ? (
						confirmDelete ? (
							<Button
								variant="danger"
								size="sm"
								loading={busy}
								onClick={() => {
									setBusy(true);
									void officeDeleteHuddle(editing.id)
										.then(async () => {
											await refresh();
											onClose();
										})
										.catch((e) => setError(e instanceof Error ? e.message : String(e)))
										.finally(() => setBusy(false));
								}}
							>
								Confirm delete
							</Button>
						) : (
							<Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
								Delete huddle
							</Button>
						)
					) : (
						<span />
					)}
					<div className="flex gap-2">
						<Button
							variant="primary"
							size="sm"
							loading={busy}
							disabled={!name.trim() || members.length === 0}
							onClick={() => void submit()}
						>
							{editing ? "Save" : "Create huddle"}
						</Button>
					</div>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
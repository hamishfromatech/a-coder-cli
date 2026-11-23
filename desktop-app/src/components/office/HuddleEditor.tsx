/**
 * Huddle create dialog: name + seated coworkers. The desktop limit is a local
 * setting; the engine hard cap is 24.
 */

import { useMemo, useState } from "react";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useOfficeStore } from "../../stores/office-store";
import { officeDeleteHuddle, officeSaveHuddle, type OfficeHuddleSummary } from "../../lib/rpc";
import { useSettingsStore } from "../../stores/settings-store";
import { Face } from "./Face";

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
	const maxMembers = useSettingsStore((s) => s.officeMaxHuddleMembers);
	const [name, setName] = useState(editing?.name ?? "");
	const [members, setMembers] = useState<string[]>(editing?.members ?? []);
	const [filter, setFilter] = useState("");
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const coworkers = snapshot?.coworkers ?? [];
	const visibleCoworkers = useMemo(() => {
		const query = filter.trim().toLowerCase();
		if (!query) return coworkers;
		return coworkers.filter((coworker) =>
			[coworker.name, coworker.handle, coworker.title]
				.filter((value): value is string => Boolean(value))
				.some((value) => value.toLowerCase().includes(query)),
		);
	}, [coworkers, filter]);

	const toggle = (id: string) => {
		setMembers((current) => {
			if (current.includes(id)) return current.filter((m) => m !== id);
			if (current.length >= maxMembers) return current;
			return [...current, id];
		});
	};

	const selectAll = () => {
		setMembers((current) => {
			const next = [...current];
			for (const coworker of visibleCoworkers) {
				if (next.length >= maxMembers) break;
				if (!next.includes(coworker.id)) next.push(coworker.id);
			}
			return next;
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
			<ModalPanel className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
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
						<div className="mb-1.5 flex items-center justify-between gap-2">
							<span className="text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">
								Seated ({members.length}/{maxMembers})
							</span>
							<div className="flex items-center gap-2 text-2xs text-pi-text-muted">
								<button
									type="button"
									className="underline-offset-2 hover:text-pi-text hover:underline"
									onClick={selectAll}
									disabled={members.length >= maxMembers || visibleCoworkers.length === 0}
								>
									Select all
								</button>
								<button
									type="button"
									className="underline-offset-2 hover:text-pi-text hover:underline"
									onClick={() => setMembers([])}
									disabled={members.length === 0}
								>
									Clear
								</button>
							</div>
						</div>
						{coworkers.length > 6 && (
							<Input
								placeholder="Filter coworkers…"
								value={filter}
								onChange={(event) => setFilter(event.target.value)}
								className="mb-1.5"
							/>
						)}
						<div className="max-h-64 space-y-1 overflow-y-auto pr-1">
							{visibleCoworkers.map((coworker) => {
								const checked = members.includes(coworker.id);
								return (
									<label
										key={coworker.id}
										className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 transition-hover hover:bg-pi-surface-raised"
									>
										<input
											type="checkbox"
											checked={checked}
											disabled={!checked && members.length >= maxMembers}
											onChange={() => toggle(coworker.id)}
										/>
										<Face handle={coworker.handle} name={coworker.name} face={coworker.face} size={22} />
										<span className="min-w-0 flex-1 truncate text-xs text-pi-text-secondary">
											{coworker.name}
											{coworker.title ? ` · ${coworker.title}` : ""}
										</span>
									</label>
								);
							})}
							{coworkers.length === 0 && (
								<div className="py-2 text-2xs text-pi-text-faint">Hire a coworker first.</div>
							)}
							{coworkers.length > 0 && visibleCoworkers.length === 0 && (
								<div className="py-2 text-2xs text-pi-text-faint">No coworkers match “{filter.trim()}”.</div>
							)}
						</div>
						{members.length > maxMembers && (
							<div className="mt-1.5 text-2xs text-pi-warning">
								This huddle has {members.length} seats; your current limit is {maxMembers}. Saving keeps the existing seats.
							</div>
						)}
						{members.length > 6 && (
							<div className="mt-1.5 text-2xs text-pi-text-faint">
								Large rooms take turns; @mention someone to pull them into the next reply.
							</div>
						)}
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
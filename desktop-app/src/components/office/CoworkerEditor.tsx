/**
 * Coworker create/edit dialog: name, role, description, soul, face, model
 * override, autonomy.
 */

import { useEffect, useState } from "react";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useOfficeStore } from "../../stores/office-store";
import { getAvailableModels, officeDeleteCoworker, officeSaveCoworker, type OfficeCoworker } from "../../lib/rpc";
import { FACE_PALETTE, Face, type FaceShapeName } from "./Face";

const SHAPES: FaceShapeName[] = ["circle", "hexagon", "squircle", "triangle", "drop", "cloud"];

interface Props {
	editing?: OfficeCoworker | undefined;
	onClose: () => void;
}

export function CoworkerEditor({ editing, onClose }: Props) {
	const refresh = useOfficeStore((s) => s.refresh);
	const [name, setName] = useState(editing?.name ?? "");
	const [title, setTitle] = useState(editing?.title ?? "");
	const [description, setDescription] = useState(editing?.description ?? "");
	const [soul, setSoul] = useState(editing && editing.soul ? "" : "");
	const [keepSoul, setKeepSoul] = useState(Boolean(editing));
	const [color, setColor] = useState<string | undefined>(editing?.face.color);
	const [shape, setShape] = useState<FaceShapeName>(editing?.face.shape ?? "circle");
	const [model, setModel] = useState(editing?.model ?? "");
	const [models, setModels] = useState<Array<{ value: string; label: string }>>([]);
	const [autonomy, setAutonomy] = useState<"supervised" | "auto">(editing?.autonomy ?? "supervised");
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (editing && keepSoul) {
			setSoul(editing.soul);
		}
	}, [editing, keepSoul]);

	useEffect(() => {
		void getAvailableModels()
			.then((res) => {
				setModels(
					(res.models ?? []).map((m) => ({
						value: `${m.provider}/${m.id}`,
						label: m.name ? `${m.name} (${m.provider})` : `${m.provider}/${m.id}`,
					})),
				);
			})
			.catch(() => {});
	}, []);

	const handle = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const previewShape = shape;

	const submit = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		setError(null);
		try {
			await officeSaveCoworker({
				id: editing?.id,
				name: name.trim(),
				title: title.trim() || undefined,
				description: description.trim() || undefined,
				soul: soul.trim() || undefined,
				keepSoul: editing ? keepSoul && !soul.trim() : undefined,
				face: { shape, color },
				model: model.trim() || undefined,
				autonomy,
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
					<span className="text-sm font-semibold text-pi-text">
						{editing ? "Edit coworker" : "Hire a coworker"}
					</span>
					<Button variant="ghost" size="xs" onClick={onClose}>
						Cancel
					</Button>
				</div>

				<div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3">
					<div className="flex items-center gap-3">
						<Face handle={handle || "coworker"} name={name || "?"} face={{ shape: previewShape, color: color }} size={44} />
						<div className="flex-1 space-y-2">
							<Input placeholder="Name (e.g. Atlas)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
							<Input placeholder="Role (e.g. Scout)" value={title} onChange={(e) => setTitle(e.target.value)} />
						</div>
					</div>
					{handle && <div className="text-2xs text-pi-text-faint">Handle: @{handle}</div>}

					<Input
						placeholder="What is this coworker for?"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
					/>

					<div>
						<div className="mb-1 flex items-center justify-between">
							<span className="text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">Face</span>
							<button
								type="button"
								className="text-2xs text-pi-text-muted underline-offset-2 hover:underline"
								onClick={() => {
									setColor(undefined);
									setShape((current) => current);
								}}
							>
								auto from name
							</button>
						</div>
						<div className="flex flex-wrap items-center gap-1.5">
							{FACE_PALETTE.map((paletteColor) => (
								<button
									key={paletteColor}
									type="button"
									aria-label={`Color ${paletteColor}`}
									onClick={() => setColor(paletteColor)}
									className={`h-5 w-5 rounded-full transition-smooth ${color === paletteColor ? "ring-2 ring-pi-accent ring-offset-2 ring-offset-[var(--pi-surface-overlay)]" : ""}`}
									style={{ background: paletteColor }}
								/>
							))}
							<span className="mx-1 h-4 w-px bg-pi-border" />
							{SHAPES.map((shapeName) => (
								<button
									key={shapeName}
									type="button"
									onClick={() => setShape(shapeName)}
									className={`rounded px-1.5 py-0.5 text-2xs capitalize transition-smooth ${
										shape === shapeName
											? "bg-pi-accent-soft text-pi-text shadow-ring"
											: "text-pi-text-muted hover:bg-pi-surface-raised"
									}`}
								>
									{shapeName}
								</button>
							))}
						</div>
					</div>

					<div>
						<div className="mb-1 flex items-center justify-between">
							<span className="text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">Soul</span>
							{editing && (
								<label className="flex items-center gap-1 text-2xs text-pi-text-muted">
									<input type="checkbox" checked={keepSoul} onChange={(e) => setKeepSoul(e.target.checked)} />
									keep current soul
								</label>
							)}
						</div>
						<textarea
							value={soul}
							onChange={(e) => setSoul(e.target.value)}
							rows={5}
							placeholder="Leave blank for a composed soul from name + role + mission. Custom text becomes the persona verbatim."
							className="w-full resize-y rounded-md bg-pi-surface-raised px-2.5 py-1.5 text-xs text-pi-text shadow-ring transition-smooth placeholder:text-pi-text-faint focus:shadow-focus focus:outline-none"
						/>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<div>
							<div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">Model</div>
							<select
								value={model}
								onChange={(e) => setModel(e.target.value)}
								className="h-7 w-full rounded-md bg-pi-surface-raised px-2 text-2xs text-pi-text shadow-ring transition-smooth focus:shadow-focus focus:outline-none"
							>
								<option value="">Inherit (model picker)</option>
								{models.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</div>
						<div>
							<div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">Autonomy</div>
							<div className="flex gap-1.5">
								<Button
									variant={autonomy === "supervised" ? "secondary" : "outline"}
									size="sm"
									onClick={() => setAutonomy("supervised")}
								>
									Supervised
								</Button>
								<Button variant={autonomy === "auto" ? "secondary" : "outline"} size="sm" onClick={() => setAutonomy("auto")}>
									Auto
								</Button>
							</div>
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
									void officeDeleteCoworker(editing.id)
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
								Delete coworker
							</Button>
						)
					) : (
						<span />
					)}
					<Button variant="primary" size="sm" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
						{editing ? "Save" : "Hire"}
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
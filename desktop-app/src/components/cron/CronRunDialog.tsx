/**
 * Run-now dialog for routines with inputs. Manual values override the stored
 * defaults for this run only; they do not change the routine configuration.
 */

import { useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { cronRunNow, type CronJob } from "../../lib/rpc";

export function CronRunDialog({ job, onClose, onRan }: { job: CronJob; onClose: () => void; onRan?: () => void }) {
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries((job.variables ?? []).map((variable) => [variable.name, variable.value])),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await cronRunNow(job.id, values);
			onRan?.();
			onClose();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModalBackdrop onClick={onClose}>
			<ModalPanel className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<span className="text-sm font-semibold text-pi-text">Run “{job.name}” now</span>
					<Button variant="ghost" size="xs" onClick={onClose}>
						Cancel
					</Button>
				</div>
				<div className="space-y-2 px-4 py-3">
					<p className="text-2xs leading-relaxed text-pi-text-muted">
						Values below override the routine's stored defaults for this run only.
					</p>
					{(job.variables ?? []).map((variable) => (
						<label key={variable.name} className="block space-y-1">
							<span className="text-2xs font-medium text-pi-text-muted">{variable.name}</span>
							<Input
								value={values[variable.name] ?? ""}
								onChange={(event) =>
									setValues((current) => ({ ...current, [variable.name]: event.target.value }))
								}
							/>
						</label>
					))}
					{error && <div className="text-2xs text-pi-error">{error}</div>}
				</div>
				<div className="flex justify-end gap-2 border-t border-pi-border px-4 py-3">
					<Button variant="primary" size="sm" loading={busy} onClick={() => void run()}>
						Run now
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

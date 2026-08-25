import { useEffect, useRef, useState } from "react";
import { Brain, Save, X, Check } from "lucide-react";
import * as rpc from "../lib/rpc";
import { useModalA11y } from "../hooks/useModalA11y";
import { triggerHaptic } from "../lib/haptics";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface MemoryModalProps {
	open: boolean;
	onClose: () => void;
}

export function MemoryModal({ open, onClose }: MemoryModalProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [content, setContent] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useModalA11y(modalRef, open, onClose);

	useEffect(() => {
		if (!open) return;
		setLoading(true);
		setError(null);
		rpc
			.getMemory()
			.then((res) => setContent(res.content))
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
			.finally(() => setLoading(false));
	}, [open]);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
	}, [content]);

	const handleSave = async () => {
		setSaving(true);
		setError(null);
		try {
			await rpc.setMemory({ content });
			setSaved(true);
			triggerHaptic("crisp");
			setTimeout(() => setSaved(false), 1400);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	if (!open) return null;

	return (
		<ModalBackdrop
			ref={modalRef}
			aria-label="Persistent memory"
			className="bg-black/40"
			onClick={(e) => {
				if (e.target === modalRef.current) onClose();
			}}
		>
			<ModalPanel
				className="h-overlay max-w-2xl border border-pi-border"
				centered={false}
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<div className="flex items-center gap-2.5">
						<div className="flex h-7 w-7 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent">
							<Brain className="h-4 w-4" />
						</div>
						<div>
							<h2 className="text-[15px] font-semibold tracking-tight text-pi-text">
								Memory
							</h2>
							<p className="text-2xs text-pi-text-muted">
								Persistent notes shared across every workspace.
							</p>
						</div>
					</div>
					<IconButton
						variant="ghost"
						size="sm"
						icon={X}
						onClick={onClose}
						aria-label="Close memory panel"

					/>
				</div>

				{/* Body */}
				<div className="flex-1 overflow-hidden p-4">
					{loading ? (
						<div className="flex h-full items-center justify-center gap-2 text-[13px] text-pi-text-muted">
							<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-pi-border border-t-pi-accent" />
							Loading memory…
						</div>
					) : (
						<textarea
							ref={textareaRef}
							value={content}
							onChange={(e) => setContent(e.target.value)}
							placeholder="# Memory\n\nAdd notes, preferences, or context you want available in every workspace."
							className="h-full w-full resize-none rounded-lg border border-pi-border bg-pi-bg px-3 py-2.5 font-mono text-[13px] leading-relaxed text-pi-text placeholder:text-pi-text-faint focus:border-pi-accent focus:outline-none"
							spellCheck={false}
						/>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-pi-border px-4 py-3">
					<div className="min-w-0">
						{error ? (
							<span className="text-xs text-pi-error">{error}</span>
						) : saved ? (
							<span className="flex items-center gap-1 text-xs text-pi-success">
								<Check className="h-3.5 w-3.5" />
								Saved
							</span>
						) : (
							<span className="text-2xs text-pi-text-faint">
								Stored in ~/.a-coder-cli/MEMORY.md
							</span>
						)}
					</div>
					<Button
						variant="primary"
						size="sm"
						icon={saving ? undefined : saved ? Check : Save}
						loading={saving}
						onClick={() => void handleSave()}
						disabled={saving || loading}
					>
						{saving ? "Saving…" : saved ? "Saved" : "Save memory"}
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

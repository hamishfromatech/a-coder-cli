import { ChevronRight } from "lucide-react";
import { useCallback } from "react";
import {
	COMPLETION_SOUND_VARIANTS,
	previewCompletionSound,
} from "../../../lib/completion-sound";
import { previewHaptic, triggerHaptic } from "../../../lib/haptics";
import { useSettingsStore } from "../../../stores/settings-store";

/**
 * Turn-feedback control: a sound toggle + chime picker + Preview, and a trackpad
 * haptics toggle + Try it. Lives under Settings → Look & feel. Both are local UI
 * preferences (the desktop produces the cues itself; the CLI knows nothing about
 * them), so this reads and writes the local settings store rather than the CLI's
 * settings.json.
 */
export function CompletionSoundPicker() {
	const soundEnabled = useSettingsStore((s) => s.completionSoundEnabled);
	const setSoundEnabled = useSettingsStore((s) => s.setCompletionSoundEnabled);
	const variantId = useSettingsStore((s) => s.completionSoundVariantId);
	const setVariantId = useSettingsStore((s) => s.setCompletionSoundVariantId);
	const volume = useSettingsStore((s) => s.completionSoundVolume);
	const setVolume = useSettingsStore((s) => s.setCompletionSoundVolume);
	const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
	const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);
	const chatBackdrop = useSettingsStore((s) => s.chatBackdrop);
	const setChatBackdrop = useSettingsStore((s) => s.setChatBackdrop);

	const previewSound = useCallback(() => {
		// Preview bypasses the enable toggle so a chime can be auditioned even
		// when cues are switched off — handy while picking one.
		triggerHaptic("crisp");
		previewCompletionSound(variantId);
	}, [variantId]);

	return (
		<div className="space-y-3">
			<ToggleRow
				id="completion-sound-enable"
				label="Play sound"
				checked={soundEnabled}
				onChange={() => setSoundEnabled(!soundEnabled)}
			/>

			<div className="flex items-center gap-2">
				<div className="relative">
					<select
						value={String(variantId)}
						onChange={(e) => {
							triggerHaptic("selection");
							setVariantId(Number(e.target.value));
						}}
						className="appearance-none rounded-md bg-pi-surface-raised px-3 py-1.5 pr-7 text-[12px] font-medium text-pi-text shadow-[0_0_0_1px_var(--pi-border)] transition-smooth focus:shadow-focus"
					>
						{COMPLETION_SOUND_VARIANTS.map((v) => (
							<option key={v.id} value={String(v.id)}>
								{v.name}
							</option>
						))}
					</select>
					<ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-pi-text-muted transition-smooth" />
				</div>

				<button
					type="button"
					onClick={previewSound}
					className="inline-flex items-center gap-1.5 rounded-md bg-pi-surface-raised px-3 py-1.5 text-[12px] font-medium text-pi-text shadow-[0_0_0_1px_var(--pi-border)] transition-hover active-press hover:bg-pi-surface-overlay"
				>
					Preview
				</button>
			</div>

			<div className="flex items-center gap-3">
				<span className="w-12 text-[11px] text-pi-text-muted">Volume</span>
				<input
					type="range"
					min={0}
					max={1}
					step={0.01}
					value={volume}
					onChange={(e) => {
						triggerHaptic("selection");
						setVolume(Number(e.target.value));
					}}
					className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-pi-surface-raised accent-pi-accent"
				/>
				<span className="w-10 text-right font-mono text-[11px] text-pi-text-secondary">
					{Math.round(volume * 100)}%
				</span>
			</div>

			<div className="h-px bg-pi-border" />

			<div className="flex items-center justify-between gap-4">
				<div className="min-w-0 flex-1">
					<ToggleRow
						id="completion-haptics-enable"
						label="Trackpad haptics"
						checked={hapticsEnabled}
						onChange={() => setHapticsEnabled(!hapticsEnabled)}
					/>
				</div>
				<button
					type="button"
					onClick={() => {
						triggerHaptic("crisp");
						previewHaptic("streamDone");
					}}
					className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-pi-surface-raised px-3 py-1.5 text-[12px] font-medium text-pi-text shadow-[0_0_0_1px_var(--pi-border)] transition-hover active-press hover:bg-pi-surface-overlay"
				>
					Try it
				</button>
			</div>
			<div className="h-px bg-pi-border" />

			<div className="space-y-1">
				<ToggleRow
					id="chat-backdrop-enable"
					label="Chat Backdrop"
					checked={chatBackdrop}
					onChange={() => setChatBackdrop(!chatBackdrop)}
				/>
				<p className="text-[11px] leading-relaxed text-pi-text-muted">
					The faint image behind the conversation.
				</p>
			</div>
		</div>
	);
}

function ToggleRow({
	id,
	label,
	checked,
	onChange,
}: {
	id: string;
	label: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<label htmlFor={id} className="text-[12px] font-medium text-pi-text-secondary">
				{label}
			</label>
			<button
				type="button"
				id={id}
				onClick={() => {
					triggerHaptic("selection");
					onChange();
				}}
				aria-pressed={checked}
				className={`relative inline-flex h-[20px] w-8 shrink-0 items-center rounded-full active-press transition-smooth ${
					checked
						? "bg-pi-accent hover:bg-pi-accent-hover"
						: "bg-pi-surface-raised shadow-[0_0_0_1px_var(--pi-border)] hover:bg-pi-surface-overlay"
				}`}
			>
				<span
					className={`absolute top-0.5 h-4 w-4 rounded-full bg-white/90 shadow-sm transition-transform ${
						checked ? "translate-x-[12px]" : "translate-x-0.5"
					}`}
				/>
			</button>
		</div>
	);
}

export default CompletionSoundPicker;
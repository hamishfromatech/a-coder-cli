import { BatteryCharging, Clock3, Power } from "lucide-react";
import { triggerHaptic } from "../../../lib/haptics";
import {
	DEFAULT_KEEP_AWAKE_MODE,
	type KeepAwakeMode,
	useKeepAwakeStore,
} from "../../../lib/keep-awake";

const MODES: { id: KeepAwakeMode; label: string; detail: string; icon: typeof Power }[] = [
	{
		id: "off",
		label: "Off",
		detail: "Let the computer sleep normally.",
		icon: Power,
	},
	{
		id: "while-working",
		label: "While working",
		detail: "Stay awake only while a turn or compaction is running. The display can still dim.",
		icon: Clock3,
	},
	{
		id: "always",
		label: "Always",
		detail: "Never sleep while A-Coder Desktop is open.",
		icon: BatteryCharging,
	},
];

/** Device-local: each computer keeps its own choice. */
export function KeepAwakeSection() {
	const mode = useKeepAwakeStore((s) => s.mode);
	const setMode = useKeepAwakeStore((s) => s.setMode);

	return (
		<div className="grid gap-2 sm:grid-cols-3">
			{MODES.map((option) => {
				const active = mode === option.id;
				const Icon = option.icon;
				return (
					<button
						key={option.id}
						type="button"
						onClick={() => {
							triggerHaptic("selection");
							setMode(option.id);
						}}
						aria-pressed={active}
						className={`flex flex-col gap-1.5 rounded-pi-lg border px-3 py-2.5 text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none ${
							active
								? "border-pi-accent/40 bg-pi-accent-soft"
								: "border-pi-border bg-pi-surface hover:bg-pi-surface-raised"
						}`}
					>
						<span className="flex items-center gap-2 text-xs font-semibold text-pi-text">
							<Icon className={`h-3.5 w-3.5 ${active ? "text-pi-accent" : "text-pi-text-muted"}`} />
							{option.label}
						</span>
						<span className="text-2xs leading-relaxed text-pi-text-muted">{option.detail}</span>
					</button>
				);
			})}
			{mode !== DEFAULT_KEEP_AWAKE_MODE && (
				<button
					type="button"
					onClick={() => setMode(DEFAULT_KEEP_AWAKE_MODE)}
					className="self-start text-2xs text-pi-text-muted underline-offset-2 transition-hover hover:text-pi-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
				>
					Reset to while working
				</button>
			)}
		</div>
	);
}

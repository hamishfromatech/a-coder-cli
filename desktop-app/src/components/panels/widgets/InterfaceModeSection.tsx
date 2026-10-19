import { LayoutPanelLeft, MessageSquare } from "lucide-react";
import { triggerHaptic } from "../../../lib/haptics";
import { useUiStore, type InterfaceMode } from "../../../stores/ui-store";

const MODES: { id: InterfaceMode; label: string; detail: string; icon: typeof MessageSquare }[] = [
	{
		id: "simple",
		label: "Simple",
		detail: "Chat-first. Hides advanced panels, stats, and tree from the resting UI.",
		icon: MessageSquare,
	},
	{
		id: "advanced",
		label: "Advanced",
		detail: "All panels, instrumentation, and sidebar sections.",
		icon: LayoutPanelLeft,
	},
];

/** Interface mode only changes what is shown; every command and pane still
 *  answers the palette or its shortcut in either mode. */
export function InterfaceModeSection() {
	const mode = useUiStore((s) => s.interfaceMode);
	const setMode = useUiStore((s) => s.setInterfaceMode);

	return (
		<div className="grid gap-2 sm:grid-cols-2">
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
						className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none ${
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
		</div>
	);
}

import { useCallback } from "react";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import * as rpc from "../../../lib/rpc";
import { triggerHaptic } from "../../../lib/haptics";

interface Preset {
	id: string;
	label: string;
	caption: string;
	levels: ThinkingLevel[];
}

const PRESETS: Preset[] = [
	{
		id: "off",
		label: "Off",
		caption: "Quickest replies, no reasoning shown.",
		levels: ["off"],
	},
	{
		id: "light",
		label: "Light",
		caption: "A little reasoning for everyday tasks.",
		levels: ["minimal", "low"],
	},
	{
		id: "balanced",
		label: "Balanced",
		caption: "Good reasoning without slowing down.",
		levels: ["medium"],
	},
	{
		id: "thoughtful",
		label: "Thoughtful",
		caption: "Thinks harder about tricky questions.",
		levels: ["high"],
	},
	{
		id: "maximum",
		label: "Maximum",
		caption: "Slowest but most careful.",
		levels: ["xhigh"],
	},
];

function findPresetForLevel(level: ThinkingLevel | undefined): Preset {
	if (!level) return PRESETS[0];
	for (const p of PRESETS) {
		if (p.levels.includes(level)) return p;
	}
	return PRESETS[0];
}

interface Props {
	value: ThinkingLevel | undefined;
	onChange: (level: ThinkingLevel) => void;
}

/**
 * Five-preset segmented control for thinking level. Each preset maps to one or
 * two underlying CLI levels (medium / high / xhigh). The first level in the
 * preset is what we persist.
 */
export function ThinkingPresetPicker({ value, onChange }: Props) {
	const current = findPresetForLevel(value);

	const choose = useCallback(
		async (preset: Preset) => {
			const next = preset.levels[0];
			if (next === value) return;
			onChange(next);
			triggerHaptic("crisp");
			try {
				await rpc.setThinkingLevel(next);
			} catch (e) {
				console.error("Failed to set thinking level", e);
			}
		},
		[onChange, value],
	);

	return (
		<div className="space-y-2">
			<div
				role="radiogroup"
				aria-label="Reasoning"
				className={`grid grid-cols-5 gap-1 rounded-lg bg-pi-surface-raised p-1 shadow-[0_0_0_1px_var(--pi-border)] transition-smooth hover:shadow-card-hover`}
			>
				{PRESETS.map((preset) => {
					const active = current.id === preset.id;
					return (
						<button
							key={preset.id}
							type="button"
							role="radio"
							aria-checked={active}
							onClick={() => void choose(preset)}
							className={`flex h-9 items-center justify-center rounded-md text-[11.5px] font-semibold transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
								active
									? "bg-pi-surface text-pi-text shadow-sm hover:bg-pi-surface-overlay"
									: "text-pi-text-muted hover:text-pi-text hover:bg-pi-surface-raised/50"
							}`}
						>
							{preset.label}
						</button>
					);
				})}
			</div>
			<p className="text-[11px] leading-relaxed text-pi-text-muted">
				<span className="font-medium text-pi-text">{current.label}.</span>{" "}
				{current.caption}
			</p>
		</div>
	);
}

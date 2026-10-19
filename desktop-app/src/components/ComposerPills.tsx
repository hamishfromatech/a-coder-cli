import { Brain, Check, ChevronDown, ChevronRight, Cpu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../lib/escape-layers";
import { triggerHaptic } from "../lib/haptics";
import * as rpc from "../lib/rpc";
import { useSessionStore } from "../stores/session-store";
import { Tip } from "./ui/Tip";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_OPTIONS: { value: ThinkingLevel; label: string; detail: string }[] = [
	{ value: "off", label: "Off", detail: "No extended reasoning" },
	{ value: "minimal", label: "Minimal", detail: "Quickest reasoning" },
	{ value: "low", label: "Low", detail: "Light reasoning" },
	{ value: "medium", label: "Medium", detail: "Balanced" },
	{ value: "high", label: "High", detail: "Deeper reasoning" },
	{ value: "xhigh", label: "Max", detail: "Most reasoning" },
];

const PILL =
	"flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-3xs font-medium text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none";

/** Model + thinking controls live at the composer, where they apply to the
 *  next turn, instead of occupying permanent width in the app header. */
export function ComposerPills() {
	const { model, thinkingLevel, setModel, setThinkingLevel } = useSessionStore(
		useShallow((s) => ({
			model: s.model,
			thinkingLevel: s.thinkingLevel,
			setModel: s.setModel,
			setThinkingLevel: s.setThinkingLevel,
		})),
	);

	const handleCycleModel = async () => {
		triggerHaptic("selection");
		try {
			const res = (await rpc.sendCommand({ type: "cycle_model" })) as {
				model?: { provider: string; id: string; name?: string };
				thinkingLevel?: string;
			} | null;
			if (res?.model) {
				setModel(res.model as never);
				if (res.thinkingLevel) setThinkingLevel(res.thinkingLevel);
			}
		} catch (e) {
			console.error(e);
		}
	};

	return (
		<div className="flex min-w-0 items-center gap-1">
			<div className="inline-flex min-w-0 items-stretch overflow-hidden rounded-md border border-pi-border bg-pi-surface-raised">
				<Tip content="Change model" placement="control">
					<button
						type="button"
						onClick={() => {
							triggerHaptic("selection");
							window.dispatchEvent(new CustomEvent("a-coder:open-model-picker"));
						}}
						aria-label="Change model"
						className="flex h-6 min-w-0 cursor-pointer items-center gap-1 px-1.5 text-3xs font-medium text-pi-text-secondary transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					>
						<Cpu className="h-3 w-3 shrink-0 text-pi-accent" />
						<span className="max-w-40 truncate">{model?.name ?? "Select model"}</span>
						<ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-60" />
					</button>
				</Tip>
				<Tip content="Cycle model" placement="control">
					<button
						type="button"
						onClick={() => void handleCycleModel()}
						aria-label="Cycle model"
						className="flex w-5 cursor-pointer items-center justify-center border-l border-pi-border text-pi-text-muted transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					>
						<ChevronRight className="h-3 w-3" />
					</button>
				</Tip>
			</div>
			<ThinkingPill
				level={(thinkingLevel ?? "off") as ThinkingLevel}
				onChange={(level) => setThinkingLevel(level)}
			/>
		</div>
	);
}

function ThinkingPill({
	level,
	onChange,
}: {
	level: ThinkingLevel;
	onChange: (level: ThinkingLevel) => void;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.contextMenu);
		const onDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.contextMenu)) return;
			event.preventDefault();
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			unregister();
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const current = THINKING_OPTIONS.find((option) => option.value === level) ?? THINKING_OPTIONS[0]!;

	const select = async (next: ThinkingLevel) => {
		setOpen(false);
		if (next === level) return;
		onChange(next);
		try {
			await rpc.sendCommand({ type: "set_thinking_level", level: next });
		} catch (e) {
			console.error("Failed to set thinking level", e);
		}
	};

	return (
		<div ref={rootRef} className="relative">
			<Tip content={`Thinking: ${current.label}`} placement="control">
				<button
					type="button"
					onClick={() => {
						triggerHaptic("selection");
						setOpen((value) => !value);
					}}
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-label={`Thinking level: ${current.label}`}
					className={PILL}
				>
					<Brain className={`h-3 w-3 shrink-0 ${level === "off" ? "opacity-60" : "text-pi-accent"}`} />
					<span className="max-w-16 truncate">{current.label}</span>
					<ChevronDown className={`h-2.5 w-2.5 shrink-0 opacity-50 transition-smooth ${open ? "rotate-180" : ""}`} />
				</button>
			</Tip>
			{open && (
				<div
					role="listbox"
					aria-label="Thinking level"
					className="absolute bottom-full left-0 z-popover mb-1 w-52 overflow-hidden rounded-lg border border-pi-border bg-pi-surface-overlay py-1 shadow-overlay"
				>
					{THINKING_OPTIONS.map((option) => {
						const active = option.value === level;
						return (
							<button
								key={option.value}
								type="button"
								role="option"
								aria-selected={active}
								onClick={() => void select(option.value)}
								className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none ${active ? "bg-pi-surface-raised" : "hover:bg-pi-surface-raised"}`}
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center justify-between gap-2 text-2xs">
										<span className="font-semibold text-pi-text">{option.label}</span>
										{active && <Check className="h-3 w-3 shrink-0 text-pi-accent" />}
									</div>
									<div className="mt-0.5 text-3xs text-pi-text-muted">{option.detail}</div>
								</div>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

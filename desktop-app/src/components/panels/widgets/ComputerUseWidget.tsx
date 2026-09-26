import { useEffect, useState } from "react";
import { Eye, MousePointerClick, ShieldCheck } from "lucide-react";
import { Button } from "../../ui/Button";
import { Switch } from "../../ui/Switch";

/**
 * Computer use (experimental) settings widget.
 *
 * A friendly animated explainer showing how desktop control works — the agent
 * looks at labeled screenshots, asks before acting, and acts without stealing
 * your cursor or keyboard — followed by the enable switch. Turning it on from
 * a fresh state requires an explicit confirm (parity with the CLI's
 * disclaimer). Persists the CLI's `computerUse` settings.json key; the engine
 * picks it up when a session rebuilds its tool runtime.
 */

const EXPLAINER_STEPS = [
	{
		icon: Eye,
		title: "It looks",
		body: "The agent takes a screenshot and reads a numbered list of buttons, fields, and menus.",
	},
	{
		icon: ShieldCheck,
		title: "It asks",
		body: "Screenshots are read-only. Every click and keystroke follows your permission mode.",
	},
	{
		icon: MousePointerClick,
		title: "It acts",
		body: "Input goes to one target window — your cursor and keyboard are never stolen.",
	},
];

export function ComputerUseWidget({
	value,
	onChange,
}: {
	value: unknown;
	onChange: (v: unknown) => void;
}) {
	const enabled = value === true;
	const [confirming, setConfirming] = useState(false);

	// Leaving the enabled state (or remounting after a settings write) clears
	// any pending confirmation.
	useEffect(() => {
		if (enabled) {
			setConfirming(false);
		}
	}, [enabled]);

	return (
		<div className="cu-explainer space-y-3" data-slot="computer-use-widget">
			{/* Animated explainer: a mock window gets numbered badges, a cursor
			    glides to one and clicks, an approval chip taps in. Loops ~7s. */}
			<div
				className="relative overflow-hidden rounded-lg border border-pi-border bg-pi-surface p-3"
				aria-hidden="true"
			>
				<div className="cu-scan pointer-events-none absolute inset-0" />
				<div className="flex items-center gap-1.5 pb-2">
					<span className="h-2 w-2 rounded-full bg-pi-border" />
					<span className="h-2 w-2 rounded-full bg-pi-border" />
					<span className="h-2 w-2 rounded-full bg-pi-border" />
					<span className="ms-2 text-2xs text-pi-text-muted">frontmost window</span>
				</div>
				<div className="relative h-16">
					<div className="absolute left-0 top-0 h-14 w-40 rounded-md border border-pi-border bg-pi-surface-raised" />
					{/* Labeled targets inside the mock window */}
					<div className="absolute left-2 top-2 flex h-4 w-32 items-center rounded bg-pi-accent-soft/60 px-1.5">
						<span className="cu-badge cu-badge-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-pi-accent text-[8px] font-semibold text-white">
							1
						</span>
					</div>
					<div className="absolute left-2 top-8 flex h-4 w-32 items-center rounded bg-pi-accent-soft/40 px-1.5">
						<span className="cu-badge cu-badge-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-pi-accent text-[8px] font-semibold text-white">
							2
						</span>
					</div>
					{/* Approval chip */}
					<div className="cu-allow absolute right-0 top-0 rounded-md border border-pi-accent/40 bg-pi-accent-soft px-2 py-1 text-2xs font-medium text-pi-accent">
						Allow click?
					</div>
					{/* Cursor + click ripple */}
					<div className="cu-cursor absolute left-0 top-0 h-2 w-2 rounded-full bg-pi-text shadow-ring" />
					<div className="cu-ripple absolute left-[54px] top-[30px] h-4 w-4 rounded-full border-2 border-pi-accent" />
				</div>
			</div>

			{/* The three steps light up in sync with the animation phases. */}
			<ol className="space-y-1.5">
				{EXPLAINER_STEPS.map((step, index) => (
					<li key={step.title} className={`cu-step cu-step-${index + 1} flex items-start gap-2`}>
						<step.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-accent" />
						<span className="text-2xs leading-relaxed text-pi-text-muted">
							<span className="font-medium text-pi-text">{step.title}</span> — {step.body}
						</span>
					</li>
				))}
			</ol>

			<div className="flex items-center justify-between gap-3 border-t border-pi-border pt-2.5">
				<div className="min-w-0">
					<label className="text-xs font-medium text-pi-text" htmlFor="computer-use-toggle">
						Enable computer use
					</label>
					<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
						{enabled
							? "On — new sessions can drive the desktop. Applies after a session restart."
							: "Off — the agent cannot see or control the desktop."}
					</p>
				</div>
				<Switch
					id="computer-use-switch"
					checked={enabled}
					onChange={() => {
						if (enabled) {
							onChange(false);
						} else {
							setConfirming(true);
						}
					}}
					ariaLabel="Enable computer use"
				/>
			</div>

			{confirming && !enabled && (
				<div className="flex items-center justify-between gap-3 rounded-lg border border-pi-accent/30 bg-pi-accent-soft/40 px-3 py-2">
					<p className="text-2xs leading-relaxed text-pi-text">
						Enable for new sessions? The agent will follow your permission mode for every action.
					</p>
					<div className="flex shrink-0 gap-2">
						<Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={() => {
								setConfirming(false);
								onChange(true);
							}}
						>
							Enable
						</Button>
					</div>
				</div>
			)}

			<style>{`
				.cu-explainer .cu-badge { opacity: 0; }
				.cu-badge-1 { animation: cu-badge-pop 7s ease-in-out infinite; }
				.cu-badge-2 { animation: cu-badge-pop 7s ease-in-out 0.35s infinite; }
				.cu-cursor { opacity: 0; animation: cu-cursor-move 7s ease-in-out infinite; }
				.cu-ripple { opacity: 0; animation: cu-ripple 7s ease-in-out infinite; }
				.cu-allow { opacity: 0; animation: cu-allow-tap 7s ease-in-out infinite; }
				.cu-scan { opacity: 0; animation: cu-scan 7s ease-in-out infinite; background: linear-gradient(180deg, transparent, var(--pi-accent-soft, rgba(99, 161, 255, 0.12)), transparent); }
				.cu-step { opacity: 0.45; }
				.cu-step-1 { animation: cu-step-light-1 7s ease-in-out infinite; }
				.cu-step-2 { animation: cu-step-light-2 7s ease-in-out infinite; }
				.cu-step-3 { animation: cu-step-light-3 7s ease-in-out infinite; }
				@keyframes cu-badge-pop {
					0%, 6% { opacity: 0; transform: scale(0.4); }
					14%, 88% { opacity: 1; transform: scale(1); }
					96%, 100% { opacity: 0; transform: scale(0.9); }
				}
				@keyframes cu-cursor-move {
					0%, 22% { opacity: 0; transform: translate(0, 0); }
					30% { opacity: 1; }
					46%, 62% { opacity: 1; transform: translate(56px, 30px); }
					72%, 100% { opacity: 0; transform: translate(56px, 30px); }
				}
				@keyframes cu-ripple {
					44%, 52% { opacity: 0.9; transform: scale(0.4); }
					64% { opacity: 0; transform: scale(1.7); }
					100% { opacity: 0; }
				}
				@keyframes cu-allow-tap {
					0%, 58% { opacity: 0; transform: translateY(4px); }
					66%, 86% { opacity: 1; transform: translateY(0); }
					94%, 100% { opacity: 0; }
				}
				@keyframes cu-scan {
					0%, 4% { opacity: 0; transform: translateY(-100%); }
					12% { opacity: 1; }
					22% { opacity: 0; transform: translateY(100%); }
					100% { opacity: 0; }
				}
				@keyframes cu-step-light-1 {
					0%, 8% { opacity: 0.45; }
					16%, 80% { opacity: 1; }
					92%, 100% { opacity: 0.45; }
				}
				@keyframes cu-step-light-2 {
					0%, 28% { opacity: 0.45; }
					40%, 80% { opacity: 1; }
					92%, 100% { opacity: 0.45; }
				}
				@keyframes cu-step-light-3 {
					0%, 52% { opacity: 0.45; }
					64%, 84% { opacity: 1; }
					96%, 100% { opacity: 0.45; }
				}
				@media (prefers-reduced-motion: reduce) {
					.cu-explainer .cu-badge,
					.cu-explainer .cu-cursor,
					.cu-explainer .cu-allow { opacity: 1; animation: none; }
					.cu-explainer .cu-ripple,
					.cu-explainer .cu-scan { opacity: 0; animation: none; }
					.cu-explainer .cu-step { opacity: 1; animation: none; }
				}
			`}</style>
		</div>
	);
}
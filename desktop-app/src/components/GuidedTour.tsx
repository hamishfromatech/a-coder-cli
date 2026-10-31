/**
 * Guided tour: an interactive walkthrough of the app's real surfaces. Each
 * step optionally DRIVES the app (switch modes, open panels via the existing
 * events/stores), then a spotlight cutout highlights the target while a card
 * explains it. The overlay lives at the app root so it survives interface
 * switches, and its escape-layer slot closes it on Esc.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Compass, Sparkles, X } from "lucide-react";

import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../lib/escape-layers";
import { useTourStore } from "../stores/tour-store";
import { useUiStore } from "../stores/ui-store";
import { cn } from "../lib/cn";

/** DOM markers the spotlight resolves. Keep in sync with the components. */
export type TourTarget =
	| "tour-composer"
	| "tour-command-palette"
	| "tour-left-rail"
	| "tour-right-sidebar"
	| "tour-settings-panel"
	| "tour-ide-rail";

interface TourStep {
	id: string;
	title: string;
	body: string;
	/** Short bullets shown under the body (max 3). */
	points?: string[];
	target?: TourTarget;
	/** Runs once on step entry; drives the app to the state being showcased. */
	drive?: () => void;
}

const STEPS: TourStep[] = [
	{
		id: "welcome",
		title: "Welcome to A-Coder",
		body: "This is your desktop home for the A-Coder agent: a chat that does real work in your projects — editing files, running commands, and managing its own longer jobs. Ninety seconds to walk the main surfaces.",
		points: [
			"Everything here drives the same engine as the CLI",
			"You can leave anytime — the tour lives in ⌘K afterwards",
		],
	},
	{
		id: "chat",
		title: "Chat is the engine's pedal",
		target: "tour-composer",
		body: "Ask in plain language. The agent plans, edits files, and runs commands on your machine; you approve before it acts on anything sensitive.",
		points: [
			"Attach files and images with the paperclip",
			"Type / for the command list",
			"Keep typing while it works — messages queue",
		],
	},
	{
		id: "palette",
		title: "One shortcut to everything",
		target: "tour-command-palette",
		drive: () => window.dispatchEvent(new CustomEvent("a-coder:command-palette")),
		body: "The command palette reaches every panel and action: sessions, find, settings sections, subagents, updates.",
		points: ["⌘K opens it anywhere", "Esc closes it — you won't lose your place"],
	},
	{
		id: "rail",
		title: "Sessions and projects live on the left",
		target: "tour-left-rail",
		drive: () => window.dispatchEvent(new CustomEvent("a-coder:close-overlay")),
		body: "The rail switches the sidebar between Sessions and Projects. Click the active icon to close it; the badge shows background jobs waiting on you.",
		points: ["Sessions resume where they left off", "The session tree lives under Sessions"],
	},
	{
		id: "sidebar",
		title: "Work products stack up on the right",
		target: "tour-right-sidebar",
		drive: () => useUiStore.getState().setRightSidebarTab("files"),
		body: "The right sidebar is a drawer of panels: the project's file explorer, git changes, and a browser panel the agent can drive and you can inspect live.",
		points: ["Artifacts the agent writes open here", "The browser panel is a real Chromium page"],
	},
	{
		id: "cron",
		title: "Give it work while you're away",
		target: "tour-right-sidebar",
		drive: () => useUiStore.getState().setRightSidebarTab("cron"),
		body: "Scheduled tasks run the agent on a clock — a morning triage digest, a nightly test sweep, a weekly summary. Create them here or just ask in chat.",
		points: ["Runs land in history with results and costs", "Triaged failures surface in the inbox next door"],
	},
	{
		id: "activity",
		title: "One inbox for what needs you",
		target: "tour-right-sidebar",
		drive: () => useUiStore.getState().setRightSidebarTab("activity"),
		body: "The Decisions inbox collects everything that needs a human call: approvals, completed-run digests, failed-run verdicts. Snooze, resolve, move on.",
		points: ["The rail badge counts items that need you"],
	},
	{
		id: "office",
		title: "A workplace with a floor",
		target: "tour-right-sidebar",
		drive: () => useUiStore.getState().setRightSidebarTab("office"),
		body: "The office gives your agents presence: avatars at desks, huddle chats, and voice calls. Talk to them like coworkers; they keep their own threads.",
		points: ["Voice calls can share your screen for context"],
	},
	{
		id: "ide",
		title: "Watch the work in the IDE",
		target: "tour-ide-rail",
		drive: () => {
			window.dispatchEvent(new CustomEvent("a-coder:close-overlay"));
			useUiStore.getState().setInterfaceMode("ide");
		},
		body: "IDE mode is a focused workspace: a Monaco editor with quick open, a git-aware explorer, workspace search, and a terminal. Ask the agent in chat; its edits land in your open tabs instantly.",
		points: ["⌘P jumps to any file", "The exit arrow on the rail returns to chat"],
	},
	{
		id: "settings",
		title: "Configure without ceremony",
		target: "tour-settings-panel",
		drive: () => {
			window.dispatchEvent(new CustomEvent("a-coder:close-overlay"));
			useUiStore.getState().setInterfaceMode("advanced");
			window.dispatchEvent(new CustomEvent("a-coder:open-settings"));
		},
		body: "Providers and keys, model defaults (including a separate model for scheduled runs), MCP integrations, and per-project settings all live here.",
		points: ["⌘, opens Settings", "Every field is searchable"],
	},
	{
		id: "wrapup",
		title: "You're set up",
		drive: () => {
			window.dispatchEvent(new CustomEvent("a-coder:close-overlay"));
			useUiStore.getState().setInterfaceMode("advanced");
		},
		body: "That's the tour. Start with a real task in the chat — the agent is ready whenever you are — and everything you just saw stays where you found it.",
		points: ["⌘K → Start guided tour replays this", "Updates arrive in-app with release notes"],
	},
];

const TOUR_CARD_WIDTH = 400;
/** Rough card height for placement; the exact height varies with body copy. */
const TOUR_CARD_HEIGHT = 240;

/**
 * Place the tour card near the spotlight without ever leaving the viewport:
 * attempts below → above → right → left of the spotlight, and a candidate
 * only wins when its unclamped position fits. Full-height targets (the rails,
 * the sidebar) fall through to the sides or a centered card. Every value is
 * clamped to the viewport regardless, so edges can never cut the card off.
 */
export function computeCardPosition(
	spot: DOMRect | null,
	width: number,
	cardHeight: number,
): { left: number; top: number } {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const margin = 12;
	if (!spot) {
		return {
			left: Math.max(margin, (vw - width) / 2),
			top: Math.max(margin, (vh - cardHeight) / 2 - 32),
		};
	}
	const candidates: Array<{ left: number; top: number }> = [
		// Below the spotlight, anchored to its horizontal middle.
		{ left: spot.left + (spot.width - width) / 2, top: spot.bottom + margin },
		// Above it.
		{ left: spot.left + (spot.width - width) / 2, top: spot.top - margin - cardHeight },
		// Right of it (tall spotlights like the left rail).
		{ left: spot.right + margin, top: spot.top + 24 },
		// Left of it (right-docked spotlights like the sidebar).
		{ left: spot.left - margin - width, top: spot.top + 24 },
	];
	for (const candidate of candidates) {
		const left = Math.max(margin, Math.min(candidate.left, vw - width - margin));
		const top = Math.max(margin, Math.min(candidate.top, vh - cardHeight - margin));
		if (candidate.left === left && candidate.top === top) return { left, top };
	}
	return {
		left: Math.max(margin, (vw - width) / 2),
		top: Math.max(margin, (vh - cardHeight) / 2 - 32),
	};
}

export function GuidedTour(): ReactNode {
	const stepIndex = useTourStore((s) => s.stepIndex);
	const next = useTourStore((s) => s.next);
	const back = useTourStore((s) => s.back);
	const end = useTourStore((s) => s.end);

	const [rect, setRect] = useState<DOMRect | null>(null);
	const [settled, setSettled] = useState(false);
	const tourActive = stepIndex !== null;

	// Drive the app on step entry, then let layout settle before measuring.
	useEffect(() => {
		if (!tourActive) return;
		const current = STEPS[Math.min(stepIndex!, STEPS.length - 1)]!;
		if (stepIndex! >= STEPS.length) {
			end();
			return;
		}
		setSettled(false);
		setRect(null);
		try {
			current.drive?.();
		} catch (error) {
			console.error("Tour step drive failed", error);
		}
		let settleTimer = 0;
		const frame = requestAnimationFrame(() => {
			settleTimer = window.setTimeout(() => setSettled(true), 260);
		});
		return () => {
			cancelAnimationFrame(frame);
			if (settleTimer) window.clearTimeout(settleTimer);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stepIndex, tourActive]);

	// Track the spotlight target while the step is settled.
	useEffect(() => {
		if (!tourActive) {
			setRect(null);
			return;
		}
		const current = STEPS[Math.min(stepIndex!, STEPS.length - 1)]!;
		if (!current.target) {
			setRect(null);
			return;
		}
		const measure = () => {
			const el = document.querySelector(`[data-tour-id="${current.target}"]`);
			setRect(el instanceof HTMLElement ? el.getBoundingClientRect() : null);
		};
		measure();
		const timer = setInterval(measure, 350);
		window.addEventListener("resize", measure);
		return () => {
			clearInterval(timer);
			window.removeEventListener("resize", measure);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stepIndex, settled, tourActive]);

	// Escape layer: Esc ends the tour. An overlay opened by a drive (palette,
	// settings) stays open in the background — a second Esc reaches it
	// normally once this layer is gone.
	useEffect(() => {
		if (!tourActive) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.picker);
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.picker)) return;
			event.preventDefault();
			end();
		};
		window.addEventListener("keydown", onKey);
		return () => {
			unregister();
			window.removeEventListener("keydown", onKey);
		};
	}, [tourActive, end]);

	if (stepIndex === null) return null;
	if (stepIndex >= STEPS.length) return null;
	const step: TourStep = STEPS[stepIndex]!;
	const last = stepIndex === STEPS.length - 1;
	const spot = step.target ? rect : null;

	const cardStyle: React.CSSProperties = {
		...computeCardPosition(spot, TOUR_CARD_WIDTH, TOUR_CARD_HEIGHT),
		width: TOUR_CARD_WIDTH,
		transition:
			"left 240ms cubic-bezier(0.2,0.8,0.2,1), top 240ms cubic-bezier(0.2,0.8,0.2,1)",
	};

	return (
		<div
			role="dialog"
			aria-label="Guided tour"
			className="fixed inset-0"
			style={{ zIndex: 300 }}
		>
			{spot ? (
				<div
					style={{
						position: "fixed",
						left: spot.left - 6,
						top: spot.top - 6,
						width: spot.width + 12,
						height: spot.height + 12,
						borderRadius: 14,
						boxShadow: "0 0 0 4px rgba(79,125,217,0.35), 0 0 0 9999px rgba(6,8,12,0.62)",
						pointerEvents: "none",
						transition: "all 220ms cubic-bezier(0.2,0.8,0.2,1)",
					}}
				/>
			) : (
				<div className="absolute inset-0 bg-pi-bg/70" />
			)}
			<TourCard
				step={step}
				index={stepIndex}
				total={STEPS.length}
				style={cardStyle}
				onNext={() => (last ? end() : next())}
				onBack={() => back()}
				onEnd={() => end()}
			/>
		</div>
	);
}

interface TourCardProps {
	step: TourStep;
	index: number;
	total: number;
	style: React.CSSProperties;
	onNext: () => void;
	onBack: () => void;
	onEnd: () => void;
}

function TourCard({ step, index, total, style, onNext, onBack, onEnd }: TourCardProps): ReactNode {
	const Icon = index === 0 ? Sparkles : Compass;
	const isLast = index === total - 1;
	return (
		<div
			className="absolute rounded-xl border border-pi-border-strong bg-pi-surface-overlay p-4 shadow-2xl"
			style={style}
			onClick={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				onClick={onEnd}
				aria-label="Skip tour"
				className="absolute right-3 top-3 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-pi-text-faint transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
			>
				<X className="h-3.5 w-3.5" />
			</button>
			<div className="flex items-center gap-2 pr-8">
				<Icon className="h-4 w-4 shrink-0 text-pi-accent" />
				<h3 className="text-[13px] font-semibold tracking-tight text-pi-text">{step.title}</h3>
			</div>
			<p className="mt-2 text-xs leading-relaxed text-pi-text-secondary">{step.body}</p>
			{step.points && step.points.length > 0 && (
				<ul className="mt-2.5 space-y-1">
					{step.points.map((point) => (
						<li key={point} className="flex items-start gap-2 text-2xs text-pi-text-muted">
							<span className="mt-1 size-1 shrink-0 rounded-full bg-pi-accent" />
							{point}
						</li>
					))}
				</ul>
			)}
			<div className="mt-3.5 flex items-center justify-between">
				<div className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${total}`}>
					{Array.from({ length: total }, (_, dot) => (
						<span
							key={dot}
							className={cn(
								"h-1 rounded-full transition-all",
								dot === index ? "w-4 bg-pi-accent" : "w-1 bg-pi-border-strong",
							)}
						/>
					))}
				</div>
				<div className="flex items-center gap-2">
					{index > 0 && (
						<button
							type="button"
							onClick={onBack}
							className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						>
							<ArrowLeft className="h-3 w-3" />
							Back
						</button>
					)}
					<button
						type="button"
						onClick={onNext}
						autoFocus
						className="cursor-pointer rounded-md bg-pi-accent px-3 py-1 text-2xs font-medium text-white transition-hover hover:brightness-110"
					>
						{isLast ? "Finish" : "Next"}
					</button>
				</div>
			</div>
		</div>
	);
}
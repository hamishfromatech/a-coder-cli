import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { AudioLines, MicOff, PhoneOff, SkipForward, Volume2 } from "lucide-react";
import { useVoiceCallStore, voiceCall, type VoiceCallPhase } from "../../lib/voice-call";
import { IconButton } from "../ui/Button";
import { Orb, type AgentState } from "../ui/orb";
import { ShimmeringText } from "../ui/shimmering-text";

/** Voice-call panel for the right sidebar's drawer rail, styled after the
 *  ElevenLabs UI voice blocks (github.com/elevenlabs/ui): the orb sits in a
 *  muted circular well, connect states shimmer, controls are rounded pills.
 *  The orb animation is state-driven (thinking / listening / talking). */

const PHASE_LABEL: Record<VoiceCallPhase, string> = {
	connecting: "Connecting…",
	listening: "Listening",
	transcribing: "Transcribing…",
	speaking: "Speaking",
};

const ORB_AGENT_STATE: Record<VoiceCallPhase, AgentState> = {
	connecting: "thinking",
	listening: "listening",
	transcribing: "thinking",
	speaking: "talking",
};

function activityLine(phase: VoiceCallPhase, agentBusy: boolean, muted: boolean): string {
	if (muted) return "Muted — replies play, your mic is parked";
	if (phase === "speaking") return "Tap or press Space to interrupt";
	if (agentBusy) return "Agent is working — keep talking to queue follow-ups";
	if (phase === "connecting") return "Waking the microphone…";
	if (phase === "transcribing") return "Transcribing your words…";
	return "Speak naturally — pauses send your turn";
}

/** The ElevenLabs demo's circular orb well: muted ring + inset shadows. */
function OrbWell({ size, children }: { size: string; children: ReactNode }) {
	return (
		<div
			className={`relative ${size} rounded-full bg-pi-surface-raised p-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_2px_8px_rgba(0,0,0,0.5)]`}
		>
			<div className="h-full w-full overflow-hidden rounded-full bg-pi-surface shadow-[inset_0_0_12px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_0_12px_rgba(0,0,0,0.3)]">
				{children}
			</div>
		</div>
	);
}

function CallCard() {
	const s = useVoiceCallStore();
	const logRef = useRef<HTMLDivElement | null>(null);

	// Keep the call log pinned to the newest entry.
	useEffect(() => {
		const el = logRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [s.transcriptLog.length, s.transcript]);

	const connecting = s.phase === "connecting" || s.phase === "transcribing";

	return (
		<div className="flex flex-col gap-3 p-3">
			<div className="flex flex-col items-center text-center">
				<OrbWell size="h-20 w-20">
					<Suspense fallback={null}>
						<Orb colors={["#5FA8FF", "#8B7BFF"]} agentState={ORB_AGENT_STATE[s.phase]} />
					</Suspense>
				</OrbWell>
				<p className="mt-2 text-sm font-medium leading-none text-pi-text">{PHASE_LABEL[s.phase]}</p>
				<div className="mt-1 flex items-center gap-2">
					{connecting ? (
						<ShimmeringText text={activityLine(s.phase, s.agentBusy, s.muted)} className="text-2xs" />
					) : (
						<p className="text-2xs text-pi-text-muted">{activityLine(s.phase, s.agentBusy, s.muted)}</p>
					)}
				</div>
				<div
					className={`mt-1.5 h-2 w-2 rounded-full transition-all duration-300 ${
						s.muted
							? "bg-pi-text-muted/40"
							: s.phase === "speaking"
								? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
								: "animate-pulse bg-pi-accent"
					}`}
					aria-hidden={true}
				/>
				{s.toolLabel && (
					<p className="mt-1.5 max-w-full truncate rounded bg-pi-surface-raised px-2 py-0.5 text-2xs text-pi-text-muted">
						Tool: <span className="font-mono">{s.toolLabel}</span>
					</p>
				)}
				{s.error && (
					<p className="mt-1 max-w-full truncate text-2xs text-pi-danger" title={s.error}>
						{s.error}
					</p>
				)}
			</div>

			{s.transcript && s.phase !== "speaking" && (
				<p className="min-h-9 rounded-lg bg-pi-surface-raised px-2.5 py-2 text-left text-2xs leading-4 text-pi-text">
					{s.transcript}
				</p>
			)}

			{s.transcriptLog.length > 0 && (
				<div
					ref={logRef}
					className="max-h-56 min-h-12 overflow-y-auto overscroll-contain rounded-lg border border-pi-border bg-pi-surface-raised px-2.5 py-2"
					aria-label="Voice call log"
				>
					<ul className="flex flex-col gap-1.5 text-2xs leading-4">
						{s.transcriptLog.map((line, i) => (
							<li key={i} className={line.startsWith("You:") ? "text-pi-text" : "text-pi-text-muted"}>
								{line}
							</li>
						))}
					</ul>
				</div>
			)}

			{s.spokenTotal > 0 && (
				<div className="flex items-center justify-center gap-1.5">
					{Array.from({ length: s.spokenTotal }, (_, i) => (
						<span
							key={i}
							className={
								i < s.spokenIndex
									? "h-1 w-4 rounded-full bg-pi-text-muted/60"
									: i === s.spokenIndex
										? "h-1 w-4 rounded-full bg-pi-text"
										: "h-1 w-4 rounded-full bg-pi-border"
							}
						/>
					))}
				</div>
			)}

			<div className="flex items-center justify-center gap-1.5">
				<IconButton
					variant="ghost"
					size="md"
					icon={s.muted ? Volume2 : MicOff}
					onClick={() => voiceCall.toggleMute()}
					aria-label={s.muted ? "Unmute mic" : "Mute mic"}
					title={s.muted ? "Resume voice turns" : "Mute mic (replies still play)"}
					className="!rounded-full"
				/>
				<IconButton
					variant="ghost"
					size="md"
					icon={SkipForward}
					onClick={() => voiceCall.skipSentence()}
					aria-label="Skip sentence"
					title="Skip the sentence being spoken"
					className="!rounded-full"
				/>
				<IconButton
					variant="ghost"
					size="md"
					icon={PhoneOff}
					onClick={() => void voiceCall.stop()}
					aria-label="End voice call"
					title="End the call (Esc)"
					className="!rounded-full !bg-rose-500/85 !text-white hover:!bg-rose-500"
				/>
			</div>
		</div>
	);
}

/** Rail panel body: the active call, or the ElevenLabs-style empty state. */
export function VoicePanel() {
	const active = useVoiceCallStore((s) => s.active);

	return active ? (
		<CallCard />
	) : (
		<div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
			<OrbWell size="h-20 w-20">
				<Suspense fallback={null}>
					<Orb colors={["#5FA8FF", "#8B7BFF"]} agentState={null} />
				</Suspense>
			</OrbWell>
			<div className="space-y-1">
				<h3 className="text-sm font-medium text-pi-text">Start a conversation</h3>
				<ShimmeringText text="Speak, pause, it sends — replies answer out loud" className="text-2xs" />
			</div>
			<button
				type="button"
				onClick={() => void voiceCall.start()}
				aria-label="Start voice call"
				title="Start the call (takes over the session while active; Esc hangs up)"
				className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-pi-accent/40 bg-pi-accent/10 px-4 text-xs font-medium text-pi-text transition-hover hover:bg-pi-accent/20 active-press"
			>
				<AudioLines className="h-4 w-4 text-pi-accent" />
				Start call
			</button>
			<p className="max-w-56 text-2xs leading-4 text-pi-text-faint">
				Half-duplex by default — the mic parks while a reply speaks; Space/Esc takes the floor back.
				Tuning: Settings → Voice → Call mode.
			</p>
		</div>
	);
}
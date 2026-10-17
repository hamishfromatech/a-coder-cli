import { useEffect, useRef } from "react";
import { Suspense } from "react";
import { MicOff, Phone, PhoneOff, SkipForward, Volume2 } from "lucide-react";
import { useVoiceCallStore, voiceCall, type VoiceCallPhase } from "../../lib/voice-call";
import { IconButton } from "../ui/Button";
import { Orb, type AgentState } from "../ui/orb";

/** Voice-call panel for the right sidebar's drawer rail — the call card lives
 *  here instead of a full-screen overlay, next to the panels it plays over.
 *  The orb is the ElevenLabs UI component (three.js shader); its state-driven
 *  animation follows the call phase (thinking/listening/talking). */

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

function CallCard() {
	const s = useVoiceCallStore();
	const logRef = useRef<HTMLDivElement>(null);

	// Keep the call log pinned to the newest entry.
	useEffect(() => {
		const el = logRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [s.transcriptLog.length, s.transcript]);

	const phaseLabel = PHASE_LABEL[s.phase];

	return (
		<div className="flex flex-col gap-3 p-3">
			<div className="flex flex-col items-center text-center">
				<div className="h-24 w-24">
					<Suspense fallback={null}>
						<Orb
							colors={["#5FA8FF", "#8B7BFF"]}
							agentState={ORB_AGENT_STATE[s.phase]}
						/>
					</Suspense>
				</div>
				<p className="mt-1 text-xs font-semibold text-pi-text">
					{phaseLabel}
					{s.agentBusy && s.phase !== "speaking" ? " (agent working)" : ""}
				</p>
				<p className="mt-0.5 text-2xs text-pi-text-muted">
					{activityLine(s.phase, s.agentBusy, s.muted)}
				</p>
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

			<div className="flex items-center justify-center gap-2">
				<IconButton
					variant="ghost"
					size="sm"
					icon={s.muted ? Volume2 : MicOff}
					onClick={() => voiceCall.toggleMute()}
					aria-label={s.muted ? "Unmute mic" : "Mute mic"}
					title={s.muted ? "Resume voice turns" : "Mute mic (replies still play)"}
				/>
				<IconButton
					variant="ghost"
					size="sm"
					icon={SkipForward}
					onClick={() => voiceCall.skipSentence()}
					aria-label="Skip sentence"
					title="Skip the sentence being spoken"
				/>
				<IconButton
					variant="ghost"
					size="sm"
					icon={PhoneOff}
					onClick={() => void voiceCall.stop()}
					aria-label="End voice call"
					title="End the call (Esc)"
					className="!bg-rose-500/85 !text-white hover:!bg-rose-500"
				/>
			</div>
		</div>
	);
}

/** Rail panel body: the active call, or the start screen when idle. */
export function VoicePanel() {
	const active = useVoiceCallStore((s) => s.active);

	return active ? (
		<CallCard />
	) : (
		<div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
			<div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-sky-400/60 to-indigo-500/60">
				<Phone className="h-6 w-6 text-white" />
			</div>
			<div>
				<p className="text-xs font-semibold text-pi-text">Voice call</p>
				<p className="mt-1 text-2xs leading-4 text-pi-text-muted">
					Talk over this session: speak, your words send as messages, replies answer out loud like a
					phone call. Turn-taking is half-duplex — the mic parks while a reply speaks; Space/Esc takes
					the floor back. Esc also hangs up.
				</p>
			</div>
			<IconButton
				variant="primary"
				size="md"
				icon={Phone}
				onClick={() => void voiceCall.start()}
				aria-label="Start voice call"
				title="Start the call (uses Settings → Voice servers)"
			>
				Start call
			</IconButton>
			<p className="text-2xs text-pi-text-faint">
				Tuning: Settings → Voice → Call mode (silence, barge-in, cues).
			</p>
		</div>
	);
}
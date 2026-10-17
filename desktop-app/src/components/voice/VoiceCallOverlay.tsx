import { Loader2, MicOff, SkipForward, Volume2, PhoneOff } from "lucide-react";
import { useVoiceCallStore, type VoiceCallPhase } from "../../lib/voice-call";
import { voiceCall } from "../../lib/voice-call";
import { IconButton } from "../ui/Button";

/**
 * Full-screen voice-call surface. The scrim is pointer-events-none so the
 * session underneath (approval bars, composer) stays clickable; the call card
 * carries its own controls.
 */

const PHASE_LABEL: Record<VoiceCallPhase, string> = {
	connecting: "Connecting…",
	listening: "Listening",
	transcribing: "Transcribing…",
	speaking: "Speaking",
};

function activityLine(
	phase: VoiceCallPhase,
	agentBusy: boolean,
	muted: boolean,
): string {
	if (muted) return "Muted — replies play, your mic is parked";
	if (phase === "speaking") return "Tap or press Space to interrupt";
	if (agentBusy) return "Agent is working — keep talking to queue follow-ups";
	if (phase === "connecting") return "Waking the microphone…";
	if (phase === "transcribing") return "Transcribing your words…";
	return "Speak naturally — pauses send your turn";
}

export function VoiceCallOverlay() {
	const s = useVoiceCallStore();
	if (!s.active) {
		// Fade-out flash: brief goodbye card after hangs up.
		return null;
	}
	const phaseLabel = PHASE_LABEL[s.phase];
	// The orb breathes with the mic while listening, pulses while speaking.
	const orbScale = s.phase === "listening" || s.phase === "connecting" ? 1 + s.level * 0.55 : 1;

	return (
		<div className="fixed inset-0 z-[80]">
			{/* Scrim: click-through so approvals/composer remain interactive. */}
			<div className="pointer-events-none absolute inset-0 bg-[rgba(10,10,14,0.45)] backdrop-blur-[2px]" />
			{/* Call card */}
			<div className="absolute left-1/2 top-16 -translate-x-1/2">
				<div className="pointer-events-auto w-[380px] rounded-2xl border border-white/10 bg-[#14141a]/95 p-5 text-center shadow-2xl">
					{/* Orb */}
					<div className="relative mx-auto flex h-24 items-center justify-center">
						<div
							className="absolute h-24 w-24 rounded-full bg-gradient-to-br from-sky-400/70 to-indigo-500/70 blur-[1px]"
							style={{
								transform: `scale(${orbScale})`,
								opacity: s.muted ? 0.25 : 0.75,
								transition: "opacity 200ms ease",
							}}
						/>
						<div className="absolute h-16 w-16 rounded-full bg-gradient-to-br from-sky-200 to-indigo-300 opacity-90" />
						{s.phase === "connecting" || s.phase === "transcribing" ? (
							<Loader2 className="relative h-6 w-6 animate-spin text-[#14141a]" />
						) : s.muted ? (
							<MicOff className="relative h-6 w-6 text-[#14141a]" />
						) : (
							<Volume2 className="relative h-6 w-6 text-[#14141a]" />
						)}
					</div>

					<p className="mt-2 text-sm font-semibold text-white">
						{phaseLabel}
						{s.agentBusy && s.phase !== "speaking" ? " (agent working)" : ""}
					</p>
					<p className="mt-0.5 text-2xs text-white/55">{activityLine(s.phase, s.agentBusy, s.muted)}</p>

					{s.toolLabel && (
						<p className="mt-2 truncate rounded-md bg-white/8 px-2 py-1 text-2xs text-white/70">
							Tool: <span className="font-mono">{s.toolLabel}</span>
						</p>
					)}
					{s.error && (
						<p className="mt-1 truncate text-2xs text-rose-300" title={s.error}>
							{s.error}
						</p>
					)}

					{s.transcript && s.phase !== "speaking" && (
						<p className="mt-3 line-clamp-3 min-h-8 rounded-lg bg-white/6 px-3 py-2 text-left text-2xs text-white/80">
							{s.transcript}
						</p>
					)}

					{s.spokenTotal > 0 && (
						<div className="mt-3 flex items-center justify-center gap-1.5">
							{Array.from({ length: s.spokenTotal }, (_, i) => (
								<span
									key={i}
									className={
										i < s.spokenIndex
											? "h-1 w-4 rounded-full bg-white/50"
											: i === s.spokenIndex
												? "h-1 w-4 rounded-full bg-white"
												: "h-1 w-4 rounded-full bg-white/20"
									}
								/>
							))}
						</div>
					)}

					<div className="mt-4 flex items-center justify-center gap-2">
						<IconButton
							variant="ghost"
							size="sm"
							icon={s.muted ? Volume2 : MicOff}
							onClick={() => voiceCall.toggleMute()}
							aria-label={s.muted ? "Unmute mic" : "Mute mic"}
							title={s.muted ? "Resume voice turns" : "Mute mic (replies still play)"}
							className="!text-white/70 hover:!text-white"
						/>
						<IconButton
							variant="ghost"
							size="sm"
							icon={SkipForward}
							onClick={() => voiceCall.skipSentence()}
							aria-label="Skip sentence"
							title="Skip the sentence being spoken"
							className="!text-white/70 hover:!text-white"
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
			</div>
		</div>
	);
}
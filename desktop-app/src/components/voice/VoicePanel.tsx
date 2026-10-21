import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import {
	AppWindow,
	AudioLines,
	Loader2,
	Mic,
	MicOff,
	Monitor,
	PhoneOff,
	RefreshCw,
	ScreenShare,
	ScreenShareOff,
	SkipForward,
	Volume2,
} from "lucide-react";
import { useVoiceCallStore, voiceCall, setMicDeviceId, type VoiceCallPhase } from "../../lib/voice-call";
import { screenShare, useScreenShareStore, type ScreenSource } from "../../lib/screen-share";
import { useSessionStore } from "../../stores/session-store";
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


/** Screen share for the active call: pick a display/window, show a live
 *  preview, and stop cleanly with the call. Only changed frames are attached
 *  to voice turns, so this is not a video stream. */
function ScreenShareControl() {
	const s = useScreenShareStore();
	const [pickerOpen, setPickerOpen] = useState(false);
	const [picking, setPicking] = useState(false);
	const [localError, setLocalError] = useState("");
	const [requesting, setRequesting] = useState(false);
	const canSeeImages = useSessionStore((s) => s.model?.input?.includes("image") ?? true);

	const openPicker = async () => {
		setPickerOpen(true);
		setPicking(true);
		setLocalError("");
		try {
			const result = await screenShare.listSources();
			if (!result.sources.length) {
				setLocalError("No shareable displays or windows found.");
			}
		} catch (e) {
			setLocalError(e instanceof Error ? e.message : String(e));
		} finally {
			setPicking(false);
		}
	};

	const requestAccess = async () => {
		setRequesting(true);
		setLocalError("");
		try {
			const granted = await screenShare.requestPermission();
			if (!granted) {
				setLocalError(
					"Enable A-Coder Desktop in System Settings → Privacy & Security → Screen Recording, then restart the app.",
				);
			}
		} finally {
			setRequesting(false);
		}
	};

	const start = async (source: ScreenSource) => {
		const started = await screenShare.start(source.id);
		if (started) setPickerOpen(false);
	};

	const displays = s.sources.filter((source) => source.kind === "display");
	const windows = s.sources.filter((source) => source.kind === "window");

	if (s.active) {
		return (
			<div className="rounded-lg border border-pi-border bg-pi-surface-raised p-2">
				<div className="flex items-center justify-between gap-2">
					<div className="flex min-w-0 items-center gap-1.5">
						<ScreenShare className="h-3.5 w-3.5 shrink-0 text-pi-accent" />
						<div className="min-w-0">
							<p className="text-2xs font-medium leading-4 text-pi-text">Sharing screen</p>
							<p className="truncate text-3xs leading-3 text-pi-text-faint" title={s.sourceName}>
								{s.sourceName || "Selected source"}
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => void screenShare.stop()}
						className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-pi-border px-2 text-3xs text-pi-text-muted transition-hover hover:border-rose-400/50 hover:text-rose-400"
						aria-label="Stop sharing screen"
					>
						<ScreenShareOff className="h-3 w-3" />
						Stop
					</button>
				</div>
				{s.preview ? (
					<img
						src={s.preview}
						alt="Shared screen preview"
						className="mt-2 max-h-40 w-full rounded-md border border-pi-border object-contain"
					/>
				) : (
					<div className="mt-2 flex h-20 items-center justify-center rounded-md border border-dashed border-pi-border text-3xs text-pi-text-faint">
						<Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
						Waiting for the first frame…
					</div>
				)}
				<p className="mt-1.5 text-3xs leading-3 text-pi-text-faint">
					Only changed frames are attached to voice turns — the model gets a still, not a video. Frames go to your current model provider.
				</p>
				{!canSeeImages && (
					<p className="mt-1 text-3xs leading-3 text-amber-500">
						This model is text-only. Switch to a vision-capable model to attach frames.
					</p>
				)}
				{s.error && (
					<p className="mt-1 text-3xs leading-3 text-pi-danger" title={s.error}>
						{s.error}
					</p>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<button
				type="button"
				onClick={() => void openPicker()}
				className="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-pi-border bg-pi-surface-raised text-2xs text-pi-text transition-hover hover:border-pi-text-muted/40"
			>
				<ScreenShare className="h-3.5 w-3.5 text-pi-text-muted" />
				Share screen
			</button>

			{s.error && !pickerOpen && (
				<p className="text-3xs leading-4 text-pi-danger" title={s.error}>
					{s.error}
				</p>
			)}

			{pickerOpen && (
				<div className="rounded-lg border border-pi-border bg-pi-surface-raised p-2">
					<div className="mb-1.5 flex items-center justify-between gap-2">
						<p className="text-2xs font-medium text-pi-text">Share a display or window</p>
						<button
							type="button"
							onClick={() => void openPicker()}
							disabled={picking}
							className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-pi-text-faint transition-hover hover:bg-pi-surface hover:text-pi-text disabled:opacity-50"
							aria-label="Refresh screen sources"
							title="Refresh screen sources"
						>
							<RefreshCw className={`h-3 w-3 ${picking ? "animate-spin" : ""}`} />
						</button>
					</div>

					{s.permission === false && (
						<div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
							<p className="text-3xs leading-4 text-pi-text">
								Screen Recording access is off. Enable it, then restart the app.
							</p>
							<button
								type="button"
								onClick={() => void requestAccess()}
								disabled={requesting}
								className="mt-1.5 flex h-6 cursor-pointer items-center gap-1 rounded-full bg-pi-surface px-2 text-3xs text-pi-text transition-hover hover:bg-pi-surface-raised disabled:opacity-50"
							>
								{requesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Monitor className="h-3 w-3" />}
								Request access
							</button>
						</div>
					)}

					{(localError || s.error) && (
						<p className="mb-2 text-3xs leading-4 text-pi-danger">{localError || s.error}</p>
					)}

					{picking ? (
						<p className="flex items-center gap-1.5 py-2 text-3xs text-pi-text-faint">
							<Loader2 className="h-3 w-3 animate-spin" />
							Looking for screens…
						</p>
					) : s.sources.length === 0 ? (
						<p className="py-2 text-3xs leading-4 text-pi-text-faint">
							No shareable screens found. Try refreshing, or grant Screen Recording access first.
						</p>
					) : (
						<div className="max-h-48 space-y-2 overflow-y-auto overscroll-contain">
							{displays.length > 0 && (
								<div className="space-y-0.5">
									<p className="px-1 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Displays</p>
									{displays.map((source) => (
										<SourceButton key={source.id} source={source} onPick={start} disabled={s.busy || s.permission === false} />
									))}
								</div>
							)}
							{windows.length > 0 && (
								<div className="space-y-0.5">
									<p className="px-1 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Windows</p>
									{windows.map((source) => (
										<SourceButton key={source.id} source={source} onPick={start} disabled={s.busy || s.permission === false} />
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function SourceButton({
	source,
	onPick,
	disabled,
}: {
	source: ScreenSource;
	onPick: (source: ScreenSource) => Promise<void>;
	disabled: boolean;
}) {
	const Icon = source.kind === "display" ? Monitor : AppWindow;
	return (
		<button
			type="button"
			onClick={() => void onPick(source)}
			disabled={disabled}
			className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-hover hover:bg-pi-surface disabled:opacity-50"
		>
			<Icon className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-2xs text-pi-text">{source.name}</span>
				<span className="block truncate text-3xs text-pi-text-faint">
					{source.kind === "window" && source.appName ? `${source.appName} · ` : ""}
					{source.width}×{source.height}
					{source.primary ? " · primary" : ""}
				</span>
			</span>
		</button>
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
						<Orb
							colors={["#5FA8FF", "#8B7BFF"]}
							agentState={ORB_AGENT_STATE[s.phase]}
							volumeMode="manual"
							getInputVolume={() => {
								const state = useVoiceCallStore.getState();
								return state.phase === "listening" ? state.level : 0;
							}}
							getOutputVolume={() => {
								const state = useVoiceCallStore.getState();
								return state.phase === "speaking" ? state.level : 0;
							}}
						/>
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

			<ScreenShareControl />

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

/** Microphone selector (device list from enumerateDevices, persisted so
 *  calls and composer dictation both honor the pick). Labels are empty
 *  until mic permission is granted once — the hint covers that. */
function MicPicker() {
	const micDeviceId = useVoiceCallStore((s) => s.micDeviceId);
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const [labelsHidden, setLabelsHidden] = useState(false);

	useEffect(() => {
		const load = () => {
			void navigator.mediaDevices
				?.enumerateDevices()
				.then((all) => {
					const inputs = all.filter((d) => d.kind === "audioinput");
					setDevices(inputs);
					setLabelsHidden(inputs.length > 0 && inputs.every((d) => !d.label));
				})
				.catch(() => undefined);
		};
		void load();
		const media = navigator.mediaDevices;
		media?.addEventListener?.("devicechange", load);
		return () => media?.removeEventListener?.("devicechange", load);
	}, []);

	return (
		<div className="flex max-w-64 flex-col items-center gap-1">
			<div className="flex h-8 w-full items-center gap-1.5 rounded-full border border-pi-border bg-pi-surface-raised pl-2.5 pr-1 transition-hover hover:border-pi-text-muted/40">
				<Mic className="h-3 w-3 shrink-0 text-pi-text-faint" />
				<select
					value={micDeviceId ?? ""}
					onChange={(event) => setMicDeviceId(event.target.value || null)}
					aria-label="Microphone"
					title="Microphone used by voice calls and dictation"
					className="h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-2xs text-pi-text focus:outline-none"
				>
					<option value="">System default</option>
					{devices.map((device, i) => (
						<option key={device.deviceId || i} value={device.deviceId}>
							{device.label || `Microphone ${i + 1}`}
						</option>
					))}
				</select>
			</div>
			{labelsHidden && (
				<p className="text-2xs text-pi-text-faint">Device names appear after the mic is allowed once.</p>
			)}
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
			<MicPicker />
			<p className="max-w-56 text-2xs leading-4 text-pi-text-faint">
				Half-duplex by default — the mic parks while a reply speaks; Space/Esc takes the floor back.
				Tuning: Settings → Voice → Call mode.
			</p>
		</div>
	);
}
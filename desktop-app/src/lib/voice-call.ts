/**
 * Voice call mode: a hands-free, voice-operated loop wrapped around the active
 * session — mic → STT → send → agent run → TTS reply → mic again, until the
 * user ends the call. One button to enter, one to leave.
 *
 * Turn-taking without a manual stop press is a plain RMS gate on the mic
 * stream (Web Audio AnalyserNode): an utterance is confirmed after a short
 * burst above the open threshold and ends after `voiceCallSilenceMs` of quiet
 * below it (or a hard utterance cap). No ML VAD — STT/TTS live on the user's
 * local OpenAI-compatible servers, everything else is signal math.
 *
 * Call audio cues reuse the synthesized completion-sound bank
 * (lib/completion-sound.ts): connected / tool tick / thinking / hang-up.
 * During a call the turn-end completion chime is suppressed — the spoken
 * reply is the "turn ended" signal.
 *
 * Interruption model (half-duplex by default): while the reply is speaking,
 * the recorder turn is parked; Space/Escape/card buttons stop playback and
 * reopen the mic immediately. With `voiceBargeIn` on, the mic meter stays
 * armed while speaking and a sustained loud burst auto-barges. Audio captured
 * during TTS is always discarded (speaker echo would poison the next
 * transcription), so after a barge the user speaks fresh.
 */

import * as rpc from "./rpc";
import { playCueVariant } from "./completion-sound";
import { assetPath } from "./asset-path";
import { useSessionStore } from "../stores/session-store";
import { useSettingsStore } from "../stores/settings-store";
import { speechify } from "./speech-text";
import { toast } from "../stores/toast-store";
import {
	MIC_DEVICE_STORAGE_KEY,
	micAudioConstraints,
	splitForSpeech,
	startAudioMeter,
	synthesize,
	stopAudio,
	transcribe,
	type MicRecorder,
	type VoiceSettings,
} from "./voice";
import { huddleCall } from "./huddle-call";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// The phone-call style system prompt: composed onto the engine's system prompt
// while a call is live, cleared when it ends.
// ---------------------------------------------------------------------------

export const VOICE_CALL_ADDENDUM = [
	"You are on a live voice call. The user is speaking; their turns arrive as transcribed speech.",
	"Respond conversationally, like a natural phone call:",
	"- Short, spoken-first answers — 1 to 3 sentences unless asked for more; lead with the answer.",
	"- No markdown, lists, code fences, headings, or emoji; write anything you would say out loud.",
	"- Numbers, paths and identifiers: say them in words a listener can follow, then follow up in text if asked.",
	"- You may still perform coding work; describe what you did in words and keep long output in the text session, not in your spoken reply.",
	"- If the request is ambiguous, ask one short clarifying question instead of guessing.",
].join("\n");

// ---------------------------------------------------------------------------
// Cue variants into the completion-sound bank.
// ---------------------------------------------------------------------------

const CUE_CALL_CONNECTED = 7; // Systems online
const CUE_CALL_HANGUP = 5; // Airy whoosh
const CUE_TOOL_CALL = 4; // Tri-tone message (short, quiet)
const CUE_THINKING = 2; // Glass ping
const TOOL_CUE_VOLUME = 0.5;
const THINKING_CUE_VOLUME = 0.4;

// ---------------------------------------------------------------------------
// Tuning constants (deliberately not settings — they are signal constants).
// ---------------------------------------------------------------------------

/** RMS level the mic must hold before an utterance is considered begun. */
const OPEN_THRESHOLD = 0.05;
/** RMS level (higher than open) that arms + fires an open-mic barge. */
const BARGE_THRESHOLD = 0.09;
/** Sustained loud time before a barge fires (ms) — rejects clicks/thuds. */
const BARGE_HOLD_MS = 300;
/** Speech must be confirmed this long before endpointing is active (ms). */
const SPEECH_CONFIRM_MS = 250;
/** Quiet/dead-air grace after a barge or TTS before the mic reopens (ms). */
const BARGE_SETTLE_MS = 600;
/** Meter + endpoint state-machine poll interval (ms). */
const METER_INTERVAL_MS = 50;
/** Level smoothing factor for the store value (EMA). */
const LEVEL_SMOOTHING = 0.3;

export const DEFAULT_VOICE_CALL_SILENCE_MS = 1200;
export const DEFAULT_VOICE_CALL_MAX_UTTERANCE_MS = 15000;
export const DEFAULT_VOICE_MAX_SPOKEN_CHARS = 1200;

// ---------------------------------------------------------------------------
// Call state store (the controller is the only writer).
// ---------------------------------------------------------------------------

export type VoiceCallPhase = "connecting" | "listening" | "transcribing" | "speaking";

interface VoiceCallState {
	active: boolean;
	phase: VoiceCallPhase;
	/** Smoothed mic level 0..1 for the orb. */
	level: number;
	/** Last finished transcription (panel ticker). */
	transcript: string;
	/** Call log: user turns + agent replies, newest last. Capped; runtime only. */
	transcriptLog: string[];
	/** True while an agent run is in flight (thinking chip). */
	agentBusy: boolean;
	/** Name of the most recent tool call, for the activity chip. */
	toolLabel: string;
	/** Index/total within the reply currently being spoken (1-based index on screen). */
	spokenIndex: number;
	spokenTotal: number;
	error: string;
	muted: boolean;
	/** Picked microphone (device id); null = system default. Persisted, so
	 *  calls and the composer dictation recorder both honor it. */
	micDeviceId: string | null;
}

export const useVoiceCallStore = create<VoiceCallState>()(() => ({
	active: false,
	phase: "listening",
	level: 0,
	transcript: "",
	transcriptLog: [],
	agentBusy: false,
	toolLabel: "",
	spokenIndex: 0,
	spokenTotal: 0,
	error: "",
	muted: false,
	micDeviceId: readStoredMicDeviceId(),
}));

function readStoredMicDeviceId(): string | null {
	try {
		return localStorage.getItem(MIC_DEVICE_STORAGE_KEY);
	} catch {
		return null;
	}
}

/** Pick the call (and dictation) microphone; persists for future calls. */
export function setMicDeviceId(id: string | null): void {
	try {
		if (id) localStorage.setItem(MIC_DEVICE_STORAGE_KEY, id);
		else localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
	} catch {
		// Storage disabled: session-only pick.
	}
	useVoiceCallStore.setState({ micDeviceId: id });
}

function setCall(patch: Partial<VoiceCallState>): void {
	useVoiceCallStore.setState(patch);
}

const MAX_LOG = 40;
function pushCallLog(line: string): void {
	const trimmed = line.trim();
	if (!trimmed) return;
	const log = useVoiceCallStore.getState().transcriptLog;
	setCall({ transcriptLog: [...log, trimmed].slice(-MAX_LOG) });
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function voiceSettingsFromStore(): VoiceSettings {
	const s = useSettingsStore.getState();
	return {
		voiceSttBaseUrl: s.voiceSttBaseUrl,
		voiceSttApiKey: s.voiceSttApiKey,
		voiceSttModel: s.voiceSttModel,
		voiceTtsBaseUrl: s.voiceTtsBaseUrl,
		voiceTtsApiKey: s.voiceTtsApiKey,
		voiceTtsModel: s.voiceTtsModel,
		voiceTtsVoice: s.voiceTtsVoice,
	};
}

/** Truncate a long reply for speaking, marking the elision with "…" */
function capForSpeech(text: string, maxChars: number): string {
	if (maxChars <= 0 || text.length <= maxChars) return text;
	const cut = text.lastIndexOf(" ", maxChars);
	return `${text.slice(0, cut > 0 ? cut : maxChars).trimEnd()} …`;
}

// ---------------------------------------------------------------------------
// Speech queue: fetch sentence N+1 while playing N, ordered playback.
// ---------------------------------------------------------------------------

class SpeechQueue {
	private stopped = false;
	private skippingCurrent = false;
	private current: HTMLAudioElement | null = null;

	constructor(
		private readonly sentences: string[],
		private readonly settings: VoiceSettings,
		private readonly onIndex: (index: number) => void,
	) {}

	/** Abort the whole queue. */
	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		if (this.current) {
			this.current.pause();
			this.current = null;
		}
	}

	/** Stop only the sentence currently playing; the queue keeps going. */
	skipCurrent(): void {
		if (this.stopped) return;
		this.skippingCurrent = true;
		if (this.current) {
			this.current.pause();
			this.current = null;
		}
	}

	/** Play every sentence in order; resolves "done" or "stopped". */
	async run(): Promise<"done" | "stopped"> {
		let prefetch: Promise<Blob> | null = null;
		try {
			for (let i = 0; i < this.sentences.length; i += 1) {
				if (this.stopped) return "stopped";
				this.onIndex(i);
				if (!prefetch) prefetch = this.synthesizeSentence(i);
				const blobPromise = prefetch;
				// Start the next fetch while this sentence's audio resolves below.
				prefetch = i + 1 < this.sentences.length ? this.synthesizeSentence(i + 1) : null;
				const blob = await blobPromise;
				if (this.stopped) return "stopped";
				const finished = await this.playBlob(blob);
				if (this.stopped) return "stopped";
				if (!finished && !this.skippingCurrent) return "done"; // playback error
				this.skippingCurrent = false;
			}
			return "done";
		} catch (e) {
			if (!this.stopped) {
				// TTS failed mid-answer: degrade to text-only for this turn.
				console.warn("[voice-call] TTS failed", e);
			}
			return "done";
		}
	}

	private synthesizeSentence(i: number): Promise<Blob> {
		return synthesize(this.sentences[i], this.settings);
	}

	/** Await playback end. Resolves false when stopped/skipped/errored. */
	private playBlob(blob: Blob): Promise<boolean> {
		return new Promise((resolve) => {
			if (this.stopped || this.skippingCurrent) {
				resolve(false);
				return;
			}
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			this.current = audio;
			// Drive the orb with the reply you can actually hear.
			const stopMeter = startAudioMeter(audio, (level) => {
				if (useVoiceCallStore.getState().phase === "speaking") setCall({ level });
			});
			const finish = (played: boolean) => {
				stopMeter();
				URL.revokeObjectURL(url);
				if (this.current === audio) this.current = null;
				resolve(played);
			};
			audio.addEventListener("ended", () => finish(true));
			audio.addEventListener("error", () => finish(false));
			void audio.play().catch(() => finish(false));
		});
	}
}

// ---------------------------------------------------------------------------
// The controller.
// ---------------------------------------------------------------------------

class VoiceCallController {
	private stream: MediaStream | null = null;
	private recorder: MicRecorder | null = null;
	private ctx: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private meterTimer: number | null = null;
	/** The user's mp3 thinking cue, playing while the model starts up. */
	private thinkingAudio: HTMLAudioElement | null = null;
	/** True while speech is confirmed in the current listening turn. */
	private utteranceActive = false;
	/** Last meter tick that was loud, 0 before a confirmed utterance. */
	private lastLoudAt = 0;
	private utteranceStartAt = 0;
	/** Drop the captured turn (echo from TTS / barge / mute boundary). */
	private discardTurn = false;
	/** Meters stay inert until this instant (post-barge/post-TTS settle). */
	private bargeSettleUntil = 0;
	/** Speech playback while a reply is voiced. */
	private speechQueue: SpeechQueue | null = null;
	/** How long the mic has been loud during an armed barge attempt. */
	private bargeLoudSince = 0;
	private lastToolCallId = "";

	/** Whether a call is live (read by App.tsx to gate its chime). */
	get active(): boolean {
		return useVoiceCallStore.getState().active;
	}

	// ---- lifecycle ----------------------------------------------------------

	async start(): Promise<void> {
		if (this.active) return;
		// One microphone, one call: a huddle call yields to the 1:1 call.
		if (huddleCall.active) await huddleCall.stop();
		const s = useSettingsStore.getState();
		if (!s.voiceSttBaseUrl.trim() || !s.voiceTtsBaseUrl.trim()) {
			toast.warning(
				"Speech endpoints not configured",
				"Set your STT and TTS base URLs under Settings → Voice, then start a call.",
			);
			return;
		}
		setCall({
			active: true,
			phase: "connecting",
			level: 0,
			transcript: "",
			agentBusy: useSessionStore.getState().isStreaming,
			toolLabel: "",
			spokenIndex: 0,
			spokenTotal: 0,
			error: "",
			muted: false,
		});
		try {
			await this.openMic();
			this.lastToolCallId = "";
			// Phone-call conversation style while the call is live.
			await rpc.setSystemPromptAddendum(VOICE_CALL_ADDENDUM).catch(() => undefined);
			if (s.voiceCallCues) {
				playCueVariant(CUE_CALL_CONNECTED);
			}
			await this.enterListening();
		} catch (e) {
			this.teardownMic();
			setCall({
				active: false,
				phase: "listening",
				level: 0,
				agentBusy: false,
				toolLabel: "",
				spokenIndex: 0,
				spokenTotal: 0,
				error: e instanceof Error ? e.message : String(e),
			});
			toast.error("Voice call failed", e instanceof Error ? e.message : String(e));
		}
	}

	async stop(): Promise<void> {
		if (!this.active) return;
		this.abortSpeech();
		this.teardownMic();
		// The transient addendum only belongs to this call.
		await rpc.setSystemPromptAddendum(null).catch(() => undefined);
		if (useSettingsStore.getState().voiceCallCues) {
			playCueVariant(CUE_CALL_HANGUP);
		}
		setCall({
			active: false,
			phase: "listening",
			level: 0,
			agentBusy: false,
			toolLabel: "",
			spokenIndex: 0,
			spokenTotal: 0,
			muted: false,
		});
	}

	// ---- mic ---------------------------------------------------------------
	// One getUserMedia stream lives for the whole call; each turn gets a fresh
	// MediaRecorder so chunks stay aligned with turn state, and the analyser
	// taps the same track so level metering keeps flowing while parked.

	private async openMic(): Promise<void> {
		if (this.stream) return;
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: micAudioConstraints() });
		try {
			this.ctx = new AudioContext();
			// The call starts from a button click — a gesture — so resuming here
			// satisfies WKWebView's autoplay policy.
			if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => undefined);
			const source = this.ctx.createMediaStreamSource(this.stream);
			const analyser = this.ctx.createAnalyser();
			analyser.fftSize = 512;
			source.connect(analyser); // deliberately not to destination: no feedback
			this.analyser = analyser;
		} catch (e) {
			// Meter unavailable; the manual stop path (end buttons) still works.
			console.warn("[voice-call] analyser unavailable", e);
			this.ctx = null;
			this.analyser = null;
		}
	}

	private teardownMic(): void {
		if (this.meterTimer !== null) {
			clearInterval(this.meterTimer);
			this.meterTimer = null;
		}
		this.analyser = null;
		if (this.ctx) {
			void this.ctx.close().catch(() => undefined);
			this.ctx = null;
		}
		if (this.recorder) {
			this.recorder.cancel();
			this.recorder = null;
		}
		if (this.stream) {
			this.stream.getTracks().forEach((t) => t.stop());
			this.stream = null;
		}
	}

	/** Start a fresh listening turn: recorder + endpoint timers. */
	private async enterListening(): Promise<void> {
		if (!this.active) return;
		if (this.speechQueue) {
			// A reply is being voiced; this turn stays parked until it finishes
			// (speakDone re-enters). Never open the mic over the TTS output.
			setCall({ phase: "speaking" });
			return;
		}
		this.maybeStartMeter();
		if (useVoiceCallStore.getState().muted) {
			this.utteranceActive = false;
			setCall({ phase: "listening" });
			return;
		}
		if (!this.recorder) {
			try {
				this.recorder = await createMicRecorderFromStream(this.stream);
				await this.recorder.start();
			} catch (e) {
				setCall({ error: e instanceof Error ? e.message : String(e) });
				void this.stop();
				return;
			}
		}
		this.utteranceActive = false;
		this.lastLoudAt = 0;
		this.utteranceStartAt = 0;
		this.bargeLoudSince = 0;
		this.discardTurn = true; // held until the settle grace passes (see onLevel)
		setCall({ phase: "listening" });
	}

	private maybeStartMeter(): void {
		if (this.meterTimer !== null || !this.analyser) return;
		const analyser = this.analyser;
		const buffer = new Float32Array(analyser.fftSize);

		this.meterTimer = window.setInterval(() => {
			if (!this.active) return;
			analyser.getFloatTimeDomainData(buffer);
			let sum = 0;
			for (let i = 0; i < buffer.length; i += 1) {
				sum += buffer[i] * buffer[i];
			}
			const rms = Math.sqrt(sum / buffer.length);
			// While the reply is speaking the orb belongs to the playback
			// meter (real TTS amplitude, wired in playBlob); the mic keeps
			// running only to hear a barge-in.
			if (useVoiceCallStore.getState().phase !== "speaking") {
				const level = Math.min(1, rms * 12);
				const prev = useVoiceCallStore.getState().level;
				setCall({ level: prev + (level - prev) * LEVEL_SMOOTHING });
			}
			this.onLevel(rms);
		}, METER_INTERVAL_MS);
	}

	/** Endpoint + barge state machine — called on every meter tick. */
	private onLevel(rms: number): void {
		const state = useVoiceCallStore.getState();
		if (!state.active) return;
		const now = Date.now();
		const silenceMs = useSettingsStore.getState().voiceCallSilenceMs;
		const maxUtteranceMs = useSettingsStore.getState().voiceCallMaxUtteranceMs;

		// ---- open-mic barge (opt-in) while the reply is speaking ----
		if (state.phase === "speaking") {
			if (!useSettingsStore.getState().voiceBargeIn) return;
			if (rms < BARGE_THRESHOLD) {
				this.bargeLoudSince = 0;
				return;
			}
			if (this.bargeLoudSince === 0) this.bargeLoudSince = now;
			if (now - this.bargeLoudSince < BARGE_HOLD_MS) return;
			this.bargeLoudSince = 0;
			this.interrupt();
			return;
		}

		// ---- phase "listening": endpoint detection ----
		if (state.phase !== "listening") return;

		if (this.discardTurn) {
			// Echo/dead-air grace: once the settle window passes, begin capturing.
			if (now >= this.bargeSettleUntil) {
				this.discardTurn = false;
			} else {
				return;
			}
		}

		if (rms >= OPEN_THRESHOLD) {
			if (!this.utteranceActive) {
				this.utteranceActive = true;
				this.utteranceStartAt = now;
			}
			this.lastLoudAt = now;
		}
		if (!this.utteranceActive) return;

		const quietFor = now - Math.max(this.lastLoudAt, this.utteranceStartAt);
		const heldLongEnough = now - this.utteranceStartAt >= SPEECH_CONFIRM_MS;
		const hitCap = now - this.utteranceStartAt >= maxUtteranceMs;
		if (heldLongEnough && quietFor >= silenceMs) {
			void this.handleUtterance();
			return;
		}
		if (hitCap) {
			void this.handleUtterance();
		}
	}

	// ---- turn flow ----------------------------------------------------------

	/** Endpoint hit: park the mic, transcribe, send, reopen. */
	private async handleUtterance(): Promise<void> {
		const recorder = this.recorder;
		if (!recorder) return;
		// Park the turn before transcribing; the meter keeps flowing off the
		// stream's analyser (barge arming needs it while the reply speaks).
		this.recorder = null;
		const blobPromise = recorder.stop();
		setCall({ phase: "transcribing" });

		if (this.discardTurn) {
			// Captured during TTS/barge settle: echo-broken audio; just re-listen.
			if (!this.active) return;
			await this.parkAfterEcho();
			await this.enterListening();
			return;
		}

		let text = "";
		try {
			const blob = await blobPromise;
			text = (await transcribe(blob, voiceSettingsFromStore())).trim();
		} catch (e) {
			if (this.active) {
				setCall({ error: e instanceof Error ? e.message : String(e) });
				await this.enterListening();
			}
			return;
		}

		if (!this.active) return;
		if (!text) {
			// Footsteps / breath / dead line: silently reopen.
			await this.parkAfterEcho();
			await this.enterListening();
			return;
		}

		setCall({ transcript: text });
		const busy = useSessionStore.getState().isStreaming;
		// In a call the utterance always sends; a mid-run utterance stacks as a
		// follow-up on the engine's queue.
		// Voice turns carry the flag so the engine can bind the auxiliary
		// voice model for this turn only (typed turns keep the user's model).
		const send = busy ? rpc.followUp : (message: string) => rpc.prompt(message, undefined, undefined, { voiceTurn: true });
		try {
			await send(text);
			pushCallLog(`You: ${text}`);
			setCall({ agentBusy: true, toolLabel: "" });
		} catch (e) {
			setCall({ error: e instanceof Error ? e.message : String(e) });
		}
		if (!this.active) return;
		await this.parkAfterEcho();
		await this.enterListening();
	}

	private async parkAfterEcho(): Promise<void> {
		this.bargeSettleUntil = Date.now() + BARGE_SETTLE_MS;
		this.discardTurn = true;
	}

	/** User/tap/open-mic interruption while the reply is speaking. */
	interrupt(): void {
		const state = useVoiceCallStore.getState();
		if (!state.active || state.phase !== "speaking") return;
		this.abortSpeech();
		this.bargeSettleUntil = Date.now() + BARGE_SETTLE_MS;
		this.discardTurn = true;
		void this.enterListening();
	}

	private abortSpeech(): void {
		this.speechQueue?.stop();
		this.speechQueue = null;
		this.stopThinkingAudio();
		stopAudio();
		setCall({ spokenIndex: 0, spokenTotal: 0 });
	}

	private stopThinkingAudio(): void {
		if (this.thinkingAudio) {
			this.thinkingAudio.pause();
			this.thinkingAudio = null;
		}
	}

	// ---- agent events (wired from App.tsx) ----------------------------------

	notifyAgentStart(): void {
		if (!this.active) return;
		setCall({ agentBusy: true, toolLabel: "" });
		if (!useSettingsStore.getState().voiceCallCues) return;
		// The user-supplied thinking sound (bundled public/ mp3), with the
		// synthesized ping as fallback if the asset fails to load.
		try {
			const audio = new Audio(assetPath("thinking-sound-voice-mode.mp3"));
			const { completionSoundVolume } = useSettingsStore.getState();
			audio.volume = Math.min(1, Math.max(0, (completionSoundVolume ?? 0.8) * 0.7));
			this.thinkingAudio = audio;
			void audio.play().catch(() => {
				this.thinkingAudio = null;
				playCueVariant(CUE_THINKING, THINKING_CUE_VOLUME);
			});
		} catch {
			playCueVariant(CUE_THINKING, THINKING_CUE_VOLUME);
		}
	}

	/** Scan assistant stream content for tool-call blocks; tick on new ones. */
	notifyAssistantMessage(message: { role: string; content?: unknown }): void {
		if (!this.active) return;
		if (message.role !== "assistant" || !Array.isArray(message.content)) return;
		for (const block of message.content as Array<Record<string, unknown>>) {
			if (block?.type !== "toolCall") continue;
			const id = typeof block.id === "string" ? block.id : "";
			if (!id || id === this.lastToolCallId) continue;
			this.lastToolCallId = id;
			setCall({
				toolLabel: typeof block.name === "string" ? block.name : "",
			});
			if (useSettingsStore.getState().voiceCallCues) {
				playCueVariant(CUE_TOOL_CALL, TOOL_CUE_VOLUME);
			}
			return; // one tick per message update is plenty
		}
	}

	/** agent_end — the turn's reply arrives as plain text (may be empty). */
	notifyAgentEnd(text: string): void {
		if (!this.active) return;
		setCall({ agentBusy: false, toolLabel: "" });
		// A queued follow-up's reply supersedes whatever reply is still playing.
		this.abortSpeech();
		// Speak the sanitized copy: markdown, URLs, paths and code are noise
		// aloud. The transcript keeps the raw reply.
		const spokenText = speechify(text, { mode: useSettingsStore.getState().voiceSpeechMode });
		const capped = capForSpeech(spokenText, useSettingsStore.getState().voiceMaxSpokenChars);
		pushCallLog(`Agent: ${capped}`);
		const muted = useVoiceCallStore.getState().muted;
		const sentences = splitForSpeech(muted ? "" : capped);
		if (!sentences.length) {
			void this.speakDone();
			return;
		}
		const settings = voiceSettingsFromStore();
		const queue = new SpeechQueue(sentences, settings, (index) => setCall({ spokenIndex: index }));
		this.speechQueue = queue;
		setCall({ phase: "speaking", spokenTotal: sentences.length, spokenIndex: 0 });
		void queue.run().then(() => {
			if (this.speechQueue === queue) this.speechQueue = null;
			void this.speakDone();
		});
	}

	notifyAgentAborted(): void {
		if (!this.active) return;
		setCall({ agentBusy: false, toolLabel: "" });
		pushCallLog("(interrupted)");
	}

	// ---- speaking → listening -----------------------------------------------

	private async speakDone(): Promise<void> {
		if (!this.active) return;
		await this.parkAfterEcho();
		await this.enterListening();
	}

	// ---- in-call controls ----------------------------------------------------

	toggleMute(): void {
		const muted = !useVoiceCallStore.getState().muted;
		setCall({ muted });
		if (muted) {
			// Mute: stop speaking + stop transcribing; keep the session + meter.
			this.abortSpeech();
			this.recorder = null; // drop any parked/running turn's audio
			this.discardTurn = true;
			this.bargeSettleUntil = Number.MAX_SAFE_INTEGER; // meters inert until unmute
		} else {
			this.bargeSettleUntil = Date.now() + BARGE_SETTLE_MS;
			void this.enterListening();
		}
	}

	/** Skip the currently playing sentence; the reply keeps playing. */
	skipSentence(): void {
		if (this.speechQueue) {
			this.speechQueue.skipCurrent();
		}
	}
}

/** A MediaRecorder over the shared call stream (analyser keeps it). */
function createMicRecorderFromStream(stream: MediaStream | null): MicRecorder {
	if (!stream) throw new Error("Microphone stream unavailable");
	const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
		? "audio/webm;codecs=opus"
		: MediaRecorder.isTypeSupported("audio/webm")
			? "audio/webm"
			: "";
	const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
	const chunks: BlobPart[] = [];
	let stopped = false;
	recorder.ondataavailable = (e) => {
		if (e.data.size > 0) chunks.push(e.data);
	};
	return {
		start: async () => {
			recorder.start();
		},
		stop: () =>
			new Promise<Blob>((resolve) => {
				if (stopped) {
					resolve(new Blob(chunks, { type: mimeType || "audio/webm" }));
					return;
				}
				stopped = true;
				recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "audio/webm" }));
				recorder.stop();
			}),
		cancel: () => {
			stopped = true;
			try {
				recorder.stop();
			} catch {
				// already stopped
			}
		},
	};
}

export const voiceCall = new VoiceCallController();
/**
 * Huddle call mode: a voice call around a huddle (or a coworker DM).
 *
 * The 1:1 voice call wraps the active session; this one wraps the office room.
 * The user speaks → STT → `office_send` → the huddle's bounded round-robin
 * drive runs as usual → every new coworker message is spoken in order, with
 * the speaker's name announced before the message. The mic parks while the
 * room talks (half-duplex) and reopens when the drive settles.
 *
 * The office engine remains the source of truth: this controller only feeds
 * utterances in and voices the coworker log lines it receives. It ignores
 * history from before the call and the user's own entries.
 */

import { create } from "zustand";
import { playCueVariant } from "./completion-sound";
import type { OfficeHuddleDelta, OfficeHuddlePayload, OfficeMessage } from "./rpc";
import * as rpc from "./rpc";
import { speechify } from "./speech-text";
import { toast } from "../stores/toast-store";
import { useOfficeStore } from "../stores/office-store";
import { useSettingsStore } from "../stores/settings-store";
import {
	micAudioConstraints,
	splitForSpeech,
	startAudioMeter,
	synthesize,
	transcribe,
	type MicRecorder,
	type VoiceSettings,
} from "./voice";

// Cue variants from the shared completion-sound bank.
const CUE_CALL_CONNECTED = 7;
const CUE_CALL_HANGUP = 5;

/** RMS level the mic must hold before an utterance is considered begun. */
const OPEN_THRESHOLD = 0.05;
/** RMS level that arms + fires an open-mic barge while the room speaks. */
const BARGE_THRESHOLD = 0.09;
/** Sustained loud time before a barge fires (ms) — rejects clicks/thuds. */
const BARGE_HOLD_MS = 300;
/** If a barge never turns into an utterance, the room gets the floor back. */
const BARGE_HOLD_MAX_MS = 8_000;
/** Speech must be confirmed this long before endpointing is active (ms). */
const SPEECH_CONFIRM_MS = 250;
/** Quiet/dead-air grace after TTS before the mic reopens (ms). */
const BARGE_SETTLE_MS = 600;
/** Meter + endpoint state-machine poll interval (ms). */
const METER_INTERVAL_MS = 50;
/** Level smoothing factor for the store value (EMA). */
const LEVEL_SMOOTHING = 0.3;

export type HuddleCallPhase = "connecting" | "listening" | "transcribing" | "thinking" | "speaking";

interface HuddleCallState {
	active: boolean;
	huddleId: string | null;
	huddleName: string;
	phase: HuddleCallPhase;
	/** Smoothed audio level 0..1 (mic while listening, TTS while speaking). */
	level: number;
	/** Last finished transcription (call bar ticker). */
	transcript: string;
	/** Coworker currently being voiced. */
	speakingName: string;
	spokenIndex: number;
	spokenTotal: number;
	error: string;
	muted: boolean;
}

export const useHuddleCallStore = create<HuddleCallState>()(() => ({
	active: false,
	huddleId: null,
	huddleName: "",
	phase: "listening",
	level: 0,
	transcript: "",
	speakingName: "",
	spokenIndex: 0,
	spokenTotal: 0,
	error: "",
	muted: false,
}));

function setCall(patch: Partial<HuddleCallState>): void {
	useHuddleCallStore.setState(patch);
}

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

/** Truncate a long reply for speaking, marking the elision with "…". */
function capForSpeech(text: string, maxChars: number): string {
	if (maxChars <= 0 || text.length <= maxChars) return text;
	const cut = text.lastIndexOf(" ", maxChars);
	return `${text.slice(0, cut > 0 ? cut : maxChars).trimEnd()} …`;
}

/** New coworker lines posted since the call started. Mutates `spoken` so the
 * full log can be re-delivered on every turn without replaying history. */
export function collectCoworkerLines(
	log: OfficeMessage[],
	spoken: Set<string>,
	since: number,
): OfficeMessage[] {
	const fresh: OfficeMessage[] = [];
	for (const message of log) {
		if (message.from.kind !== "coworker") continue;
		if (spoken.has(message.id)) continue;
		spoken.add(message.id);
		if (message.at < since) continue;
		fresh.push(message);
	}
	return fresh;
}

class HuddleCallController {
	private stream: MediaStream | null = null;
	private recorder: MicRecorder | null = null;
	private ctx: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private meterTimer: number | null = null;

	private huddleId: string | null = null;
	/** Log entries from before the call are history, never spoken. */
	private startedAt = 0;
	/** Message ids already queued/voiced (the log is re-sent in full). */
	private spoken = new Set<string>();
	/** Coworker messages waiting to be voiced, in log order. */
	private pending: OfficeMessage[] = [];
	private draining = false;
	private driveRunning = false;
	/** Current TTS audio element, for skip/end. */
	private speechAudio: HTMLAudioElement | null = null;
	private stopSpeech = false;
	/** Bumped on start/stop so an in-flight TTS/utterance from a previous call
	 *  can never speak or send into the next one. */
	private generation = 0;
	/** Bumped on a barge so the current drain stops without ending the call. */
	private speechToken = 0;
	/** The user took the floor mid-reply; queue room lines but don't voice them. */
	private holdingFloor = false;
	private holdTimer: number | null = null;
	private bargeLoudSince = 0;

	private utteranceActive = false;
	private lastLoudAt = 0;
	private utteranceStartAt = 0;
	/** Drop the captured turn (echo from TTS / mute boundary). */
	private discardTurn = false;
	private bargeSettleUntil = 0;

	get active(): boolean {
		return useHuddleCallStore.getState().active;
	}

	// ---- lifecycle ----------------------------------------------------------

	async start(huddleId: string, huddleName: string): Promise<void> {
		if (this.active) {
			if (this.huddleId === huddleId) return;
			await this.stop();
		}
		const s = useSettingsStore.getState();
		if (!s.voiceSttBaseUrl.trim() || !s.voiceTtsBaseUrl.trim()) {
			toast.warning(
				"Speech endpoints not configured",
				"Set your STT and TTS base URLs under Settings → Voice, then start a huddle call.",
			);
			return;
		}

		this.generation += 1;
		this.speechToken += 1;
		this.clearHold();
		this.huddleId = huddleId;
		this.startedAt = Date.now();
		this.spoken = new Set();
		this.pending = [];
		this.draining = false;
		this.driveRunning = Boolean(useOfficeStore.getState().huddles[huddleId]?.data.running);
		this.stopSpeech = false;
		this.utteranceActive = false;
		this.discardTurn = true;
		this.bargeSettleUntil = 0;

		setCall({
			active: true,
			huddleId,
			huddleName,
			phase: "connecting",
			level: 0,
			transcript: "",
			speakingName: "",
			spokenIndex: 0,
			spokenTotal: 0,
			error: "",
			muted: false,
		});

		try {
			await this.openMic();
			if (!this.active) return;
			if (s.voiceCallCues) playCueVariant(CUE_CALL_CONNECTED);
			// A huddle payload may already hold messages posted since start.
			const warm = useOfficeStore.getState().huddles[huddleId];
			if (warm) this.pending.push(...collectCoworkerLines(warm.data.log, this.spoken, this.startedAt));
			if (this.pending.length > 0) {
				this.parkMicForSpeech();
				void this.drain();
			} else if (this.driveRunning) {
				setCall({ phase: "thinking" });
			} else {
				await this.enterListening();
			}
		} catch (e) {
			this.teardownMic();
			setCall({
				active: false,
				huddleId: null,
				huddleName: "",
				phase: "listening",
				level: 0,
				speakingName: "",
				spokenIndex: 0,
				spokenTotal: 0,
				error: e instanceof Error ? e.message : String(e),
				muted: false,
			});
			toast.error("Huddle call failed", e instanceof Error ? e.message : String(e));
		}
	}

	async stop(): Promise<void> {
		if (!this.active) return;
		this.generation += 1;
		this.speechToken += 1;
		this.clearHold();
		this.stopSpeech = true;
		this.pending = [];
		this.draining = false;
		this.stopSpeechAudio();
		this.teardownMic();
		if (useSettingsStore.getState().voiceCallCues) playCueVariant(CUE_CALL_HANGUP);
		this.huddleId = null;
		this.spoken.clear();
		setCall({
			active: false,
			huddleId: null,
			huddleName: "",
			phase: "listening",
			level: 0,
			transcript: "",
			speakingName: "",
			spokenIndex: 0,
			spokenTotal: 0,
			error: "",
			muted: false,
		});
	}

	/** Queue new coworker entries from a full huddle payload for the active room. */
	notifyHuddle(payload: OfficeHuddlePayload): void {
		if (!this.active || payload.huddleId !== this.huddleId) return;
		this.applyRoomUpdate(payload.data.log, Boolean(payload.data.running));
	}

	/** Queue appended coworker entries from a delta payload. */
	notifyHuddleDelta(delta: OfficeHuddleDelta): void {
		if (!this.active || delta.huddleId !== this.huddleId) return;
		this.applyRoomUpdate(delta.messages, Boolean(delta.running));
	}

	private applyRoomUpdate(log: OfficeMessage[], running: boolean): void {
		const wasRunning = this.driveRunning;
		this.driveRunning = running;
		if (this.driveRunning && this.recorder) {
			// The drive owns the floor now; park a capture that the start event
			// raced (send-to-huddle emits the user message before the drive start).
			this.recorder.cancel();
			this.recorder = null;
			this.utteranceActive = false;
		}
		const fresh = collectCoworkerLines(log, this.spoken, this.startedAt);
		this.pending.push(...fresh);
		if (this.holdingFloor) {
			// The user took the floor; keep the new lines for after their turn,
			// but leave the mic capture alone.
			return;
		}
		if (fresh.length > 0) {
			// A coworker has the floor; drop any half-captured user turn.
			this.parkMicForSpeech();
			void this.drain();
			return;
		}
		if (!this.driveRunning && wasRunning && !this.draining && this.pending.length === 0) {
			void this.resumeListening();
		} else if (this.driveRunning && !this.draining && this.pending.length === 0) {
			if (useHuddleCallStore.getState().phase !== "speaking") setCall({ phase: "thinking" });
		}
	}

	// ---- speech -------------------------------------------------------------

	private async drain(): Promise<void> {
		if (this.draining || !this.active) return;
		const generation = this.generation;
		const token = this.speechToken;
		this.draining = true;
		try {
			while (
				generation === this.generation &&
				token === this.speechToken &&
				this.active &&
				!this.stopSpeech &&
				this.pending.length > 0
			) {
				const message = this.pending.shift();
				if (!message) break;
				await this.speakMessage(message, generation, token);
			}
		} finally {
			this.draining = false;
		}
		if (generation !== this.generation || !this.active || this.stopSpeech) return;
		if (this.holdingFloor) {
			await this.enterListening();
			return;
		}
		if (token !== this.speechToken) return;
		if (this.pending.length > 0) {
			void this.drain();
			return;
		}
		if (this.driveRunning) {
			setCall({ phase: "thinking", speakingName: "" });
			return;
		}
		await this.resumeListening();
	}

	private async speakMessage(message: OfficeMessage, generation: number, token: number): Promise<void> {
		const settings = useSettingsStore.getState();
		const spokenText = speechify(message.text, { mode: settings.voiceSpeechMode });
		const capped = capForSpeech(spokenText, settings.voiceMaxSpokenChars);
		const sentences = splitForSpeech(capped);
		if (sentences.length === 0) return;

		// A coworker's own TTS voice makes a group call legible without the
		// name prefix doing all the work; fall back to the configured voice.
		const base = voiceSettingsFromStore();
		const coworkerVoice = message.from.id
			? useOfficeStore.getState().snapshot?.coworkers.find((c) => c.id === message.from.id)?.voice
			: undefined;
		const voice = coworkerVoice?.trim() ? { ...base, voiceTtsVoice: coworkerVoice.trim() } : base;

		const name = message.from.name;
		setCall({
			phase: "speaking",
			speakingName: name,
			spokenIndex: 0,
			spokenTotal: sentences.length,
		});
		for (let i = 0; i < sentences.length; i += 1) {
			if (generation !== this.generation || token !== this.speechToken || !this.active || this.stopSpeech) return;
			setCall({ spokenIndex: i });
			// Announce the speaker once per message so audio has identity.
			const line = i === 0 ? `${name} says: ${sentences[i] ?? ""}` : (sentences[i] ?? "");
			let blob: Blob;
			try {
				blob = await synthesize(line, voice);
			} catch (e) {
				setCall({ error: e instanceof Error ? e.message : String(e) });
				continue;
			}
			if (generation !== this.generation || token !== this.speechToken || !this.active || this.stopSpeech) return;
			await this.playBlob(blob, generation, token);
		}
	}

	private playBlob(blob: Blob, generation: number, token: number): Promise<void> {
		return new Promise((resolve) => {
			if (generation !== this.generation || token !== this.speechToken || !this.active || this.stopSpeech) {
				resolve();
				return;
			}
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			this.speechAudio = audio;
			const stopMeter = startAudioMeter(audio, (level) => {
				if (useHuddleCallStore.getState().phase === "speaking") setCall({ level });
			});
			let done = false;
			const finish = (): void => {
				if (done) return;
				done = true;
				stopMeter();
				URL.revokeObjectURL(url);
				if (this.speechAudio === audio) this.speechAudio = null;
				resolve();
			};
			audio.addEventListener("ended", finish);
			audio.addEventListener("error", finish);
			audio.addEventListener("pause", finish);
			void audio.play().catch(finish);
		});
	}

	private stopSpeechAudio(): void {
		const audio = this.speechAudio;
		this.speechAudio = null;
		if (audio) {
			audio.pause();
			audio.src = "";
		}
	}

	/** Skip the sentence currently playing; the rest of the message continues. */
	skipSentence(): void {
		if (!this.speechAudio) return;
		this.speechAudio.pause();
	}

	// ---- mic ----------------------------------------------------------------

	private async openMic(): Promise<void> {
		if (this.stream) return;
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: micAudioConstraints() });
		try {
			this.ctx = new AudioContext();
			if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => undefined);
			const source = this.ctx.createMediaStreamSource(this.stream);
			const analyser = this.ctx.createAnalyser();
			analyser.fftSize = 512;
			source.connect(analyser); // not to destination: no feedback
			this.analyser = analyser;
		} catch (e) {
			console.warn("[huddle-call] analyser unavailable", e);
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
			this.stream.getTracks().forEach((track) => track.stop());
			this.stream = null;
		}
	}

	private async enterListening(): Promise<void> {
		if (!this.active || this.draining || this.pending.length > 0) return;
		this.maybeStartMeter();
		if (useHuddleCallStore.getState().muted) {
			this.utteranceActive = false;
			setCall({ phase: "listening", speakingName: "", spokenIndex: 0, spokenTotal: 0 });
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
		this.discardTurn = true;
		setCall({ phase: "listening", speakingName: "", spokenIndex: 0, spokenTotal: 0 });
	}

	private async resumeListening(): Promise<void> {
		if (!this.active || this.draining || this.pending.length > 0 || this.driveRunning) return;
		await this.enterListening();
	}

	/** Park the mic while a coworker has the floor. */
	private parkMicForSpeech(): void {
		if (this.recorder) {
			this.recorder.cancel();
			this.recorder = null;
		}
		this.utteranceActive = false;
	}

	private maybeStartMeter(): void {
		if (this.meterTimer !== null || !this.analyser) return;
		const analyser = this.analyser;
		const buffer = new Float32Array(analyser.fftSize);
		this.meterTimer = window.setInterval(() => {
			if (!this.active) return;
			analyser.getFloatTimeDomainData(buffer);
			let sum = 0;
			for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
			const rms = Math.sqrt(sum / buffer.length);
			// While the room talks the orb belongs to playback (playBlob).
			if (useHuddleCallStore.getState().phase !== "speaking") {
				const level = Math.min(1, rms * 12);
				const prev = useHuddleCallStore.getState().level;
				setCall({ level: prev + (level - prev) * LEVEL_SMOOTHING });
			}
			this.onLevel(rms);
		}, METER_INTERVAL_MS);
	}

	private onLevel(rms: number): void {
		const state = useHuddleCallStore.getState();
		if (!state.active || state.muted) return;
		const now = Date.now();
		if (state.phase === "speaking") {
			this.onSpeechLevel(rms, now);
			return;
		}
		if (state.phase !== "listening") return;
		const silenceMs = useSettingsStore.getState().voiceCallSilenceMs;
		const maxUtteranceMs = useSettingsStore.getState().voiceCallMaxUtteranceMs;

		if (this.discardTurn) {
			if (now >= this.bargeSettleUntil) this.discardTurn = false;
			else return;
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
		if (hitCap) void this.handleUtterance();
	}

	/** Open-mic barge while a coworker is being voiced. */
	private onSpeechLevel(rms: number, now: number): void {
		if (!useSettingsStore.getState().voiceBargeIn) return;
		if (rms < BARGE_THRESHOLD) {
			this.bargeLoudSince = 0;
			return;
		}
		if (this.bargeLoudSince === 0) this.bargeLoudSince = now;
		if (now - this.bargeLoudSince < BARGE_HOLD_MS) return;
		this.bargeLoudSince = 0;
		this.interruptSpeech();
	}

	/** Stop the current reply, take the floor, and start listening. */
	private interruptSpeech(): void {
		this.speechToken += 1;
		this.stopSpeechAudio();
		this.pending = [];
		this.holdingFloor = true;
		this.bargeLoudSince = 0;
		this.bargeSettleUntil = Date.now() + BARGE_SETTLE_MS;
		this.discardTurn = true;
		setCall({ phase: "listening", speakingName: "", spokenIndex: 0, spokenTotal: 0, transcript: "" });
		this.armHoldRelease();
		// If the drain was already finished (between messages), open the mic now.
		window.setTimeout(() => {
			if (this.active && this.holdingFloor && !this.draining) void this.enterListening();
		}, 60);
	}

	/** If the barge was a cough rather than a turn, let the room resume. */
	private armHoldRelease(): void {
		if (this.holdTimer !== null) clearTimeout(this.holdTimer);
		this.holdTimer = window.setTimeout(() => {
			this.holdTimer = null;
			if (!this.active || !this.holdingFloor) return;
			if (this.utteranceActive) {
				this.armHoldRelease();
				return;
			}
			this.holdingFloor = false;
			void this.drain();
			if (this.pending.length === 0 && !this.driveRunning) void this.resumeListening();
		}, BARGE_HOLD_MAX_MS);
	}

	private clearHold(): void {
		if (this.holdTimer !== null) {
			clearTimeout(this.holdTimer);
			this.holdTimer = null;
		}
		this.holdingFloor = false;
		this.bargeLoudSince = 0;
	}

	private async handleUtterance(): Promise<void> {
		const recorder = this.recorder;
		const huddleId = this.huddleId;
		const generation = this.generation;
		if (!recorder || !huddleId) return;
		this.recorder = null;
		const blobPromise = recorder.stop();
		setCall({ phase: "transcribing" });

		if (this.discardTurn) {
			if (!this.active) return;
			await this.parkAfterEcho();
			await this.enterListening();
			return;
		}

		let text = "";
		try {
			text = (await transcribe(await blobPromise, voiceSettingsFromStore())).trim();
		} catch (e) {
			if (this.active) {
				setCall({ error: e instanceof Error ? e.message : String(e) });
				await this.enterListening();
			}
			return;
		}
		if (!this.active || generation !== this.generation) return;
		if (!text) {
			await this.parkAfterEcho();
			await this.enterListening();
			return;
		}

		setCall({ transcript: text, phase: "thinking" });
		this.driveRunning = true;
		try {
			await rpc.officeSend(huddleId, text);
		} catch (e) {
			setCall({ error: e instanceof Error ? e.message : String(e) });
			this.driveRunning = false;
			await this.parkAfterEcho();
			await this.enterListening();
			return;
		}
		// A barge utterance redirects the room; old-drive backlog is stale.
		this.clearHold();
		this.pending = [];
		// The room's drive owns the floor now; huddle events reopen the mic.
		await this.parkAfterEcho();
	}

	private async parkAfterEcho(): Promise<void> {
		this.bargeSettleUntil = Date.now() + BARGE_SETTLE_MS;
		this.discardTurn = true;
	}

	// ---- controls -----------------------------------------------------------

	toggleMute(): void {
		const muted = !useHuddleCallStore.getState().muted;
		setCall({ muted });
		if (muted) {
			if (this.recorder) {
				this.recorder.cancel();
				this.recorder = null;
			}
			this.utteranceActive = false;
			this.discardTurn = true;
			this.bargeSettleUntil = Number.MAX_SAFE_INTEGER;
			setCall({ level: 0 });
		} else {
			this.bargeSettleUntil = Date.now() + BARGE_SETTLE_MS;
			this.discardTurn = true;
			void this.resumeListening();
		}
	}
}

/** A MediaRecorder over the shared call stream (the analyser keeps it open). */
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

export const huddleCall = new HuddleCallController();

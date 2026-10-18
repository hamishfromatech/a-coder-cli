/**
 * Voice mode helpers: microphone recording, OpenAI-compatible speech-to-text
 * (POST {base}/audio/transcriptions) and text-to-speech (POST {base}/audio/speech),
 * plus audio playback.
 *
 * Endpoints are user-configured in Settings -> Voice, so any OpenAI-compatible
 * provider works (OpenAI, Azure, local servers, etc.). Auth is sent as
 * `Authorization: Bearer <apiKey>` only when an API key is configured, so
 * keyless local servers work too.
 */

import { invoke } from "@tauri-apps/api/core";

export interface VoiceSettings {
	voiceSttBaseUrl: string;
	voiceSttApiKey: string;
	voiceSttModel: string;
	voiceTtsBaseUrl: string;
	voiceTtsApiKey: string;
	voiceTtsModel: string;
	voiceTtsVoice: string;
}

/**
 * Normalize a user-supplied base URL to end with `/v1` (no trailing slash).
 * Accepts `https://api.openai.com`, `https://api.openai.com/v1`, or a full
 * `/v1/audio/speech` URL — all collapse to `https://api.openai.com/v1`.
 */
export function normalizeBaseUrl(raw: string): string {
	let url = raw.trim().replace(/\/+$/, "");
	if (!url) return "";
	// Strip a trailing /audio/speech or /audio/transcriptions if the user pasted a full endpoint.
	url = url.replace(/\/audio\/(speech|transcriptions)$/i, "");
	if (!/\/v1$/i.test(url)) {
		url = `${url}/v1`;
	}
	return url;
}

/** Convert a Blob to a base64 string (without the data: URL prefix). */
function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = reader.result as string;
			const idx = dataUrl.indexOf(",");
			resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
		};
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio"));
		reader.readAsDataURL(blob);
	});
}

/** Decode a base64 string into a Blob. */
function base64ToBlob(base64: string, mime: string): Blob {
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: mime });
}

/**
 * List the models a voice endpoint offers, via GET {base}/models through the
 * Rust `voice_fetch_json` CORS bridge. Normalizes the OpenAI shape
 * ({ data: [{ id }] }) and lenient alternatives (plain arrays, ids/name keys).
 */
export async function listVoiceModels(baseUrl: string, apiKey: string): Promise<string[]> {
	const raw = await invoke<string>("voice_fetch_json", { baseUrl, apiKey, route: "models" });
	return normalizeCatalog(raw, ["id", "name"]);
}

/**
 * List the voices a TTS endpoint offers, via GET {base}/voices through the
 * Rust `voice_fetch_json` CORS bridge. Accepts plain string arrays, { voices: [...] }
 * and { data: [{ id | name | voice }] } shapes.
 */
export async function listVoiceVoices(baseUrl: string, apiKey: string): Promise<string[]> {
	const raw = await invoke<string>("voice_fetch_json", { baseUrl, apiKey, route: "voices" });
	return normalizeCatalog(raw, ["id", "name", "voice"]);
}

/** Parse a catalog response body into a sorted list of option names. */
function normalizeCatalog(raw: string, keys: string[]): string[] {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return [];
	}
	if (typeof value !== "object" || value === null) return [];
	const list: unknown[] = Array.isArray(value)
		? value
		: Array.isArray((value as { data?: unknown[] }).data)
			? (value as { data: unknown[] }).data
			: Array.isArray((value as { voices?: unknown[] }).voices)
				? (value as { voices: unknown[] }).voices
				: [];
	const out = new Set<string>();
	for (const entry of list) {
		if (typeof entry === "string") {
			if (entry.trim()) out.add(entry.trim());
			continue;
		}
		if (typeof entry !== "object") continue;
		for (const key of keys) {
			const v = (entry as Record<string, unknown>)[key];
			if (typeof v === "string" && v.trim()) {
				out.add(v.trim());
				break;
			}
		}
	}
	return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/**
 * Transcribe an audio blob. Routed through the Rust `voice_transcribe` command
 * so the request bypasses webview CORS (providers don't return CORS headers
 * for the tauri:// origin). Returns the transcribed text.
 */
export async function transcribe(
	audio: Blob,
	settings: VoiceSettings,
): Promise<string> {
	if (!settings.voiceSttBaseUrl.trim()) throw new Error("Speech-to-text base URL is not configured.");
	const audioBase64 = await blobToBase64(audio);
	return await invoke<string>("voice_transcribe", {
		audioBase64,
		mimeType: audio.type || "audio/webm",
		settings,
	});
}

/**
 * Synthesize speech. Routed through the Rust `voice_synthesize` command to
 * bypass webview CORS. Returns an mp3 Blob ready for playback.
 */
export async function synthesize(
	text: string,
	settings: VoiceSettings,
): Promise<Blob> {
	if (!settings.voiceTtsBaseUrl.trim()) throw new Error("Text-to-speech base URL is not configured.");
	if (!text.trim()) throw new Error("Nothing to synthesize.");
	const base64 = await invoke<string>("voice_synthesize", { text, settings });
	return base64ToBlob(base64, "audio/mpeg");
}

let currentAudio: HTMLAudioElement | null = null;

/** Play an audio blob, interrupting any currently-playing voice audio. */
export function playAudioBlob(blob: Blob): HTMLAudioElement {
	stopAudio();
	const url = URL.createObjectURL(blob);
	const audio = new Audio(url);
	currentAudio = audio;
	audio.addEventListener("ended", () => {
		URL.revokeObjectURL(url);
		if (currentAudio === audio) currentAudio = null;
	});
	void audio.play().catch(() => {
		// Autoplay can reject before a user gesture; ignore — caller may retry.
	});
	return audio;
}

/** Stop any currently-playing voice audio. */
export function stopAudio(): void {
	if (currentAudio) {
		currentAudio.pause();
		currentAudio.src = "";
		currentAudio = null;
	}
}

/** Whether voice audio is currently playing. */
export function isAudioPlaying(): boolean {
	return !!currentAudio && !currentAudio.paused;
}

/**
 * Microphone recorder. Call start() to begin capturing; stop() returns the
 * recorded audio Blob. Cleans up the stream on stop.
 */
export interface MicRecorder {
	start: () => Promise<void>;
	stop: () => Promise<Blob>;
	cancel: () => void;
}

// The chosen microphone persists across calls and dictation (localStorage;
// the picker on the voice-call start screen writes it).
export const MIC_DEVICE_STORAGE_KEY = "a-coder.voice.micDeviceId";

/** Audio track constraints honoring the picked mic; non-`exact` deviceId, so
 *  a vanished device degrades to the default instead of failing the call. */
export function micAudioConstraints(): MediaTrackConstraints | boolean {
	try {
		const id = localStorage.getItem(MIC_DEVICE_STORAGE_KEY);
		return id ? { deviceId: id } : true;
	} catch {
		return true;
	}
}

export async function createMicRecorder(): Promise<MicRecorder> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: micAudioConstraints() });
	// Prefer a widely-supported mime type; fall back to the default.
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
				recorder.onstop = () => {
					stream.getTracks().forEach((t) => t.stop());
					resolve(new Blob(chunks, { type: mimeType || "audio/webm" }));
				};
				recorder.stop();
			}),
		cancel: () => {
			stopped = true;
			try {
				recorder.stop();
			} catch {
				// already stopped
			}
			stream.getTracks().forEach((t) => t.stop());
		},
	};
}
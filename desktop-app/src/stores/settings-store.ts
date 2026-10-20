import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applySkinToRoot } from "../lib/apply-theme";
import { readSettingsFile, writeSettingsFile } from "../lib/rpc";
import type { CliSettings, PermissionMode, ThinkingLevel } from "../lib/settings.types";

// ============================================================================
// Local UI preferences — Zustand-persisted to localStorage. Independent of
// the cli's settings.json so desktop prefs survive engine resets.
// ============================================================================

export type Theme = "system" | "dark" | "light";

/** Accent/identity skin name (see src/lib/theme-presets.ts). */
export type Skin = string;

export interface StartupModel {
	provider: string;
	id: string;
}

export interface SettingsState {
	// ---- local UI prefs (persisted) ----
	cliPath: string;
	setCliPath: (path: string) => void;

	theme: Theme;
	setTheme: (theme: Theme) => void;

	skin: Skin;
	setSkin: (skin: Skin) => void;

	reopenLastProject: boolean;
	setReopenLastProject: (value: boolean) => void;

	startupModel: StartupModel | null;
	setStartupModel: (model: StartupModel | null) => void;

	permissionMode: PermissionMode;
	setPermissionMode: (mode: PermissionMode) => void;

	// ---- completion sound (local UI pref; persisted) ----
	/** Whether to chime at the end of an agent turn. */
	completionSoundEnabled: boolean;
	setCompletionSoundEnabled: (enabled: boolean) => void;
	/** Which chime preset to play (1..COMPLETION_SOUND_VARIANT_COUNT). */
	completionSoundVariantId: number;
	setCompletionSoundVariantId: (variantId: number) => void;
	/**
	 * Master volume for completion chimes and other synthesized UI sounds.
	 * Stored as a linear gain 0..1. Defaults to 0.8 so the sound is clearly
	 * audible without surprising the user on first launch.
	 */
	completionSoundVolume: number;
	setCompletionSoundVolume: (volume: number) => void;

	// ---- chat backdrop (local UI pref; persisted) ----
	/** Whether the faint background image renders behind the chat surface. */
	chatBackdrop: boolean;
	setChatBackdrop: (enabled: boolean) => void;
	/** Whether trackpad haptics fire for turn cues and UI gestures. */
	hapticsEnabled: boolean;
	setHapticsEnabled: (enabled: boolean) => void;

	// ---- Voice mode (local UI pref; persisted) ----
	// Users supply OpenAI-compatible STT/TTS endpoints so any provider works.
	voiceEnabled: boolean;
	setVoiceEnabled: (enabled: boolean) => void;
	voiceSttBaseUrl: string;
	setVoiceSttBaseUrl: (url: string) => void;
	voiceSttApiKey: string;
	setVoiceSttApiKey: (key: string) => void;
	voiceSttModel: string;
	setVoiceSttModel: (model: string) => void;
	voiceTtsBaseUrl: string;
	setVoiceTtsBaseUrl: (url: string) => void;
	voiceTtsApiKey: string;
	setVoiceTtsApiKey: (key: string) => void;
	voiceTtsModel: string;
	setVoiceTtsModel: (model: string) => void;
	voiceTtsVoice: string;
	setVoiceTtsVoice: (voice: string) => void;
	voiceAutoSubmit: boolean;
	setVoiceAutoSubmit: (enabled: boolean) => void;
	voiceAutoSpeak: boolean;
	setVoiceAutoSpeak: (enabled: boolean) => void;
	/** Call mode: quiet (ms) before an utterance auto-sends. */
	voiceCallSilenceMs: number;
	setVoiceCallSilenceMs: (ms: number) => void;
	/** Call mode: hard cap (ms) on one spoken utterance. */
	voiceCallMaxUtteranceMs: number;
	setVoiceCallMaxUtteranceMs: (ms: number) => void;
	/** Call mode: keep the mic armed while the reply speaks; loud speech barges. */
	voiceBargeIn: boolean;
	setVoiceBargeIn: (enabled: boolean) => void;
	/** Call mode: mic sensitivity (0..1). Higher opens on quieter speech. */
	voiceMicSensitivity: number;
	setVoiceMicSensitivity: (sensitivity: number) => void;
	/** How replies are prepared for speech: strip markdown/URLs/paths
	 *  ("concise", default) or read the text exactly as written ("verbatim"). */
	voiceSpeechMode: "concise" | "verbatim";
	setVoiceSpeechMode: (mode: "concise" | "verbatim") => void;
	/** Call mode: max chars of a reply read aloud (0 = unlimited). */
	voiceMaxSpokenChars: number;
	setVoiceMaxSpokenChars: (chars: number) => void;
	/** Call mode: synthesized state cues (connected / tools / thinking / hangup). */
	voiceCallCues: boolean;
	setVoiceCallCues: (enabled: boolean) => void;

	// ---- A-Coder Bench (local UI pref; persisted) ----
	/** Model to benchmark as "provider/model-id" (or a custom endpoint model). */
	benchModel: string;
	setBenchModel: (model: string) => void;
	/** Optional self-hosted endpoint (OpenAI-compatible); empty = ambient auth. */
	benchEndpoint: string;
	setBenchEndpoint: (url: string) => void;
	/** API key sent to the endpoint; ignored without an endpoint. */
	benchApiKey: string;
	setBenchApiKey: (key: string) => void;
	/** Runs per task. */
	benchRuns: number;
	setBenchRuns: (runs: number) => void;
	/** Parallel runs (1 = sequential). */
	benchConcurrency: number;
	setBenchConcurrency: (concurrency: number) => void;
	/** Bench directory; empty = auto-detect from the open project. */
	benchDir: string;
	setBenchDir: (dir: string) => void;

	// ---- cli settings snapshot (not persisted; reloaded on connect) ----
	cliGlobalSettings: CliSettings;
	cliProjectSettings: CliSettings;
	setCliSettings: (global: CliSettings, project: CliSettings) => void;
	patchCliSettings: (scope: "global" | "project", patch: Partial<CliSettings>) => void;
	cliSettingsLoaded: boolean;
	setCliSettingsLoaded: (loaded: boolean) => void;
}

// ============================================================================
// Dot-path setter: returns a new object with `dotted.path = value`.
// ============================================================================
export function setByPath<T extends Record<string, unknown>>(
	obj: T,
	path: string,
	value: unknown,
): T {
	const parts = path.split(".");
	const result = { ...obj } as Record<string, unknown>;
	let cursor: Record<string, unknown> = result;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		const next = cursor[key];
		cursor[key] =
			next && typeof next === "object" && !Array.isArray(next)
				? { ...(next as Record<string, unknown>) }
				: {};
		cursor = cursor[key] as Record<string, unknown>;
	}
	cursor[parts[parts.length - 1]] = value as unknown;
	return result as T;
}

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let cursor: unknown = obj;
	for (const key of parts) {
		if (cursor == null || typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return cursor;
}

export const useSettingsStore = create<SettingsState>()(
	persist(
		(set) => ({
			cliPath: "",
			setCliPath: (cliPath) => set({ cliPath }),

			theme: "system",
			setTheme: (theme) => set({ theme }),

			skin: "aurora",
			setSkin: (skin) => set({ skin }),

			reopenLastProject: true,
			setReopenLastProject: (value) => set({ reopenLastProject: value }),

			startupModel: null,
			setStartupModel: (startupModel) => set({ startupModel }),

			permissionMode: "allow",
			setPermissionMode: (permissionMode) => set({ permissionMode }),

			completionSoundEnabled: true,
			setCompletionSoundEnabled: (completionSoundEnabled) => set({ completionSoundEnabled }),
			completionSoundVariantId: 1,
			setCompletionSoundVariantId: (variantId) =>
				// Range-validate without importing the lib (it imports this store back).
				set({
					completionSoundVariantId:
						Number.isInteger(variantId) && variantId >= 1 && variantId <= 14 ? variantId : 1,
				}),
			completionSoundVolume: 0.8,
			setCompletionSoundVolume: (volume) =>
				set({ completionSoundVolume: Math.min(1, Math.max(0, Number.isNaN(volume) ? 0.8 : volume)) }),

			hapticsEnabled: true,
			setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),

			voiceEnabled: false,
			setVoiceEnabled: (voiceEnabled) => set({ voiceEnabled }),
			voiceSttBaseUrl: "",
			setVoiceSttBaseUrl: (voiceSttBaseUrl) => set({ voiceSttBaseUrl }),
			voiceSttApiKey: "",
			setVoiceSttApiKey: (voiceSttApiKey) => set({ voiceSttApiKey }),
			voiceSttModel: "whisper-1",
			setVoiceSttModel: (voiceSttModel) => set({ voiceSttModel }),
			voiceTtsBaseUrl: "",
			setVoiceTtsBaseUrl: (voiceTtsBaseUrl) => set({ voiceTtsBaseUrl }),
			voiceTtsApiKey: "",
			setVoiceTtsApiKey: (voiceTtsApiKey) => set({ voiceTtsApiKey }),
			voiceTtsModel: "gpt-4o-mini-tts",
			setVoiceTtsModel: (voiceTtsModel) => set({ voiceTtsModel }),
			voiceTtsVoice: "alloy",
			setVoiceTtsVoice: (voiceTtsVoice) => set({ voiceTtsVoice }),
			voiceAutoSubmit: true,
			setVoiceAutoSubmit: (voiceAutoSubmit) => set({ voiceAutoSubmit }),
			voiceAutoSpeak: true,
			setVoiceAutoSpeak: (voiceAutoSpeak) => set({ voiceAutoSpeak }),
			voiceCallSilenceMs: 1200,
			setVoiceCallSilenceMs: (voiceCallSilenceMs) => set({ voiceCallSilenceMs }),
			voiceCallMaxUtteranceMs: 15000,
			setVoiceCallMaxUtteranceMs: (voiceCallMaxUtteranceMs) => set({ voiceCallMaxUtteranceMs }),
			voiceBargeIn: false,
			setVoiceBargeIn: (voiceBargeIn) => set({ voiceBargeIn }),
			voiceMicSensitivity: 0.5,
			setVoiceMicSensitivity: (voiceMicSensitivity) =>
				set({ voiceMicSensitivity: Math.max(0, Math.min(1, voiceMicSensitivity)) }),
			voiceSpeechMode: "concise",
			setVoiceSpeechMode: (voiceSpeechMode) => set({ voiceSpeechMode }),
			voiceMaxSpokenChars: 1200,
			setVoiceMaxSpokenChars: (voiceMaxSpokenChars) => set({ voiceMaxSpokenChars }),
			voiceCallCues: true,
			setVoiceCallCues: (voiceCallCues) => set({ voiceCallCues }),

			// ---- A-Coder Bench ----
			benchModel: "",
			setBenchModel: (benchModel) => set({ benchModel }),
			benchEndpoint: "",
			setBenchEndpoint: (benchEndpoint) => set({ benchEndpoint }),
			benchApiKey: "",
			setBenchApiKey: (benchApiKey) => set({ benchApiKey }),
			benchRuns: 1,
			setBenchRuns: (benchRuns) => set({ benchRuns }),
			benchConcurrency: 1,
			setBenchConcurrency: (benchConcurrency) =>
				set({ benchConcurrency: Math.max(1, Math.min(8, benchConcurrency)) }),
			benchDir: "",
			setBenchDir: (benchDir) => set({ benchDir }),

			chatBackdrop: true,
			setChatBackdrop: (chatBackdrop) => set({ chatBackdrop }),

			cliGlobalSettings: {},
			cliProjectSettings: {},
			setCliSettings: (cliGlobalSettings, cliProjectSettings) =>
				set({ cliGlobalSettings, cliProjectSettings, cliSettingsLoaded: true }),
			patchCliSettings: (scope, patch) =>
				set((state) =>
					scope === "global"
						? { cliGlobalSettings: { ...state.cliGlobalSettings, ...patch } }
						: { cliProjectSettings: { ...state.cliProjectSettings, ...patch } },
				),
			cliSettingsLoaded: false,
			setCliSettingsLoaded: (cliSettingsLoaded) => set({ cliSettingsLoaded }),
		}),
		{
			name: "a-coder-desktop-settings",
			// Only persist local UI prefs — cli settings come from the cli on connect.
			partialize: (state) => ({
				cliPath: state.cliPath,
				theme: state.theme,
				skin: state.skin,
				reopenLastProject: state.reopenLastProject,
				startupModel: state.startupModel,
				permissionMode: state.permissionMode,
				completionSoundEnabled: state.completionSoundEnabled,
				completionSoundVariantId: state.completionSoundVariantId,
				hapticsEnabled: state.hapticsEnabled,
			voiceEnabled: state.voiceEnabled,
			voiceSttBaseUrl: state.voiceSttBaseUrl,
			voiceSttApiKey: state.voiceSttApiKey,
			voiceSttModel: state.voiceSttModel,
			voiceTtsBaseUrl: state.voiceTtsBaseUrl,
			voiceTtsApiKey: state.voiceTtsApiKey,
			voiceTtsModel: state.voiceTtsModel,
			voiceTtsVoice: state.voiceTtsVoice,
			voiceAutoSubmit: state.voiceAutoSubmit,
			voiceAutoSpeak: state.voiceAutoSpeak,
			voiceCallSilenceMs: state.voiceCallSilenceMs,
			voiceCallMaxUtteranceMs: state.voiceCallMaxUtteranceMs,
			voiceBargeIn: state.voiceBargeIn,
			voiceMicSensitivity: state.voiceMicSensitivity,
			voiceSpeechMode: state.voiceSpeechMode,
			voiceMaxSpokenChars: state.voiceMaxSpokenChars,
			voiceCallCues: state.voiceCallCues,
			benchModel: state.benchModel,
			benchEndpoint: state.benchEndpoint,
			benchApiKey: state.benchApiKey,
			benchRuns: state.benchRuns,
			benchConcurrency: state.benchConcurrency,
			benchDir: state.benchDir,
			chatBackdrop: state.chatBackdrop,
			}),
		},
	),
);

// ============================================================================
// Helpers (not hooks — call freely from anywhere)
// ============================================================================

/** Load the cli's settings.json for both scopes from disk via the Tauri shell.
 *  Project scope is skipped when no cwd is supplied, and each scope is loaded
 *  independently so a missing project file doesn't wipe the global settings. */
export async function loadCliSettings(cwd?: string): Promise<{
	global: CliSettings;
	project: CliSettings;
}> {
	const [global, project] = await Promise.all([
		readSettingsFile({ scope: "global", cwd }).then(
			(v) => (v ?? {}) as CliSettings,
			() => ({}) as CliSettings,
		),
		cwd
			? readSettingsFile({ scope: "project", cwd }).then(
					(v) => (v ?? {}) as CliSettings,
					() => ({}) as CliSettings,
				)
			: Promise.resolve({} as CliSettings),
	]);
	return { global, project };
}

/** Persist the cli's settings.json for one scope. */
export async function persistCliSettings(
	scope: "global" | "project",
	value: CliSettings,
	cwd?: string,
): Promise<void> {
	await writeSettingsFile({ scope, cwd, value: value as Record<string, unknown> });
}

/**
 * Apply the active skin + light/dark mode to the document root. The skin
 * paints the `--pi-*` palette; the mode toggles the `.light`/`.dark` class
 * (for color-scheme and the class-keyed border/grain rules in index.css).
 */
export function applyThemeToRoot(skin: Skin, theme: Theme): void {
	applySkinToRoot(skin, theme);
}

/** Canonical list of thinking-level options for UI dropdowns. */
export const THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

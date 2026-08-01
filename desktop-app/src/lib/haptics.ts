// Trackpad haptic feedback for agent turn cues and UI gestures.
//
// Ported from Hermes' desktop haptics lib. The haptic engine (web-haptics)
// synthesises clicks via WebAudio, so it works in the Tauri webview on macOS
// trackpads — no navigator.vibrate needed. The actual trigger is registered by
// HapticsProvider (see components/haptics-provider.tsx) once web-haptics is
// ready; triggerHaptic() is a no-op until then or when the user mutes haptics.

import type { HapticInput, TriggerOptions } from "web-haptics";

import { useSettingsStore } from "../stores/settings-store";

export type HapticIntent =
	| "cancel"
	| "close"
	| "crisp"
	| "error"
	| "open"
	| "selection"
	| "streamDone"
	| "streamStart"
	| "submit"
	| "success"
	| "tap"
	| "warning";

interface HapticConfig {
	options?: TriggerOptions;
	pattern: HapticInput;
}

const airyTap = [{ duration: 16, intensity: 0.52 }];

const crispTap = [{ duration: 10, intensity: 0.92 }];

const friendlySuccess = [
	{ duration: 28, intensity: 0.5 },
	{ delay: 42, duration: 30, intensity: 0.68 },
	{ delay: 48, duration: 38, intensity: 0.86 },
];

const softArrive = [
	{ duration: 18, intensity: 0.42 },
	{ delay: 36, duration: 22, intensity: 0.66 },
];

const softLeave = [
	{ duration: 22, intensity: 0.58 },
	{ delay: 32, duration: 16, intensity: 0.34 },
];

const HAPTIC_INTENTS: Record<HapticIntent, HapticConfig> = {
	cancel: {
		pattern: [
			{ duration: 34, intensity: 0.72 },
			{ delay: 54, duration: 26, intensity: 0.38 },
		],
	},
	close: { pattern: softLeave },
	crisp: { pattern: crispTap },
	error: {
		pattern: [
			{ duration: 34, intensity: 0.82 },
			{ delay: 42, duration: 34, intensity: 0.72 },
			{ delay: 58, duration: 44, intensity: 0.86 },
		],
	},
	open: { pattern: softArrive },
	selection: { pattern: airyTap },
	streamDone: { pattern: friendlySuccess },
	streamStart: { pattern: [{ duration: 10, intensity: 0.32 }] },
	submit: {
		pattern: [
			{ duration: 24, intensity: 0.58 },
			{ delay: 48, duration: 36, intensity: 0.82 },
		],
	},
	success: { pattern: friendlySuccess },
	tap: {
		pattern: [
			{ duration: 14, intensity: 0.58 },
			{ delay: 30, duration: 12, intensity: 0.42 },
		],
	},
	warning: {
		pattern: [
			{ duration: 34, intensity: 0.64 },
			{ delay: 84, duration: 42, intensity: 0.5 },
		],
	},
};

export type HapticTrigger = (input?: HapticInput, options?: TriggerOptions) => Promise<void> | undefined;

let registeredTrigger: HapticTrigger | null = null;
let lastSelectionAt = 0;

// Global rolling rate-limit. A runaway upstream loop (auth-expiry error-toast
// storms, reconnect flaps) can request dozens of haptics a second, which the
// trackpad actuator renders as a frantic "clickity" buzz. Cap firings to
// RATE_LIMIT per RATE_WINDOW so no source can machine-gun the actuator;
// intentional UI haptics are human-paced and never approach the ceiling.
const RATE_WINDOW = 1000;
const RATE_LIMIT = 5;
let recentFires: number[] = [];

export function registerHapticTrigger(trigger: HapticTrigger | null) {
	registeredTrigger = trigger;
}

export function triggerHaptic(intent: HapticIntent = "selection") {
	if (!useSettingsStore.getState().hapticsEnabled || !registeredTrigger) {
		return;
	}

	const now = performance.now();

	if (intent === "selection") {
		if (now - lastSelectionAt < 50) {
			return;
		}

		lastSelectionAt = now;
	}

	recentFires = recentFires.filter((t) => now - t < RATE_WINDOW);

	if (recentFires.length >= RATE_LIMIT) {
		return;
	}

	recentFires.push(now);

	const config = HAPTIC_INTENTS[intent];

	void registeredTrigger(config.pattern, config.options)?.catch(() => undefined);
}

// Audition a haptic from settings. Bypasses the enable toggle and the
// rate-limit so a cue can be felt even when haptics are switched off — handy
// while deciding whether to turn them on. No-op until a trigger is registered.
export function previewHaptic(intent: HapticIntent = "streamDone") {
	if (!registeredTrigger) {
		return;
	}

	const config = HAPTIC_INTENTS[intent];

	void registeredTrigger(config.pattern, config.options)?.catch(() => undefined);
}
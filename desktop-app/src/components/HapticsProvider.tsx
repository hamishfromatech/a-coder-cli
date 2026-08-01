import { type ReactNode, useEffect } from "react";
import { useWebHaptics } from "web-haptics/react";

import { registerHapticTrigger } from "../lib/haptics";
import { useSettingsStore } from "../stores/settings-store";

/**
 * Wires the web-haptics engine to triggerHaptic(). Mount once near the app
 * root. When the user switches haptics off we unregister the trigger so
 * triggerHaptic() becomes a no-op without each call site re-checking the store.
 *
 * `debug` is misleadingly named: on desktop webviews (macOS Tauri/WKWebView)
 * `navigator.vibrate` is unavailable, so web-haptics falls back to a
 * WebAudio-synthesised click sound — and that audio path (the `AudioContext`
 * plus `playClick()`) only initialises when `debug` is true. With it false the
 * fallback just `.click()`s a hidden label, which is inaudible and
 * haptic-less. So it must stay on for the click sound to fire.
 */
export function HapticsProvider({ children }: { children: ReactNode }) {
	const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
	const { trigger } = useWebHaptics({ debug: true, showSwitch: false });

	useEffect(() => {
		registerHapticTrigger(hapticsEnabled ? trigger : null);

		return () => registerHapticTrigger(null);
	}, [hapticsEnabled, trigger]);

	// web-haptics builds its AudioContext lazily inside the first trigger(), and
	// the process's first AudioContext pays the CoreAudio spin-up (~850ms stall
	// in profiles) — which would land on the first streamStart haptic as the
	// first token painted. Open/close a throwaway context at idle so the real
	// one connects to an already-warm audio service in single-digit ms.
	useEffect(() => {
		if (typeof requestIdleCallback !== "function" || typeof AudioContext === "undefined") {
			return undefined;
		}

		const id = requestIdleCallback(
			() => {
				try {
					void new AudioContext().close().catch(() => undefined);
				} catch {
					// No audio device (headless CI) — nothing to warm.
				}
			},
			{ timeout: 2000 },
		);

		return () => cancelIdleCallback(id);
	}, []);

	return <>{children}</>;
}

export default HapticsProvider;
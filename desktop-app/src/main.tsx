import { invoke } from "@tauri-apps/api/core";
import React from "react";

// Debug aid: capture renderer fatals before the window goes dark.
window.addEventListener("error", (e) => {
	void invoke("debug_log", {
		line: `${new Date().toISOString()} ERROR ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`,
	}).catch(() => {});
});
window.addEventListener("unhandledrejection", (e) => {
	void invoke("debug_log", {
		line: `${new Date().toISOString()} REJECTION ${String(e.reason).slice(0, 500)}`,
	}).catch(() => {});
});

import ReactDOM from "react-dom/client";
import App from "./App";
import { HudShell } from "./components/hud/HudShell";
import { isHudWindow } from "./lib/hud";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HapticsProvider } from "./components/HapticsProvider";
import { primeAudio } from "./lib/completion-sound";
import "./index.css";

// Desktop webviews (Tauri/WKWebView) gate AudioContext playback on a user
// gesture. Prime audio on the first click/key anywhere in the app so
// completion chimes, haptics, and voice playback can fire subsequently.
const primeAudioOnce = () => {
	primeAudio();
};
document.addEventListener("pointerdown", primeAudioOnce, { capture: true, once: true });
document.addEventListener("keydown", primeAudioOnce, { capture: true, once: true });
// Also listen for the custom event fired by triggerHaptic/previewHaptic so a
// haptic can prime audio even if no pointer/key gesture has happened yet.
document.addEventListener("a-coder:prime-audio", primeAudioOnce, { once: true });

const mount = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
// HUD mode mounts a chrome-free surface in its own window; everything else is
// the regular app.
if (isHudWindow()) {
	mount.render(
		<React.StrictMode>
			<ErrorBoundary label="hud">
				<HudShell />
			</ErrorBoundary>
		</React.StrictMode>,
	);
} else {
	mount.render(
		<React.StrictMode>
			<ErrorBoundary label="app">
				<HapticsProvider>
					<App />
				</HapticsProvider>
			</ErrorBoundary>
		</React.StrictMode>,
	);
}

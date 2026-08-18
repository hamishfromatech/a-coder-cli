import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<HapticsProvider>
			<App />
		</HapticsProvider>
	</React.StrictMode>,
);

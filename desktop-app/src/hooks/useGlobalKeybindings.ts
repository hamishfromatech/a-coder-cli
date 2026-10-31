import { useEffect } from "react";

import { backgroundRunningBash } from "../lib/bash-background";
import { useSessionStore } from "../stores/session-store";

/** Global shortcuts that mirror a-coder-cli keybindings. */
export function useGlobalKeybindings(): void {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if (!mod) return;
			// Editors (Monaco) and surfaces that own a shortcut preventDefault it;
			// don't double-handle those.
			if (e.defaultPrevented) return;

			// Cmd/Ctrl+Shift+O — resume a different session (quick-switcher).
			if (e.shiftKey && e.key.toLowerCase() === "o") {
				e.preventDefault();
				window.dispatchEvent(new CustomEvent("a-coder:open-resume"));
				return;
			}

			// Cmd/Ctrl+Shift+T — reopen last closed tab.
			if (e.shiftKey && e.key.toLowerCase() === "t") {
				e.preventDefault();
				window.dispatchEvent(new CustomEvent("a-coder:reopen-closed-tab"));
				return;
			}

			// Cmd/Ctrl+Shift+H — open home dashboard.
			if (e.shiftKey && e.key.toLowerCase() === "h") {
				e.preventDefault();
				window.dispatchEvent(new CustomEvent("a-coder:open-home"));
				return;
			}

			switch (e.key.toLowerCase()) {
				case ",":
					e.preventDefault();
					window.dispatchEvent(new CustomEvent("a-coder:open-settings"));
					break;
				case "p":
					e.preventDefault();
					window.dispatchEvent(new CustomEvent("a-coder:open-model-picker"));
					break;
				case "f":
					// Cmd/Ctrl+F — find in page.
					e.preventDefault();
					window.dispatchEvent(new CustomEvent("a-coder:find-in-page"));
					break;
				case "k":
					// Cmd/Ctrl+K — command palette.
					e.preventDefault();
					window.dispatchEvent(new CustomEvent("a-coder:command-palette"));
					break;
				case "b":
					// Ctrl+B — background the running bash command (CLI parity).
					// Only fires while the agent is streaming so stray shortcuts
					// don't toast at idle.
					if (!useSessionStore.getState().isStreaming) break;
					e.preventDefault();
					void backgroundRunningBash();
					break;
					// Other shortcuts are handled by native menus / commandRouter.
			}
		};

		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);
}

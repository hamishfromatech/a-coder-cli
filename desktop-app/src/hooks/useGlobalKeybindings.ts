import { useEffect } from "react";

/** Global shortcuts that mirror a-coder-cli keybindings. */
export function useGlobalKeybindings(): void {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if (!mod) return;

			// Cmd/Ctrl+Shift+O — resume a different session (quick-switcher).
			if (e.shiftKey && e.key.toLowerCase() === "o") {
				e.preventDefault();
				window.dispatchEvent(new CustomEvent("a-coder:open-resume"));
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
					// Other shortcuts are handled by native menus / commandRouter.
			}
		};

		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);
}

import { useDarkMode } from "../../../hooks/useDarkMode";

// Tracks the app's dark/light mode off the `dark` class on <html>. Embeds that
// theme their own content (tweets) read this.
export function useIsDark(): boolean {
	return useDarkMode();
}
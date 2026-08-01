import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
	const observer = new MutationObserver(() => callback());
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
	return () => observer.disconnect();
}

function getSnapshot() {
	return document.documentElement.classList.contains("dark");
}

function getServerSnapshot() {
	return false;
}

/** Returns true when the document root currently has the `dark` class. */
export function useDarkMode(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

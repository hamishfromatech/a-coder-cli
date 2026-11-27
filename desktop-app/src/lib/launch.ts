import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * A folder handed to the running app by the OS (Finder / Explorer "Open with
 * A-Coder Desktop", or a second launch whose path the single-instance plugin
 * forwarded). Fresh launches resolve theirs before boot via
 * `getInitialWorkspace`.
 */
export function onOpenWorkspace(handler: (path: string) => void): Promise<UnlistenFn> {
	return listen<string>("desktop://open-workspace", (event) => handler(event.payload));
}

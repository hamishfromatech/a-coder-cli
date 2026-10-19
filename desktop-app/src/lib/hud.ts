/**
 * HUD mode — the chrome-free floating chat.
 *
 * A transparent, frameless, always-on-top window showing the real transcript
 * and the real Composer (same components as the main window — no lookalike
 * drift), so A-Coder can be driven while the user works in another app.
 *
 * The window mounts the same frontend with `?win=hud`; src/main.tsx swaps
 * App for HudShell when that flag is present. All event plumbing is shared:
 * the engine's `rpc://event` stream is emitted to every webview window, and
 * custom app commands (send_command etc.) are callable from any window.
 */

import { getCurrentWindow, Effect } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "../stores/toast-store";

export const HUD_WINDOW_LABEL = "hud";

/** True inside the HUD renderer itself (the `?win=hud` query entry point). */
export function isHudWindow(): boolean {
	if (typeof window === "undefined") return false;
	return new URLSearchParams(window.location.search).get("win") === "hud";
}

/** Toggle the HUD from the tray/menu. */
export async function toggleHud(): Promise<void> {
	try {
		const existing = await WebviewWindow.getByLabel(HUD_WINDOW_LABEL);
		if (existing) {
			await existing.close().catch(() => undefined);
			return;
		}
		await openHud();
	} catch (e) {
		toast.error("HUD failed", e instanceof Error ? e.message : String(e));
	}
}

/** Open the HUD floating-chat window, or focus it when it is already up. */
export async function openHud(): Promise<void> {
	try {
		const existing = await WebviewWindow.getByLabel(HUD_WINDOW_LABEL);
		if (existing) {
			await existing.show().catch(() => undefined);
			await existing.setFocus().catch(() => undefined);
			return;
		}

		const current = getCurrentWindow();
		// Default to bottom-center over the invoking window's current screen so
		// the band lands where the eye already is; the user drags it anywhere.
		const scale = await current.scaleFactor().catch(() => 1);
		const pos = await current.innerPosition().catch(() => null);
		const size = await current.innerSize().catch(() => null);
		const width = 680;
		const height = 420;
		let x: number | undefined;
		let y: number | undefined;
		if (pos && size) {
			x = Math.round(pos.x + (size.width / scale - width) / 2);
			y = Math.round(pos.y + size.height / scale - height - 48);
		}

		const hud = new WebviewWindow(HUD_WINDOW_LABEL, {
			url: "index.html?win=hud",
			title: "A-Coder HUD",
			width,
			height,
			minWidth: 380,
			minHeight: 160,
			...(x !== undefined ? { x, y } : { center: true }),
			transparent: true,
			decorations: false,
			alwaysOnTop: true,
			// macOS vibrancy behind the band; ignored on Windows/Linux.
			windowEffects: { effects: [Effect.HudWindow] },
			shadow: false,
			resizable: true,
			maximizable: false,
			minimizable: false,
			acceptFirstMouse: true,
		});

		hud.once("tauri://error", (e) => {
			const detail = typeof e.payload === "object" && e.payload && "message" in e.payload
				? String((e.payload as { message?: unknown }).message)
				: "Could not create the HUD window.";
			toast.error("HUD failed", detail);
		});
	} catch (e) {
		toast.error("HUD failed", e instanceof Error ? e.message : String(e));
	}
}
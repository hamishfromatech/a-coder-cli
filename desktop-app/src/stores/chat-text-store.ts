import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Conversation typography scale — a chat-only text multiplier.
 *
 * Window zoom scales everything (sidebar, settings, panes) and makes the
 * chrome unusable; people who want bigger message text usually want just that.
 * The transcript's font sizes derive from `--chat-text-scale`, applied to the
 * document root here, so every conversation surface follows while chrome
 * stays put.
 */

export const CHAT_TEXT_MIN = 0.85;
export const CHAT_TEXT_MAX = 1.4;
export const CHAT_TEXT_DEFAULT = 1.1;

const clamp = (value: number) =>
	Math.min(CHAT_TEXT_MAX, Math.max(CHAT_TEXT_MIN, Math.round(value * 100) / 100));

interface ChatTextState {
	scale: number;
	setScale: (scale: number) => void;
}

export const useChatTextStore = create<ChatTextState>()(
	persist(
		(set) => ({
			scale: CHAT_TEXT_DEFAULT,
			setScale: (scale) => set({ scale: clamp(scale) }),
		}),
		{ name: "a-coder.chatText" },
	),
);

/** Push the scale onto the document root (idempotent). */
export function applyChatTextScale(scale: number): void {
	document.documentElement.style.setProperty("--chat-text-scale", String(clamp(scale)));
}

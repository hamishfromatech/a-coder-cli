import { applySkinToRoot } from "./apply-theme";
import { DEFAULT_SKIN_NAME, isKnownSkin, SKIN_LIST } from "./theme-presets";
import { applyThemeToRoot, type Theme } from "../stores/settings-store";
import type { Skin } from "../stores/settings-store";

export { DEFAULT_SKIN_NAME, SKIN_LIST };
export type { Theme, Skin } from "../stores/settings-store";

export const NAMED_THEMES: Theme[] = ["system", "dark", "light"];

/** Normalize a stored skin name to a known skin, falling back to the default. */
export function normalizeSkin(name: string | undefined | null): Skin {
	return name && isKnownSkin(name) ? name : DEFAULT_SKIN_NAME;
}

/**
 * Apply a skin + named mode (light/dark/system) to the document root. Use from
 * the settings UI and the boot-time paint in App.
 */
export function applyNamedTheme(skin: Skin, theme: Theme): void {
	applyThemeToRoot(normalizeSkin(skin), theme);
}

/** Apply a skin directly (resolving `system` against the OS preference). */
export function applySkin(skin: Skin, theme: Theme): void {
	applySkinToRoot(normalizeSkin(skin), theme);
}
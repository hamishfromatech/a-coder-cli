import { describe, expect, it } from "vitest";
import { DEFAULT_SKIN_NAME, HERMES_THEMES, SKIN_LIST, isKnownSkin, resolveHermesTheme } from "./lib/theme-presets";

describe("built-in desktop skins", () => {
	it("has unique names and every registry name resolves", () => {
		const names = SKIN_LIST.map((s) => s.name);
		expect(new Set(names).size).toBe(names.length);
		for (const { name } of SKIN_LIST) {
			if (name === DEFAULT_SKIN_NAME) {
				expect(isKnownSkin(name)).toBe(true);
				continue;
			}
			expect(resolveHermesTheme(name), name).not.toBeNull();
		}
		expect(SKIN_LIST.length).toBe(1 + Object.keys(HERMES_THEMES).length);
	});

	it("new skins ship tuned palettes for both modes", () => {
		for (const name of ["nord", "dracula", "gruvbox", "catppuccin", "tokyo-night"]) {
			const skin = resolveHermesTheme(name);
			expect(skin, name).not.toBeNull();
			expect(skin?.darkColors, `${name} darkColors`).toBeTruthy();
		}
	});

	it("new skins keep text readable on their backgrounds in both modes", () => {
		for (const name of Object.keys(HERMES_THEMES)) {
			const skin = resolveHermesTheme(name)!;
			// Dark palette is `darkColors` when shipped, else the dark-only `colors`.
			const dark = skin.darkColors ?? skin.colors;
			expect(luma(dark.background), `${name} dark`).toBeLessThan(luma(dark.foreground));
			if (skin.darkColors) {
				expect(luma(skin.colors.background), `${name} light bg > fg`).toBeGreaterThan(luma(skin.colors.foreground));
			}
		}
	});
});

function luma(hex: string): number {
	const n = hex.replace("#", "");
	const rgb = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
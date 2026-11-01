import { describe, expect, it } from "vitest";
import { getSkinPalette } from "./lib/apply-theme";
import { SKIN_LIST } from "./lib/theme-presets";

/** WCAG relative-luminance contrast ratio for two #rrggbb colors. */
function luma(hex: string): number {
	const n = hex.replace("#", "");
	const channels = [0, 2, 4]
		.map((index) => Number.parseInt(n.slice(index, index + 2), 16) / 255)
		.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
	const [high, low] = luma(a) > luma(b) ? [luma(a), luma(b)] : [luma(b), luma(a)];
	return (high + 0.05) / (low + 0.05);
}

/** Palettes added in the theme expansion — held to the stricter bar. */
const NEW_SKINS = new Set([
	"graphite",
	"paper",
	"ocean",
	"contrast",
	"sakura",
	"sunset",
	"vaporwave",
	"forest",
	"clay",
	"blueprint",
	"neon-noir",
	"iris",
]);

describe("skin contrast", () => {
	for (const skin of SKIN_LIST) {
		for (const mode of ["light", "dark"] as const) {
			it(`${skin.name} (${mode}) is readable`, () => {
				const palette = getSkinPalette(skin.name, mode);
				const strict = NEW_SKINS.has(skin.name);
				expect(
					contrast(palette.text, palette.bg),
					`${skin.name} ${mode} text/bg`,
				).toBeGreaterThanOrEqual(strict ? 7 : 4.5);
				expect(
					contrast(palette.textSecondary, palette.surface),
					`${skin.name} ${mode} secondary/surface`,
				).toBeGreaterThanOrEqual(strict ? 4.5 : 3);
				expect(contrast(palette.error, palette.bg), `${skin.name} ${mode} error/bg`).toBeGreaterThanOrEqual(3);
				if (strict) {
					expect(contrast(palette.accent, palette.bg), `${skin.name} ${mode} accent/bg`).toBeGreaterThanOrEqual(3);
				}
			});
		}
	}
});

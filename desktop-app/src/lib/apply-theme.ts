/**
 * Skin application — maps a skin + light/dark mode onto the `--pi-*` CSS
 * custom properties consumed by `src/index.css` and the Tailwind `pi-*` tokens.
 *
 * The derived tokens (--pi-border, --pi-border-strong, --pi-accent-soft,
 * --pi-accent-ring, --pi-error-soft) are NOT set here: `index.css` defines them
 * via `color-mix()` on `--pi-accent` / `--pi-error`, so overriding the accent
 * (and toggling the `.light`/`.dark` class for the right mix percentages) is
 * enough for the whole token spine to re-derive.
 *
 * Hermes skins ship in the Hermes `DesktopTheme` shape (a flat color map, with
 * an optional hand-tuned dark variant). `colorsToPiPalette` converts that shape
 * into the richer `PiPalette` token set, deriving the semantic role + status
 * colors via `ensureContrast` so imported accents never collapse into a
 * near-background sidebar. `aurora` is authored directly as a `PiPalette` pair.
 */

import { ensureContrast, hexToTriplet, mix, readableOn } from "./theme-color";
import {
	AURORA,
	DEFAULT_TYPOGRAPHY,
	HERMES_THEMES,
	type DesktopTheme,
	type DesktopThemeColors,
	type PiPalette,
	type PiTypography,
} from "./theme-presets";

export type SkinMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

const INJECTED_FONT_URLS = new Set<string>();

/** Resolve a `system` mode preference to a concrete light/dark. */
export function resolveMode(mode: SkinMode, systemDark = prefersDark()): ResolvedMode {
	return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

function prefersDark(): boolean {
	return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// ─── Hermes → PiPalette conversion ─────────────────────────────────────────

/** Synthesise a light `DesktopThemeColors` variant for dark-only Hermes skins. */
function synthLightColors(seed: DesktopTheme): DesktopThemeColors {
	const accent = seed.colors.ring || seed.colors.primary;
	const soft = mix("#ffffff", accent, 0.1);
	const softer = mix("#ffffff", accent, 0.06);
	const border = mix("#ececef", accent, 0.14);
	const midground = seed.colors.midground ?? accent;

	return {
		background: "#ffffff",
		foreground: "#161616",
		card: "#ffffff",
		cardForeground: "#161616",
		muted: softer,
		mutedForeground: mix("#6b6b70", accent, 0.16),
		popover: "#ffffff",
		popoverForeground: "#161616",
		primary: accent,
		primaryForeground: readableOn(accent),
		secondary: soft,
		secondaryForeground: mix("#2a2a2a", accent, 0.34),
		accent: soft,
		accentForeground: mix("#2a2a2a", accent, 0.34),
		border,
		input: mix("#e2e2e6", accent, 0.18),
		ring: accent,
		midground,
		midgroundForeground: readableOn(midground),
		destructive: "#b94a3a",
		destructiveForeground: "#ffffff",
		sidebarBackground: mix("#fafafa", accent, 0.05),
		sidebarBorder: border,
		userBubble: soft,
		userBubbleBorder: border,
	};
}

/** Base Hermes color palette for a skin + mode (no overrides applied). */
function getBaseColors(skin: DesktopTheme, mode: ResolvedMode): DesktopThemeColors {
	if (mode === "dark") {
		return skin.darkColors ?? skin.colors;
	}
	return skin.darkColors ? skin.colors : synthLightColors(skin);
}

/** Convert a Hermes color map into the full `PiPalette` token set. */
function colorsToPiPalette(colors: DesktopThemeColors): PiPalette {
	const accent = colors.midground ?? colors.ring ?? colors.primary;
	const bg = flattenHex(colors.background);
	const fg = colors.foreground;

	return {
		bg,
		surface: flattenHex(colors.sidebarBackground ?? colors.card),
		surfaceRaised: flattenHex(colors.card),
		surfaceOverlay: flattenHex(colors.popover),
		text: colors.foreground,
		textSecondary: mix(colors.foreground, colors.mutedForeground, 0.5),
		textMuted: colors.mutedForeground,
		textFaint: mix(colors.mutedForeground, bg, 0.45),
		accent,
		accentHover: mix(accent, fg, 0.14),
		user: ensureContrast("#34d399", bg, 3),
		assistant: ensureContrast(accent, bg, 3),
		tool: ensureContrast("#a3a3ff", bg, 3),
		success: ensureContrast("#22c55e", bg, 3),
		warning: ensureContrast("#eab308", bg, 3),
		error: ensureContrast(colors.destructive, bg, 3),
	};
}

// ─── Palette resolution ─────────────────────────────────────────────────────

/**
 * Resolve the full `PiPalette` for a skin + resolved mode. Exported so the
 * settings UI can paint faithful previews without duplicating the conversion
 * math. Falls back to aurora when the skin name is unknown.
 */
export function getSkinPalette(skinName: string, mode: ResolvedMode): PiPalette {
	return getPalette(skinName, mode);
}

function getPalette(skinName: string, mode: ResolvedMode): PiPalette {
	if (skinName === "aurora") {
		return mode === "dark" ? AURORA.dark : AURORA.light;
	}
	const seed = HERMES_THEMES[skinName];
	if (seed) {
		return colorsToPiPalette(getBaseColors(seed, mode));
	}
	return mode === "dark" ? AURORA.dark : AURORA.light;
}

function getTypography(skinName: string): PiTypography {
	if (skinName === "aurora") {
		return AURORA.typography ?? {};
	}
	const seed = HERMES_THEMES[skinName];
	if (!seed?.typography) {
		return {};
	}
	const t = { ...DEFAULT_TYPOGRAPHY, ...seed.typography };
	return { fontSans: t.fontSans, fontMono: t.fontMono, fontUrl: t.fontUrl };
}

// ─── CSS application ────────────────────────────────────────────────────────

function injectFont(url: string | undefined): void {
	if (!url || typeof document === "undefined" || INJECTED_FONT_URLS.has(url)) {
		return;
	}
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = url;
	link.dataset.piThemeFont = "true";
	document.head.appendChild(link);
	INJECTED_FONT_URLS.add(url);
}

/**
 * Apply a skin + mode to the document root. Writes the `--pi-*-rgb` triplets
 * and `--pi-accent` inline, toggles the `.light`/`.dark` class (for color-scheme
 * and the class-keyed border/grain rules in index.css), and injects the skin's
 * font stylesheet if it ships one.
 */
export function applySkinToRoot(skinName: string, mode: SkinMode): ResolvedMode {
	if (typeof document === "undefined") {
		return "dark";
	}
	const resolved = resolveMode(mode);
	const palette = getPalette(skinName, resolved);
	const root = document.documentElement;

	root.classList.remove("dark", "light");
	root.classList.add(resolved);

	const setRgb = (token: string, hex: string) => root.style.setProperty(token, hexToTriplet(hex));

	setRgb("--pi-bg-rgb", palette.bg);
	setRgb("--pi-surface-rgb", palette.surface);
	setRgb("--pi-surface-raised-rgb", palette.surfaceRaised);
	setRgb("--pi-surface-overlay-rgb", palette.surfaceOverlay);
	setRgb("--pi-text-rgb", palette.text);
	setRgb("--pi-text-secondary-rgb", palette.textSecondary);
	setRgb("--pi-text-muted-rgb", palette.textMuted);
	setRgb("--pi-text-faint-rgb", palette.textFaint);
	setRgb("--pi-accent-rgb", palette.accent);
	setRgb("--pi-accent-hover-rgb", palette.accentHover);
	setRgb("--pi-user-rgb", palette.user);
	setRgb("--pi-assistant-rgb", palette.assistant);
	setRgb("--pi-tool-rgb", palette.tool);
	setRgb("--pi-success-rgb", palette.success);
	setRgb("--pi-warning-rgb", palette.warning);
	setRgb("--pi-error-rgb", palette.error);

	root.style.setProperty("color-scheme", resolved);
	root.dataset.piSkin = skinName;

	const typo = getTypography(skinName);
	if (typo.fontSans) {
		root.style.setProperty("--font-sans", typo.fontSans);
	} else {
		root.style.removeProperty("--font-sans");
	}
	if (typo.fontMono) {
		root.style.setProperty("--font-mono", typo.fontMono);
	} else {
		root.style.removeProperty("--font-mono");
	}
	injectFont(typo.fontUrl);

	return resolved;
}

/** Public palette for the theme picker's preview swatches. */
export function resolvePalette(skinName: string, mode: SkinMode): PiPalette {
	return getPalette(skinName, resolveMode(mode));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Flatten `color-mix(...)` or any non-`#rrggbb` color to a flat hex over a black
 * backdrop so `hexToTriplet` and the `mix`/`ensureContrast` math (which only
 * accept 6-digit hex) work on Hermes's `color-mix` border/muted values.
 */
function flattenHex(value: string): string {
	const trimmed = value.trim();
	if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
		return trimmed;
	}
	// Resolve via the live CSS engine: set it on a temp element and read the
	// computed value back as `rgb(r, g, b)`, then convert.
	if (typeof document !== "undefined") {
		const probe = document.createElement("span");
		probe.style.color = trimmed;
		probe.style.display = "none";
		document.body.appendChild(probe);
		const computed = getComputedStyle(probe).color;
		probe.remove();
		const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (m) {
			return `#${[m[1], m[2], m[3]]
				.map((n) => Number(n).toString(16).padStart(2, "0"))
				.join("")}`;
		}
	}
	return "#000000";
}
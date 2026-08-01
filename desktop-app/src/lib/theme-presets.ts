/**
 * Built-in desktop skins.
 *
 * `aurora` is the canonical a-coder desktop identity — neutral glass chrome with
 * a Nous-blue accent — and is the default. The remaining six skins (`nous`,
 * `midnight`, `ember`, `mono`, `cyberpunk`, `slate`) are ported verbatim from
 * the Hermes desktop theme system (hermes-agent/apps/desktop/src/themes/presets.ts)
 * so the a-coder desktop inherits Hermes's palette work.
 *
 * Hermes skins are authored in the Hermes `DesktopTheme` shape (a flat color
 * map + optional hand-tuned dark variant). `apply-theme.ts` converts those into
 * the `PiPalette` token set the a-coder CSS consumes. `aurora` is authored
 * directly as a `PiPalette` pair since it already carries the richer token set
 * (four surface levels, four text levels, semantic role + status colors).
 */

// ─── Hermes theme model (ported from hermes-agent) ─────────────────────────

export interface DesktopThemeColors {
	background: string;
	foreground: string;
	card: string;
	cardForeground: string;
	muted: string;
	mutedForeground: string;
	popover: string;
	popoverForeground: string;
	primary: string;
	primaryForeground: string;
	secondary: string;
	secondaryForeground: string;
	accent: string;
	accentForeground: string;
	border: string;
	input: string;
	/** Generic focus ring — buttons, inputs, etc. */
	ring: string;
	/** Brand-accent stroke; falls back to `ring`. */
	midground?: string;
	/** Auto-derived from `midground` luminance when omitted. */
	midgroundForeground?: string;
	/** Composer outline / focus color. Falls back to `midground`. */
	composerRing?: string;
	destructive: string;
	destructiveForeground: string;
	sidebarBackground?: string;
	sidebarBorder?: string;
	userBubble?: string;
	userBubbleBorder?: string;
}

export interface DesktopThemeTypography {
	fontSans: string;
	fontMono: string;
	/** Google/Bunny/self-hosted font stylesheet URL. */
	fontUrl?: string;
}

export interface DesktopTheme {
	name: string;
	label: string;
	description: string;
	/** Light palette (also reused for dark when `darkColors` is omitted). */
	colors: DesktopThemeColors;
	/** Hand-tuned dark palette. Skins like `nous` ship one. */
	darkColors?: DesktopThemeColors;
	typography?: Partial<DesktopThemeTypography>;
}

// ─── a-coder pi token palette ──────────────────────────────────────────────
// Hex strings consumed by `applySkinToRoot`; the derived tokens (--pi-border,
// --pi-accent-soft, --pi-accent-ring, --pi-error-soft) auto-derive in index.css
// via color-mix on --pi-accent / --pi-error, so they aren't stored here.

export interface PiPalette {
	bg: string;
	surface: string;
	surfaceRaised: string;
	surfaceOverlay: string;
	text: string;
	textSecondary: string;
	textMuted: string;
	textFaint: string;
	accent: string;
	accentHover: string;
	user: string;
	assistant: string;
	tool: string;
	success: string;
	warning: string;
	error: string;
}

export interface PiTypography {
	fontSans?: string;
	fontMono?: string;
	fontUrl?: string;
}

// ─── Typography stacks ─────────────────────────────────────────────────────

export const EMOJI_FALLBACK =
	'"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji';

const SYSTEM_SANS =
	'"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif, ' +
	EMOJI_FALLBACK;

const SYSTEM_MONO =
	'"Cascadia Code", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace, ' + EMOJI_FALLBACK;

export const DEFAULT_TYPOGRAPHY: DesktopThemeTypography = {
	fontSans: SYSTEM_SANS,
	fontMono: SYSTEM_MONO,
};

// ─── Aurora — the a-coder default (current neutral-glass + Nous-blue) ──────
// Values mirror src/index.css `:root` (dark) and `.light` so selecting aurora
// reproduces the pre-skin look exactly, and so the no-JS first paint already
// matches the default skin.

const AURORA_DARK: PiPalette = {
	bg: "#0a0a0c",
	surface: "#0e0e11",
	surfaceRaised: "#16161b",
	surfaceOverlay: "#1c1c22",
	text: "#e8e9ee",
	textSecondary: "#a8acb8",
	textMuted: "#6f7380",
	textFaint: "#484b56",
	accent: "#2e7fff",
	accentHover: "#4a95ff",
	user: "#7fd1a0",
	assistant: "#2e7fff",
	tool: "#a3a3ff",
	success: "#3fb98f",
	warning: "#eab308",
	error: "#f05656",
};

const AURORA_LIGHT: PiPalette = {
	bg: "#f6f6f8",
	surface: "#ffffff",
	surfaceRaised: "#f1f1f4",
	surfaceOverlay: "#ffffff",
	text: "#1a1b22",
	textSecondary: "#44474f",
	textMuted: "#71747c",
	textFaint: "#a8aab3",
	accent: "#0053fd",
	accentHover: "#0040cc",
	user: "#1a8e69",
	assistant: "#0053fd",
	tool: "#6366f1",
	success: "#16a36e",
	warning: "#ca8a04",
	error: "#dc2626",
};

export const AURORA: { dark: PiPalette; light: PiPalette; typography?: PiTypography } = {
	dark: AURORA_DARK,
	light: AURORA_LIGHT,
};

// ─── Hermes skins (ported verbatim) ────────────────────────────────────────

const NOUS_BLUE = "#0053FD";
const PSYCHE_BLUE = "#1540B1";
const PSYCHE_WARM = "#FFE6CB";

const nousTint = (pct: number) => `color-mix(in srgb, ${NOUS_BLUE} ${pct}%, #FFFFFF)`;
const nousTintTransparent = (pct: number) => `color-mix(in srgb, ${NOUS_BLUE} ${pct}%, transparent)`;

export const nousTheme: DesktopTheme = {
	name: "nous",
	label: "Nous",
	description: "Glass neutrals with Nous blue accents",
	colors: {
		background: "#F8FAFF",
		foreground: "#17171A",
		card: "#FFFFFF",
		cardForeground: "#17171A",
		muted: nousTint(5),
		mutedForeground: "#666678",
		popover: "#FFFFFF",
		popoverForeground: "#17171A",
		primary: NOUS_BLUE,
		primaryForeground: "#FCFCFC",
		secondary: nousTint(7),
		secondaryForeground: "#242432",
		accent: nousTint(10),
		accentForeground: "#202030",
		border: nousTintTransparent(22),
		input: nousTintTransparent(30),
		ring: NOUS_BLUE,
		midground: NOUS_BLUE,
		composerRing: NOUS_BLUE,
		destructive: "#C72E4D",
		destructiveForeground: "#FFFFFF",
		sidebarBackground: "#F3F7FF",
		sidebarBorder: nousTintTransparent(18),
		userBubble: nousTint(6),
		userBubbleBorder: nousTintTransparent(24),
	},
	darkColors: {
		background: "#0D2F86",
		foreground: PSYCHE_WARM,
		card: "#12378F",
		cardForeground: PSYCHE_WARM,
		muted: "#183F9A",
		mutedForeground: "#B5C7F3",
		popover: "#123A96",
		popoverForeground: PSYCHE_WARM,
		primary: PSYCHE_WARM,
		primaryForeground: "#0D2F86",
		secondary: "#1B45A4",
		secondaryForeground: "#E0E8FF",
		accent: PSYCHE_BLUE,
		accentForeground: "#F0F4FF",
		border: "#3158AD",
		input: "#0B2566",
		ring: PSYCHE_WARM,
		midground: NOUS_BLUE,
		composerRing: PSYCHE_WARM,
		destructive: "#C0473A",
		destructiveForeground: "#FEF2F2",
		sidebarBackground: "#09286F",
		sidebarBorder: "#234A9C",
		userBubble: "#143B91",
		userBubbleBorder: "#3A63BD",
	},
	typography: {
		fontSans: SYSTEM_SANS,
		fontMono: `"Courier Prime", ${SYSTEM_MONO}`,
		fontUrl: "https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap",
	},
};

export const midnightTheme: DesktopTheme = {
	name: "midnight",
	label: "Midnight",
	description: "Deep blue-violet with cool accents",
	colors: {
		background: "#08081c",
		foreground: "#ddd6ff",
		card: "#0d0d28",
		cardForeground: "#ddd6ff",
		muted: "#13133a",
		mutedForeground: "#7c7ab0",
		popover: "#0f0f2e",
		popoverForeground: "#ddd6ff",
		primary: "#ddd6ff",
		primaryForeground: "#08081c",
		secondary: "#1a1a4a",
		secondaryForeground: "#c4bff0",
		accent: "#1a1a44",
		accentForeground: "#d0c8ff",
		border: "#1e1e52",
		input: "#1e1e52",
		ring: "#8b80e8",
		midground: "#8b80e8",
		destructive: "#b03060",
		destructiveForeground: "#fef2f2",
		sidebarBackground: "#06061a",
		sidebarBorder: "#12123a",
		userBubble: "#14143a",
		userBubbleBorder: "#242466",
	},
	typography: {
		fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`,
		fontUrl: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap",
	},
};

export const emberTheme: DesktopTheme = {
	name: "ember",
	label: "Ember",
	description: "Warm crimson and bronze — forge vibes",
	colors: {
		background: "#160800",
		foreground: "#ffd8b0",
		card: "#1e0e04",
		cardForeground: "#ffd8b0",
		muted: "#2a1408",
		mutedForeground: "#aa7a56",
		popover: "#221008",
		popoverForeground: "#ffd8b0",
		primary: "#ffd8b0",
		primaryForeground: "#160800",
		secondary: "#341800",
		secondaryForeground: "#f0c090",
		accent: "#301600",
		accentForeground: "#e8c080",
		border: "#3a1c08",
		input: "#3a1c08",
		ring: "#d97316",
		midground: "#d97316",
		destructive: "#c43010",
		destructiveForeground: "#fef2f2",
		sidebarBackground: "#100600",
		sidebarBorder: "#2a1004",
		userBubble: "#2a1000",
		userBubbleBorder: "#4a2010",
	},
	typography: {
		fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
		fontUrl: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap",
	},
};

export const monoTheme: DesktopTheme = {
	name: "mono",
	label: "Mono",
	description: "Clean grayscale — minimal and focused",
	colors: {
		background: "#0e0e0e",
		foreground: "#eaeaea",
		card: "#141414",
		cardForeground: "#eaeaea",
		muted: "#1e1e1e",
		mutedForeground: "#808080",
		popover: "#181818",
		popoverForeground: "#eaeaea",
		primary: "#eaeaea",
		primaryForeground: "#0e0e0e",
		secondary: "#262626",
		secondaryForeground: "#c8c8c8",
		accent: "#222222",
		accentForeground: "#d8d8d8",
		border: "#2a2a2a",
		input: "#2a2a2a",
		ring: "#9a9a9a",
		midground: "#9a9a9a",
		destructive: "#a84040",
		destructiveForeground: "#fef2f2",
		sidebarBackground: "#0a0a0a",
		sidebarBorder: "#202020",
		userBubble: "#1a1a1a",
		userBubbleBorder: "#363636",
	},
};

export const cyberpunkTheme: DesktopTheme = {
	name: "cyberpunk",
	label: "Cyberpunk",
	description: "Neon green on black — matrix terminal",
	colors: {
		background: "#000a00",
		foreground: "#00ff41",
		card: "#001200",
		cardForeground: "#00ff41",
		muted: "#001a00",
		mutedForeground: "#1a8a30",
		popover: "#001000",
		popoverForeground: "#00ff41",
		primary: "#00ff41",
		primaryForeground: "#000a00",
		secondary: "#002800",
		secondaryForeground: "#00cc34",
		accent: "#002000",
		accentForeground: "#00e038",
		border: "#003000",
		input: "#003000",
		ring: "#00ff41",
		midground: "#00ff41",
		destructive: "#ff003c",
		destructiveForeground: "#000a00",
		sidebarBackground: "#000600",
		sidebarBorder: "#001800",
		userBubble: "#001400",
		userBubbleBorder: "#004800",
	},
	typography: {
		fontMono: `"Courier New", Courier, monospace, ${EMOJI_FALLBACK}`,
		fontSans: `"Courier New", Courier, monospace, ${EMOJI_FALLBACK}`,
	},
};

export const slateTheme: DesktopTheme = {
	name: "slate",
	label: "Slate",
	description: "Cool slate blue — focused developer theme",
	colors: {
		background: "#0d1117",
		foreground: "#c9d1d9",
		card: "#161b22",
		cardForeground: "#c9d1d9",
		muted: "#21262d",
		mutedForeground: "#8b949e",
		popover: "#1c2128",
		popoverForeground: "#c9d1d9",
		primary: "#c9d1d9",
		primaryForeground: "#0d1117",
		secondary: "#2a3038",
		secondaryForeground: "#adb5bf",
		accent: "#1e2530",
		accentForeground: "#c0c8d0",
		border: "#30363d",
		input: "#30363d",
		ring: "#58a6ff",
		midground: "#58a6ff",
		destructive: "#cf4848",
		destructiveForeground: "#fef2f2",
		sidebarBackground: "#090d13",
		sidebarBorder: "#1c2228",
		userBubble: "#1e2a38",
		userBubbleBorder: "#2e4060",
	},
	typography: {
		fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`,
	},
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const HERMES_THEMES: Record<string, DesktopTheme> = {
	nous: nousTheme,
	midnight: midnightTheme,
	ember: emberTheme,
	mono: monoTheme,
	cyberpunk: cyberpunkTheme,
	slate: slateTheme,
};

export interface SkinMeta {
	name: string;
	label: string;
	description: string;
}

const AURORA_META: SkinMeta = {
	name: "aurora",
	label: "Aurora",
	description: "Neutral glass with Nous-blue accent — the a-coder default",
};

export const SKIN_LIST: SkinMeta[] = [
	AURORA_META,
	...Object.values(HERMES_THEMES).map(({ name, label, description }) => ({ name, label, description })),
];

/** Skin used when nothing is persisted or the persisted name is retired. */
export const DEFAULT_SKIN_NAME = "aurora";

export function resolveHermesTheme(name: string): DesktopTheme | null {
	return HERMES_THEMES[name] ?? null;
}

export function isKnownSkin(name: string): boolean {
	return name === "aurora" || name in HERMES_THEMES;
}
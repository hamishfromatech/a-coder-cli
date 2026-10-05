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

// ─── a-coder color-family skins (hand-tuned light + dark) ────────────────

export const nordTheme: DesktopTheme = {
	name: "nord",
	label: "Nord",
	description: "Cool polar-night blues with frost accents",
	colors: {
		background: "#eceff4",
		foreground: "#2e3440",
		card: "#f2f4f8",
		cardForeground: "#2e3440",
		muted: "#e2e7ef",
		mutedForeground: "#5c6a7d",
		popover: "#ffffff",
		popoverForeground: "#2e3440",
		primary: "#5e81ac",
		primaryForeground: "#ffffff",
		secondary: "#dde4ee",
		secondaryForeground: "#4c566a",
		accent: "#dfe6f0",
		accentForeground: "#3b4252",
		border: "#d5dce8",
		input: "#d5dce8",
		ring: "#5e81ac",
		midground: "#5e81ac",
		destructive: "#bf616a",
		destructiveForeground: "#ffffff",
		sidebarBackground: "#e6eaf2",
		sidebarBorder: "#d8dee9",
		userBubble: "#e0e7f2",
		userBubbleBorder: "#c8d3e4",
	},
	darkColors: {
		background: "#2e3440",
		foreground: "#d8dee9",
		card: "#353c4a",
		cardForeground: "#d8dee9",
		muted: "#3b4252",
		mutedForeground: "#8fa1b3",
		popover: "#3b4252",
		popoverForeground: "#d8dee9",
		primary: "#88c0d0",
		primaryForeground: "#2e3440",
		secondary: "#434c5e",
		secondaryForeground: "#c8d1e0",
		accent: "#3f4a5e",
		accentForeground: "#d5dde9",
		border: "#434c5e",
		input: "#4c566a",
		ring: "#88c0d0",
		midground: "#81a1c1",
		destructive: "#bf616a",
		destructiveForeground: "#eceff4",
		sidebarBackground: "#272c36",
		sidebarBorder: "#3b4252",
		userBubble: "#3d4555",
		userBubbleBorder: "#505d72",
	},
};

export const draculaTheme: DesktopTheme = {
	name: "dracula",
	label: "Dracula",
	description: "Classic purple prose — violet, pink, and cyan on midnight",
	colors: {
		background: "#f6f5fb",
		foreground: "#3c3a52",
		card: "#fbfaff",
		cardForeground: "#3c3a52",
		muted: "#eae6f7",
		mutedForeground: "#6f6a90",
		popover: "#ffffff",
		popoverForeground: "#3c3a52",
		primary: "#7c4dff",
		primaryForeground: "#ffffff",
		secondary: "#e8e2fa",
		secondaryForeground: "#4a4568",
		accent: "#ece7fa",
		accentForeground: "#453d66",
		border: "#ddd8ee",
		input: "#ddd8ee",
		ring: "#a269ff",
		midground: "#7c4dff",
		destructive: "#d33a6c",
		destructiveForeground: "#ffffff",
		sidebarBackground: "#efedf8",
		sidebarBorder: "#dedaf0",
		userBubble: "#ece5fb",
		userBubbleBorder: "#d8cdf5",
	},
	darkColors: {
		background: "#282a36",
		foreground: "#f8f8f2",
		card: "#2f313f",
		cardForeground: "#f8f8f2",
		muted: "#343746",
		mutedForeground: "#9aa0bd",
		popover: "#343746",
		popoverForeground: "#f8f8f2",
		primary: "#bd93f9",
		primaryForeground: "#282a36",
		secondary: "#3e4152",
		secondaryForeground: "#e0dffa",
		accent: "#3d3a52",
		accentForeground: "#e6dcff",
		border: "#44475a",
		input: "#4a4e63",
		ring: "#bd93f9",
		midground: "#bd93f9",
		destructive: "#ff5555",
		destructiveForeground: "#f8f8f2",
		sidebarBackground: "#22242e",
		sidebarBorder: "#343746",
		userBubble: "#3b3550",
		userBubbleBorder: "#524a70",
	},
};

export const gruvboxTheme: DesktopTheme = {
	name: "gruvbox",
	label: "Gruvbox",
	description: "Warm retro groove — sand paper, forest greens, burnt orange",
	colors: {
		background: "#fbf1c7",
		foreground: "#3c3836",
		card: "#f9ecc0",
		cardForeground: "#3c3836",
		muted: "#efe2b8",
		mutedForeground: "#7c6f64",
		popover: "#fdf6e0",
		popoverForeground: "#3c3836",
		primary: "#b57614",
		primaryForeground: "#fbf1c7",
		secondary: "#eee0af",
		secondaryForeground: "#504945",
		accent: "#ecdfa9",
		accentForeground: "#504945",
		border: "#e2d4a8",
		input: "#e2d4a8",
		ring: "#d65d0e",
		midground: "#d65d0e",
		destructive: "#9d0006",
		destructiveForeground: "#fbf1c7",
		sidebarBackground: "#f4e9bc",
		sidebarBorder: "#e6d8ac",
		userBubble: "#eee0af",
		userBubbleBorder: "#dcc894",
	},
	darkColors: {
		background: "#282828",
		foreground: "#ebdbb2",
		card: "#2e2c29",
		cardForeground: "#ebdbb2",
		muted: "#3c3836",
		mutedForeground: "#bdae93",
		popover: "#32302c",
		popoverForeground: "#ebdbb2",
		primary: "#fe8019",
		primaryForeground: "#282828",
		secondary: "#45403d",
		secondaryForeground: "#d5c4a1",
		accent: "#453d33",
		accentForeground: "#e8d9bd",
		border: "#3c3836",
		input: "#504945",
		ring: "#fe8019",
		midground: "#fe8019",
		destructive: "#fb4934",
		destructiveForeground: "#282828",
		sidebarBackground: "#232323",
		sidebarBorder: "#32302c",
		userBubble: "#44392c",
		userBubbleBorder: "#5f5245",
	},
};

export const catppuccinTheme: DesktopTheme = {
	name: "catppuccin",
	label: "Catppuccin",
	description: "Soothing pastel — Latte by day, Mocha by night",
	colors: {
		background: "#eff1f5",
		foreground: "#4c4f69",
		card: "#f5f6fa",
		cardForeground: "#4c4f69",
		muted: "#dde2ec",
		mutedForeground: "#6c6f85",
		popover: "#ffffff",
		popoverForeground: "#4c4f69",
		primary: "#8839ef",
		primaryForeground: "#ffffff",
		secondary: "#e4e6f2",
		secondaryForeground: "#5c5f77",
		accent: "#eae4f8",
		accentForeground: "#51416e",
		border: "#ccd0da",
		input: "#ccd0da",
		ring: "#8839ef",
		midground: "#8839ef",
		destructive: "#d20f39",
		destructiveForeground: "#ffffff",
		sidebarBackground: "#e9ebf2",
		sidebarBorder: "#d6d9e3",
		userBubble: "#e6e0f8",
		userBubbleBorder: "#d2c8ef",
	},
	darkColors: {
		background: "#1e1e2e",
		foreground: "#cdd6f4",
		card: "#26263a",
		cardForeground: "#cdd6f4",
		muted: "#313244",
		mutedForeground: "#a6adc8",
		popover: "#313244",
		popoverForeground: "#cdd6f4",
		primary: "#cba6f7",
		primaryForeground: "#1e1e2e",
		secondary: "#3a354e",
		secondaryForeground: "#c3c6f0",
		accent: "#39344d",
		accentForeground: "#d9d2f2",
		border: "#45475a",
		input: "#4b4d63",
		ring: "#cba6f7",
		midground: "#cba6f7",
		destructive: "#f38ba8",
		destructiveForeground: "#1e1e2e",
		sidebarBackground: "#181825",
		sidebarBorder: "#313244",
		userBubble: "#363150",
		userBubbleBorder: "#4e4864",
	},
};

export const tokyoTheme: DesktopTheme = {
	name: "tokyo-night",
	label: "Tokyo Night",
	description: "City-lights indigo — neon blues and purples over a dark skyline",
	colors: {
		background: "#e1e2e7",
		foreground: "#3760bf",
		card: "#e9ebf2",
		cardForeground: "#3760bf",
		muted: "#d5d9e4",
		mutedForeground: "#6172b0",
		popover: "#f3f4fa",
		popoverForeground: "#3760bf",
		primary: "#2e5de5",
		primaryForeground: "#ffffff",
		secondary: "#d8def0",
		secondaryForeground: "#485a94",
		accent: "#dde2f2",
		accentForeground: "#3c5188",
		border: "#c4c8da",
		input: "#c4c8da",
		ring: "#2e5de5",
		midground: "#2e5de5",
		destructive: "#c64343",
		destructiveForeground: "#ffffff",
		sidebarBackground: "#d9dbe4",
		sidebarBorder: "#c8ccdd",
		userBubble: "#dbe2f2",
		userBubbleBorder: "#c3cde8",
	},
	darkColors: {
		background: "#1a1b26",
		foreground: "#c0caf5",
		card: "#20212f",
		cardForeground: "#c0caf5",
		muted: "#262939",
		mutedForeground: "#9aa5ce",
		popover: "#262939",
		popoverForeground: "#c0caf5",
		primary: "#7aa2f7",
		primaryForeground: "#1a1b26",
		secondary: "#2e3348",
		secondaryForeground: "#b6c2f2",
		accent: "#2c3147",
		accentForeground: "#c5cff0",
		border: "#292e42",
		input: "#2f3450",
		ring: "#7aa2f7",
		midground: "#7aa2f7",
		destructive: "#f7768e",
		destructiveForeground: "#1a1b26",
		sidebarBackground: "#15161e",
		sidebarBorder: "#262939",
		userBubble: "#2b2f47",
		userBubbleBorder: "#3d4463",
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
	nord: nordTheme,
	dracula: draculaTheme,
	gruvbox: gruvboxTheme,
	catppuccin: catppuccinTheme,
	"tokyo-night": tokyoTheme,
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
import type { Config } from "tailwindcss";

const config: Config = {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				"pi-bg": "rgb(var(--pi-bg-rgb) / <alpha-value>)",
				"pi-surface": "rgb(var(--pi-surface-rgb) / <alpha-value>)",
				"pi-surface-raised": "rgb(var(--pi-surface-raised-rgb) / <alpha-value>)",
				"pi-surface-overlay": "rgb(var(--pi-surface-overlay-rgb) / <alpha-value>)",
				"pi-border": "var(--pi-border)",
				"pi-border-strong": "var(--pi-border-strong)",
				"pi-text": "rgb(var(--pi-text-rgb) / <alpha-value>)",
				"pi-text-secondary": "rgb(var(--pi-text-secondary-rgb) / <alpha-value>)",
				"pi-text-muted": "rgb(var(--pi-text-muted-rgb) / <alpha-value>)",
				"pi-text-faint": "rgb(var(--pi-text-faint-rgb) / <alpha-value>)",
				"pi-accent": "rgb(var(--pi-accent-rgb) / <alpha-value>)",
				"pi-accent-hover": "rgb(var(--pi-accent-hover-rgb) / <alpha-value>)",
				"pi-accent-soft": "var(--pi-accent-soft)",
				"pi-accent-ring": "var(--pi-accent-ring)",
				"pi-user": "rgb(var(--pi-user-rgb) / <alpha-value>)",
				"pi-assistant": "rgb(var(--pi-assistant-rgb) / <alpha-value>)",
				"pi-tool": "rgb(var(--pi-tool-rgb) / <alpha-value>)",
				"pi-success": "rgb(var(--pi-success-rgb) / <alpha-value>)",
				"pi-warning": "rgb(var(--pi-warning-rgb) / <alpha-value>)",
				"pi-error": "rgb(var(--pi-error-rgb) / <alpha-value>)",
				"pi-error-soft": "var(--pi-error-soft)",
			},
			fontFamily: {
				sans: [
					"-apple-system",
					"BlinkMacSystemFont",
					"SF Pro Text",
					"Segoe UI",
					"Geist",
					"Geist Variable",
					"system-ui",
					"sans-serif",
				],
				mono: ["JetBrains Mono", "SF Mono", "Geist Mono", "ui-monospace", "monospace"],
			},
			boxShadow: {
				// Flat, not boxed: in-panel structure is a hairline ring with only the
				// faintest ambient lift. Neutral, never warm-tinted.
				card: "0 0 0 1px var(--pi-border), 0 1px 2px rgba(0,0,0,0.06)",
				"card-hover":
					"0 0 0 1px var(--pi-border-strong), 0 4px 16px rgba(0,0,0,0.22)",
				// Borderless elevation — the overlay floats on a layered soft shadow,
				// no hard 1px ring. The shadow alone defines the edge.
				overlay:
					"0 1px 1px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.16), 0 16px 48px rgba(0,0,0,0.28)",
				// Accent focus ring.
				focus:
					"0 0 0 1px var(--pi-accent), 0 0 0 3px var(--pi-accent-ring)",
			},
			borderRadius: {
				xl: "10px",
				"2xl": "12px",
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};

export default config;

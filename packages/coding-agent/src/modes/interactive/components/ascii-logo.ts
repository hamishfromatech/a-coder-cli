/**
 * ASCII-art wordmark for the welcome banner (figlet "ANSI Shadow").
 * Two committed variants, picked by terminal width in the welcome banner so
 * the logo never wraps: WIDE is the single-line form ("A-Coder CLI" side by
 * side, ~78 cols); STACKED is the two-word-row fallback (~55 cols) for
 * narrow terminals. Generated once, zero runtime deps — do not hand-edit.
 */
export const ASCII_LOGO_WIDE: readonly string[] = [
	" █████╗        ██████╗ ██████╗ ██████╗ ███████╗██████╗      ██████╗██╗     ██╗",
	"██╔══██╗      ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗    ██╔════╝██║     ██║",
	"███████║█████╗██║     ██║   ██║██║  ██║█████╗  ██████╔╝    ██║     ██║     ██║",
	"██╔══██║╚════╝██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗    ██║     ██║     ██║",
	"██║  ██║      ╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║    ╚██████╗███████╗██║",
	"╚═╝  ╚═╝       ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝",
];

export const ASCII_LOGO_STACKED: readonly string[] = [
	" █████╗        ██████╗ ██████╗ ██████╗ ███████╗██████╗",
	"██╔══██╗      ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗",
	"███████║█████╗██║     ██║   ██║██║  ██║█████╗  ██████╔╝",
	"██╔══██║╚════╝██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗",
	"██║  ██║      ╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║",
	"╚═╝  ╚═╝       ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝",
	" ██████╗██╗     ██╗",
	"██╔════╝██║     ██║",
	"██║     ██║     ██║",
	"██║     ██║     ██║",
	"╚██████╗███████╗██║",
	" ╚═════╝╚══════╝╚═╝",
];

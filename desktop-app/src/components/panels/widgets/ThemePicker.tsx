import { useCallback, useEffect, useMemo } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
	persistCliSettings,
	type Theme,
	useSettingsStore,
} from "../../../stores/settings-store";
import { applyNamedTheme, normalizeSkin, SKIN_LIST } from "../../../lib/themes";
import { getSkinPalette, resolveMode, type ResolvedMode } from "../../../lib/apply-theme";
import { triggerHaptic } from "../../../lib/haptics";
import type { SkinMode } from "../../../lib/apply-theme";

interface ModeOption {
	value: Theme;
	label: string;
	description: string;
	icon: typeof Sun;
}

/**
 * Two-part appearance picker:
 *   1. Skin — the accent/identity palette (aurora + the six Hermes skins).
 *   2. Mode — light/dark/system brightness.
 *
 * Both apply instantly to the document and persist to settings.json.
 */
export function ThemePicker() {
	const theme = useSettingsStore((s) => s.theme);
	const setTheme = useSettingsStore((s) => s.setTheme);
	const skin = useSettingsStore((s) => s.skin);
	const setSkin = useSettingsStore((s) => s.setSkin);

	const modeOptions: ModeOption[] = useMemo(
		() => [
			{
				value: "light",
				label: "Light",
				description: "Bright paper background for daytime work.",
				icon: Sun,
			},
			{
				value: "dark",
				label: "Dark",
				description: "Deep chrome for late-night sessions.",
				icon: Moon,
			},
			{
				value: "system",
				label: "Match system",
				description: "Follow your Mac's appearance setting.",
				icon: Monitor,
			},
		],
		[],
	);

	// Keep the document root in sync on mount and whenever skin/mode changes.
	useEffect(() => {
		applyNamedTheme(skin, theme);
	}, [skin, theme]);

	const chooseSkin = useCallback(
		(next: string) => {
			const normalized = normalizeSkin(next);
			setSkin(normalized);
			applyNamedTheme(normalized, theme);
			triggerHaptic("crisp");
			void persistCliSettings("global", {
				...useSettingsStore.getState().cliGlobalSettings,
				skin: normalized,
			}).catch(() => {});
		},
		[setSkin, theme],
	);

	const chooseMode = useCallback(
		(next: Theme) => {
			setTheme(next);
			applyNamedTheme(skin, next);
			triggerHaptic("crisp");
			const { patchCliSettings } = useSettingsStore.getState();
			patchCliSettings("global", { theme: next });
			void persistCliSettings("global", {
				...useSettingsStore.getState().cliGlobalSettings,
				theme: next,
			}).catch(() => {});
		},
		[setTheme, skin],
	);

	return (
		<div className="flex flex-col gap-5">
			{/* ─── Skin ─────────────────────────────────────────── */}
			<section>
				<div className="mb-2 flex items-baseline justify-between">
					<h4 className="text-[11px] font-semibold uppercase tracking-wider text-pi-text-muted">
						Skin
					</h4>
					<span className="text-[10.5px] text-pi-text-faint">
						{SKIN_LIST.length} themes
					</span>
				</div>
				<div
					role="radiogroup"
					aria-label="Skin"
					className="grid grid-cols-2 gap-2 sm:grid-cols-3"
				>
					{SKIN_LIST.map((opt) => {
						const active = skin === opt.name;
						return (
							<button
								key={opt.name}
								type="button"
								role="radio"
								aria-checked={active}
								onClick={() => chooseSkin(opt.name)}
								className={`group flex flex-col gap-2 rounded-lg p-2.5 text-left transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
									active
										? "bg-pi-accent-soft shadow-[0_0_0_2px_var(--pi-accent)] hover:bg-pi-accent-soft"
										: "bg-pi-surface-raised shadow-[0_0_0_1px_var(--pi-border)] hover:shadow-card-hover hover:bg-pi-surface-overlay"
								}`}
							>
								<div className="flex items-center justify-between">
									<SkinPreview skin={opt.name} mode={resolveMode(theme as SkinMode)} />
									{active && (
										<Check className="h-3.5 w-3.5 text-pi-accent" aria-hidden />
									)}
								</div>
								<div>
									<div
										className={`text-[12px] font-semibold transition-smooth ${
											active ? "text-pi-accent" : "text-pi-text"
										}`}
									>
										{opt.label}
									</div>
									<div className="mt-0.5 text-[10.5px] leading-snug text-pi-text-muted">
										{opt.description}
									</div>
								</div>
							</button>
						);
					})}
				</div>
			</section>

			{/* ─── Mode ─────────────────────────────────────────── */}
			<section>
				<h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-pi-text-muted">
					Mode
				</h4>
				<div
					role="radiogroup"
					aria-label="Mode"
					className="grid grid-cols-1 gap-2 sm:grid-cols-3"
				>
					{modeOptions.map((opt) => {
						const Icon = opt.icon;
						const active = theme === opt.value;
						return (
							<button
								key={opt.value}
								type="button"
								role="radio"
								aria-checked={active}
								onClick={() => chooseMode(opt.value)}
								className={`group flex flex-col gap-2 rounded-lg p-3 text-left transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
									active
										? "bg-pi-accent-soft shadow-[0_0_0_2px_var(--pi-accent)] hover:bg-pi-accent-soft"
										: "bg-pi-surface-raised shadow-[0_0_0_1px_var(--pi-border)] hover:shadow-card-hover hover:bg-pi-surface-overlay"
								}`}
							>
								<div className="flex items-center justify-between">
									<Icon
										className={`h-4 w-4 transition-smooth ${
											active
												? "text-pi-accent"
												: "text-pi-text-muted group-hover:text-pi-text-secondary"
										}`}
									/>
									<span
										className={`text-[10.5px] font-semibold uppercase tracking-wider transition-smooth ${
											active ? "text-pi-accent" : "text-pi-text-faint opacity-0 group-hover:opacity-100"
										}`}
									>
										{active ? "Selected" : ""}
									</span>
								</div>
								<div>
									<div
										className={`text-[12.5px] font-semibold transition-smooth ${
											active ? "text-pi-text" : "text-pi-text group-hover:text-pi-text-secondary"
										}`}
									>
										{opt.label}
									</div>
									<div className="mt-0.5 text-[11px] leading-snug text-pi-text-muted">
										{opt.description}
									</div>
								</div>
							</button>
						);
					})}
				</div>
			</section>
		</div>
	);
}

/**
 * Mini swatch strip that paints the skin's real bg / surface / accent / text
 * chips using the resolved palette, so the preview matches what lands on the
 * document when the skin is selected.
 */
function SkinPreview({ skin, mode }: { skin: string; mode: ResolvedMode }) {
	const palette = useMemo(() => getSkinPalette(normalizeSkin(skin), mode), [skin, mode]);
	return (
		<div
			className="flex h-5 w-full max-w-[5.5rem] items-center gap-1 overflow-hidden rounded-sm transition-smooth group-hover:scale-[1.03]"
			style={{ background: palette.bg, border: `1px solid ${palette.textFaint}33` }}
			aria-hidden
		>
			<span
				className="ml-1 h-2.5 w-2.5 rounded-[2px]"
				style={{ background: palette.surface }}
			/>
			<span
				className="h-1.5 flex-1 rounded-[2px]"
				style={{ background: palette.textMuted, opacity: 0.5 }}
			/>
			<span
				className="mr-1 h-2.5 w-2.5 rounded-full"
				style={{ background: palette.accent }}
			/>
		</div>
	);
}
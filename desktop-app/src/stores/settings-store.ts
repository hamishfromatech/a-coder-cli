import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applySkinToRoot } from "../lib/apply-theme";
import { readSettingsFile, writeSettingsFile } from "../lib/rpc";
import type { CliSettings, PermissionMode, ThinkingLevel } from "../lib/settings.types";

// ============================================================================
// Local UI preferences — Zustand-persisted to localStorage. Independent of
// the cli's settings.json so desktop prefs survive engine resets.
// ============================================================================

export type Theme = "system" | "dark" | "light";

/** Accent/identity skin name (see src/lib/theme-presets.ts). */
export type Skin = string;

export interface StartupModel {
	provider: string;
	id: string;
}

export interface SettingsState {
	// ---- local UI prefs (persisted) ----
	cliPath: string;
	setCliPath: (path: string) => void;

	theme: Theme;
	setTheme: (theme: Theme) => void;

	skin: Skin;
	setSkin: (skin: Skin) => void;

	reopenLastProject: boolean;
	setReopenLastProject: (value: boolean) => void;

	startupModel: StartupModel | null;
	setStartupModel: (model: StartupModel | null) => void;

	permissionMode: PermissionMode;
	setPermissionMode: (mode: PermissionMode) => void;

	// ---- completion sound (local UI pref; persisted) ----
	/** Whether to chime at the end of an agent turn. */
	completionSoundEnabled: boolean;
	setCompletionSoundEnabled: (enabled: boolean) => void;
	/** Which chime preset to play (1..COMPLETION_SOUND_VARIANT_COUNT). */
	completionSoundVariantId: number;
	setCompletionSoundVariantId: (variantId: number) => void;

	// ---- chat backdrop (local UI pref; persisted) ----
	/** Whether the faint background image renders behind the chat surface. */
	chatBackdrop: boolean;
	setChatBackdrop: (enabled: boolean) => void;
	/** Whether trackpad haptics fire for turn cues and UI gestures. */
	hapticsEnabled: boolean;
	setHapticsEnabled: (enabled: boolean) => void;

	// ---- cli settings snapshot (not persisted; reloaded on connect) ----
	cliGlobalSettings: CliSettings;
	cliProjectSettings: CliSettings;
	setCliSettings: (global: CliSettings, project: CliSettings) => void;
	patchCliSettings: (scope: "global" | "project", patch: Partial<CliSettings>) => void;
	cliSettingsLoaded: boolean;
	setCliSettingsLoaded: (loaded: boolean) => void;
}

// ============================================================================
// Dot-path setter: returns a new object with `dotted.path = value`.
// ============================================================================
export function setByPath<T extends Record<string, unknown>>(
	obj: T,
	path: string,
	value: unknown,
): T {
	const parts = path.split(".");
	const result = { ...obj } as Record<string, unknown>;
	let cursor: Record<string, unknown> = result;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		const next = cursor[key];
		cursor[key] =
			next && typeof next === "object" && !Array.isArray(next)
				? { ...(next as Record<string, unknown>) }
				: {};
		cursor = cursor[key] as Record<string, unknown>;
	}
	cursor[parts[parts.length - 1]] = value as unknown;
	return result as T;
}

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let cursor: unknown = obj;
	for (const key of parts) {
		if (cursor == null || typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return cursor;
}

export const useSettingsStore = create<SettingsState>()(
	persist(
		(set) => ({
			cliPath: "",
			setCliPath: (cliPath) => set({ cliPath }),

			theme: "system",
			setTheme: (theme) => set({ theme }),

			skin: "aurora",
			setSkin: (skin) => set({ skin }),

			reopenLastProject: true,
			setReopenLastProject: (value) => set({ reopenLastProject: value }),

			startupModel: null,
			setStartupModel: (startupModel) => set({ startupModel }),

			permissionMode: "allow",
			setPermissionMode: (permissionMode) => set({ permissionMode }),

			completionSoundEnabled: true,
			setCompletionSoundEnabled: (completionSoundEnabled) => set({ completionSoundEnabled }),
			completionSoundVariantId: 1,
			setCompletionSoundVariantId: (variantId) =>
				// Range-validate without importing the lib (it imports this store back).
				set({
					completionSoundVariantId:
						Number.isInteger(variantId) && variantId >= 1 && variantId <= 14 ? variantId : 1,
				}),

			hapticsEnabled: true,
			setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),

			chatBackdrop: true,
			setChatBackdrop: (chatBackdrop) => set({ chatBackdrop }),

			cliGlobalSettings: {},
			cliProjectSettings: {},
			setCliSettings: (cliGlobalSettings, cliProjectSettings) =>
				set({ cliGlobalSettings, cliProjectSettings, cliSettingsLoaded: true }),
			patchCliSettings: (scope, patch) =>
				set((state) =>
					scope === "global"
						? { cliGlobalSettings: { ...state.cliGlobalSettings, ...patch } }
						: { cliProjectSettings: { ...state.cliProjectSettings, ...patch } },
				),
			cliSettingsLoaded: false,
			setCliSettingsLoaded: (cliSettingsLoaded) => set({ cliSettingsLoaded }),
		}),
		{
			name: "a-coder-desktop-settings",
			// Only persist local UI prefs — cli settings come from the cli on connect.
			partialize: (state) => ({
				cliPath: state.cliPath,
				theme: state.theme,
				skin: state.skin,
				reopenLastProject: state.reopenLastProject,
				startupModel: state.startupModel,
				permissionMode: state.permissionMode,
				completionSoundEnabled: state.completionSoundEnabled,
				completionSoundVariantId: state.completionSoundVariantId,
				hapticsEnabled: state.hapticsEnabled,
			chatBackdrop: state.chatBackdrop,
			}),
		},
	),
);

// ============================================================================
// Helpers (not hooks — call freely from anywhere)
// ============================================================================

/** Load the cli's settings.json for both scopes from disk via the Tauri shell.
 *  Project scope is skipped when no cwd is supplied, and each scope is loaded
 *  independently so a missing project file doesn't wipe the global settings. */
export async function loadCliSettings(cwd?: string): Promise<{
	global: CliSettings;
	project: CliSettings;
}> {
	const [global, project] = await Promise.all([
		readSettingsFile({ scope: "global", cwd }).then(
			(v) => (v ?? {}) as CliSettings,
			() => ({}) as CliSettings,
		),
		cwd
			? readSettingsFile({ scope: "project", cwd }).then(
					(v) => (v ?? {}) as CliSettings,
					() => ({}) as CliSettings,
				)
			: Promise.resolve({} as CliSettings),
	]);
	return { global, project };
}

/** Persist the cli's settings.json for one scope. */
export async function persistCliSettings(
	scope: "global" | "project",
	value: CliSettings,
	cwd?: string,
): Promise<void> {
	await writeSettingsFile({ scope, cwd, value: value as Record<string, unknown> });
}

/**
 * Apply the active skin + light/dark mode to the document root. The skin
 * paints the `--pi-*` palette; the mode toggles the `.light`/`.dark` class
 * (for color-scheme and the class-keyed border/grain rules in index.css).
 */
export function applyThemeToRoot(skin: Skin, theme: Theme): void {
	applySkinToRoot(skin, theme);
}

/** Canonical list of thinking-level options for UI dropdowns. */
export const THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

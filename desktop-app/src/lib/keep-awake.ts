import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/**
 * Keep-awake — a device-local preference, persisted per computer.
 *
 * `while-working` (the default) holds one OS sleep inhibitor only while an
 * agent turn or compaction is in flight, so long local-model runs survive a
 * laptop's idle sleep without pinning the machine awake all week. `always`
 * is the old boolean toggle's meaning; `off` never holds one.
 */
export type KeepAwakeMode = "off" | "while-working" | "always";

const STORAGE_KEY = "a-coder.keep-awake-mode.v1";
export const DEFAULT_KEEP_AWAKE_MODE: KeepAwakeMode = "while-working";

export function parseKeepAwakeMode(value: unknown): KeepAwakeMode | null {
	return value === "off" || value === "while-working" || value === "always" ? value : null;
}

export function readKeepAwakeMode(): KeepAwakeMode {
	try {
		return parseKeepAwakeMode(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_KEEP_AWAKE_MODE;
	} catch {
		return DEFAULT_KEEP_AWAKE_MODE;
	}
}

export function keepAwakeWanted(mode: KeepAwakeMode, working: boolean): boolean {
	return mode === "always" || (mode === "while-working" && working);
}

interface KeepAwakeStore {
	mode: KeepAwakeMode;
	setMode: (mode: KeepAwakeMode) => void;
}

export const useKeepAwakeStore = create<KeepAwakeStore>((set) => ({
	mode: typeof window === "undefined" ? DEFAULT_KEEP_AWAKE_MODE : readKeepAwakeMode(),
	setMode: (mode) => {
		try {
			localStorage.setItem(STORAGE_KEY, mode);
		} catch {
			/* storage disabled — the mode still applies for this run */
		}
		set({ mode });
	},
}));

/** Last state requested from Rust. `null` means a call failed and must retry. */
let applied: boolean | null = null;
let pending: Promise<void> = Promise.resolve();

/** One native blocker; calling with the current state is a no-op. */
export function applyKeepAwake(active: boolean): Promise<void> {
	if (applied === active) return pending;
	applied = active;
	pending = invoke<boolean>("keep_awake_set", { active })
		.then(() => undefined)
		.catch((error) => {
			// A missing command (older desktop build) must not break the app.
			applied = null;
			console.warn("[keep-awake] could not update inhibitor", error);
		});
	return pending;
}

/** Test seam: forget the last native state so a test can observe another call. */
export function resetKeepAwakeCacheForTests(): void {
	applied = null;
	pending = Promise.resolve();
}

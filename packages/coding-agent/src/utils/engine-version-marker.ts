/**
 * Keep the install's `ENGINE_VERSION` marker in step with the binary beside it.
 *
 * The desktop bootstrap installs a bundled engine archive that carries
 * `ENGINE_VERSION` (written by `scripts/stage-desktop-engine.mjs`). A later
 * CLI-only update replaces `pi.exe` but not that file, so the marker then
 * describes a version no longer on disk — confusing for anything that gates on
 * it. Refreshing it on startup fixes the drift regardless of who performed the
 * update. CLI-only installs have no marker, and none is created.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VERSION } from "../config.ts";

/** Marker file name written next to the compiled engine binary. */
const MARKER_FILE = "ENGINE_VERSION";

/**
 * Rewrite a stale marker next to `execPath`. Best-effort: returns true only
 * when the file existed and was changed.
 */
export function syncEngineVersionMarker(execPath: string = process.execPath, version: string = VERSION): boolean {
	try {
		const marker = join(dirname(execPath), MARKER_FILE);
		if (!existsSync(marker)) return false;
		const current = readFileSync(marker, "utf8").trim();
		if (current === version) return false;
		writeFileSync(marker, `${version}\n`);
		return true;
	} catch {
		// A read-only install or a transient lock must never block startup.
		return false;
	}
}

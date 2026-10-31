/**
 * macOS privacy (TCC) guidance.
 *
 * macOS protects Desktop, Documents, Downloads, iCloud Drive and the media
 * folders. When the responsible app has not been granted access, the kernel
 * answers `EPERM` ("operation not permitted") — indistinguishable from a real
 * permission problem, which makes the failure confusing: the file exists, the
 * user owns it, and `ls` in the same terminal works.
 *
 * These helpers turn that errno into an actionable message and back the
 * `doctor` probe. They never grant anything; only the user can.
 */

import { homedir } from "node:os";
import { join, sep } from "node:path";

export interface ProtectedRoot {
	/** Folder macOS guards with a TCC prompt. */
	path: string;
	/** User-facing name, e.g. "Downloads". */
	label: string;
}

/** The guarded folders under the user's home directory. */
export function protectedRoots(home: string = homedir()): ProtectedRoot[] {
	return [
		{ path: join(home, "Desktop"), label: "Desktop" },
		{ path: join(home, "Documents"), label: "Documents" },
		{ path: join(home, "Downloads"), label: "Downloads" },
		{ path: join(home, "Movies"), label: "Movies" },
		{ path: join(home, "Music"), label: "Music" },
		{ path: join(home, "Pictures"), label: "Pictures" },
		{ path: join(home, "Library", "Mobile Documents"), label: "iCloud Drive" },
	];
}

/** The guarded folder containing `path`, if any. */
export function protectedRootFor(path: string, home: string = homedir()): ProtectedRoot | undefined {
	const normalized = path.endsWith(sep) ? path.slice(0, -1) : path;
	return protectedRoots(home).find((root) => normalized === root.path || normalized.startsWith(`${root.path}${sep}`));
}

/** How to restore access, phrased for the surface that hit the denial. */
export function macosAccessHint(path: string, appName?: string): string | undefined {
	if (process.platform !== "darwin") return undefined;
	const root = protectedRootFor(path);
	if (!root) return undefined;
	const app = appName ?? process.env.TERM_PROGRAM ?? "your terminal or A-Coder Desktop";
	return `macOS is blocking access to ~/${root.label}. Open System Settings → Privacy & Security → Files and Folders (or Full Disk Access), enable access for ${app}, then restart it.`;
}

/**
 * True when an fs error looks like a macOS privacy denial on a guarded folder.
 * `EACCES` is included because some APIs report it instead of `EPERM`.
 */
export function isMacosAccessDenial(error: unknown, path?: string): boolean {
	if (process.platform !== "darwin") return false;
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (code !== "EPERM" && code !== "EACCES") return false;
	return path === undefined || protectedRootFor(path) !== undefined;
}

/** Append the TCC hint to a message once; leaves unrelated messages untouched. */
export function withMacosAccessHint(message: string, path: string, appName?: string): string {
	const hint = macosAccessHint(path, appName);
	if (hint === undefined || message.includes("Privacy & Security")) return message;
	return `${message}\n${hint}`;
}

/**
 * Self-update for the curl/ps1-installed CLI (the "bun-binary" layout under
 * `~/.a-coder`). The one-shot install scripts (`install-a-coder.sh` /
 * `Install-A-Coder.ps1`) are the source of truth for CLI updates: this module
 * runs them in place with `--no-desktop` so they only touch the CLI (the desktop
 * app updates itself via its own Tauri updater), then re-execs the CLI so the
 * user lands on the new version without a manual restart.
 *
 * The installer extracts a fresh `~/.a-coder/cli/lib/a-coder-cli` tree over
 * the running binary (legacy installs live at `~/.a-coder/lib/a-coder-cli`;
 * the installer refreshes the legacy `~/.a-coder/bin` shim to point here). On macOS/Linux the kernel keeps the old inode mapped for the
 * running process, so `rm -rf` + re-extract is safe. On Windows the running
 * `pi.exe` is locked, so `Install-A-Coder.ps1` renames it before copying (see
 * that script). In both cases the new binary is in place before we re-exec.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, getInstallerScriptUrl } from "../config.ts";

const STATE_FILE_NAME = "auto-update.json";
/** Skip re-attempting the same tag for this long, so a failed/looping update
 *  doesn't yank the TUI on every startup. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface AutoUpdateState {
	lastAttemptedTag?: string;
	lastAttemptAt?: number;
}

function normalizeTag(version: string): string {
	return version.startsWith("v") ? version : `v${version}`;
}

function stateFilePath(): string {
	return join(getAgentDir(), STATE_FILE_NAME);
}

function readState(): AutoUpdateState {
	try {
		const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as AutoUpdateState) : {};
	} catch {
		return {};
	}
}

function writeState(state: AutoUpdateState): void {
	try {
		mkdirSync(getAgentDir(), { recursive: true });
		writeFileSync(stateFilePath(), JSON.stringify(state), "utf8");
	} catch {
		// best-effort: a failed state write just means we might retry sooner.
	}
}

/**
 * True unless the same tag was already attempted within the cooldown window.
 * Guards against update loops (e.g. the release isn't fully published yet, or
 * the installer silently fails to bump the version marker).
 */
export function shouldAttemptAutoUpdate(version: string): boolean {
	const tag = normalizeTag(version);
	const state = readState();
	if (
		state.lastAttemptedTag === tag &&
		typeof state.lastAttemptAt === "number" &&
		Date.now() - state.lastAttemptAt < COOLDOWN_MS
	) {
		return false;
	}
	return true;
}

/** Record an attempt so {@link shouldAttemptAutoUpdate} can suppress loops. */
export function recordAutoUpdateAttempt(version: string): void {
	writeState({ lastAttemptedTag: normalizeTag(version), lastAttemptAt: Date.now() });
}

export interface InstallerResult {
	ok: boolean;
	error?: string;
}

function awaitExit(child: ChildProcess): Promise<number> {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve(code ?? 0));
	});
}

/**
 * Run the one-shot installer for the given version, inheriting stdio so the
 * user sees download/extract progress. Uses `--no-desktop` (the desktop app
 * updates itself via Tauri) and pins the exact tag so the installer doesn't
 * race with a concurrently-published release.
 */
export async function runInstallerSelfUpdate(version: string): Promise<InstallerResult> {
	const tag = normalizeTag(version);
	try {
		if (process.platform === "win32") {
			return await runWindowsInstaller(tag);
		}
		return await runUnixInstaller(tag);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function runUnixInstaller(tag: string): Promise<InstallerResult> {
	const url = getInstallerScriptUrl("install-a-coder.sh");
	const script = `curl -sSfL "${url}" | bash -s -- --no-desktop --force "${tag}"`;
	const child = spawn("bash", ["-c", script], { stdio: "inherit" });
	const code = await awaitExit(child);
	return code === 0 ? { ok: true } : { ok: false, error: `installer exited with code ${code}` };
}

async function runWindowsInstaller(tag: string): Promise<InstallerResult> {
	const url = getInstallerScriptUrl("Install-A-Coder.ps1");
	// Download the script to a temp file and invoke it with parameters. We can't
	// pass args through `irm | iex`, so download-then-`-File` is the reliable
	// way to pass -NoDesktop -Force -Version.
	const psCommand =
		`$ErrorActionPreference='Stop'; $p=Join-Path $env:TEMP 'ac-install-a-coder.ps1'; ` +
		`try { Invoke-WebRequest -Uri '${url}' -OutFile $p -UseBasicParsing; ` +
		`& $p -NoDesktop -Force -Version '${tag}' } ` +
		`finally { Remove-Item $p -Force -ErrorAction SilentlyContinue }`;
	const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand], {
		stdio: "inherit",
	});
	const code = await awaitExit(child);
	return code === 0 ? { ok: true } : { ok: false, error: `installer exited with code ${code}` };
}

/**
 * Re-exec the CLI with the same argv so the user lands on the freshly-installed
 * version. Callers must have already restored the terminal (cooked mode) before
 * calling this, so the child starts in a clean terminal. The process exits via
 * the child's `spawn` event; a safety timer covers any edge case where neither
 * `spawn` nor `error` fires.
 */
export function relaunchSelf(): void {
	const child = spawn(process.argv[0], process.argv.slice(1), { stdio: "inherit" });
	child.once("spawn", () => process.exit(0));
	child.once("error", (error) => {
		console.error(`Failed to relaunch ${process.argv[0]}: ${error.message}`);
		process.exit(1);
	});
	// Safety net: don't hang forever if the child never emits spawn/error.
	setTimeout(() => process.exit(0), 5000);
}

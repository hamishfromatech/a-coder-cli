/**
 * `--desktop` launcher: resolve and spawn the A-Coder Desktop app, telling it
 * to open the current working directory as its workspace.
 *
 * The desktop app is a separate Tauri build (fork-only). It is discovered via
 * the A_CODER_DESKTOP_BINARY env override, standard per-platform install
 * locations, or A_CODER_DESKTOP_DEV=1 for running `npm run tauri dev` from the
 * monorepo. The workspace path is forwarded through the A_CODER_DESKTOP_WORKSPACE
 * environment variable, which the desktop app reads on startup (see the
 * get_initial_workspace Tauri command) to preselect the project and skip the
 * project picker.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import chalk from "chalk";
import { getPackageDir } from "../config.ts";

export const WORKSPACE_ENV = "A_CODER_DESKTOP_WORKSPACE";
const BINARY_ENV = "A_CODER_DESKTOP_BINARY";
const DEV_ENV = "A_CODER_DESKTOP_DEV";

const APP_NAME = "A-Coder Desktop";
const LINUX_BIN = "a-coder-desktop";

/** Per-platform install locations for the desktop app executable. */
function candidateBinaries(): string[] {
	const home = homedir();
	const plat = platform();
	if (plat === "darwin") {
		// The .app bundle is named "A-Coder Desktop" but its internal executable
		// is the Cargo binary name (a-coder-desktop).
		const exe = `Contents/MacOS/${LINUX_BIN}`;
		return [`/Applications/${APP_NAME}.app`, `${home}/Applications/${APP_NAME}.app`].map((a) => join(a, exe));
	}
	if (plat === "win32") {
		const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
		const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
		// The NSIS install dir is named after productName, but the installed
		// executable may be named after either the productName or the Cargo binary
		// name depending on bundler version. Check both so `--desktop` finds the app
		// regardless of which form Tauri emitted.
		const exeNames = [`${APP_NAME}.exe`, `${LINUX_BIN}.exe`];
		return exeNames.flatMap((exeName) => [
			join(localAppData, APP_NAME, exeName),
			join(programFiles, APP_NAME, exeName),
		]);
	}
	// linux and other unix
	return [
		join(home, ".local", "bin", LINUX_BIN),
		`/usr/local/bin/${LINUX_BIN}`,
		`/usr/bin/${LINUX_BIN}`,
		`/opt/${LINUX_BIN}/${LINUX_BIN}`,
		join(home, "Applications", LINUX_BIN),
	];
}

/** Resolve the desktop executable, honoring the explicit env override. */
function resolveDesktopBinary(): string | null {
	const override = process.env[BINARY_ENV];
	if (override) {
		if (existsSync(override)) return override;
		throw new Error(`${BINARY_ENV} is set but does not exist: ${override}`);
	}
	return candidateBinaries().find((c) => existsSync(c)) ?? null;
}

/** Locate the monorepo `desktop-app/` directory for dev mode. */
function monorepoDesktopAppDir(): string | null {
	let dir = getPackageDir();
	for (let i = 0; i < 6; i++) {
		const parent = dirname(dir);
		if (parent === dir) break;
		if (existsSync(join(parent, "packages")) && existsSync(join(parent, "desktop-app"))) {
			return join(parent, "desktop-app");
		}
		dir = parent;
	}
	return null;
}

/**
 * Resolve and spawn the A-Coder Desktop app, detaching it so the terminal can
 * exit immediately. The current working directory is forwarded as the initial
 * workspace via A_CODER_DESKTOP_WORKSPACE.
 */
export async function launchDesktop(cwd: string): Promise<void> {
	const workspace = resolve(cwd);
	const devMode = process.env[DEV_ENV] === "1" || process.env[DEV_ENV] === "true";

	let cmd: string;
	let args: string[];
	let spawnCwd: string | undefined;
	let shell = false;

	if (devMode) {
		const appDir = monorepoDesktopAppDir();
		if (!appDir) {
			console.error(
				chalk.red(
					`--desktop dev mode (${DEV_ENV}=1) is set but no desktop-app/ directory was found in the monorepo.`,
				),
			);
			process.exit(1);
		}
		cmd = process.platform === "win32" ? "npm.cmd" : "npm";
		args = ["run", "tauri", "dev"];
		spawnCwd = appDir;
		shell = process.platform === "win32";
	} else {
		const binary = resolveDesktopBinary();
		if (!binary) {
			console.error(chalk.red("A-Coder Desktop was not found on this machine."));
			console.error(
				`Install it from a release (DMG/installer) or set ${chalk.cyan(BINARY_ENV)} to the desktop executable path.`,
			);
			console.error(
				`For monorepo development, set ${chalk.cyan(`${DEV_ENV}=1`)} to run it via \`npm run tauri dev\`.`,
			);
			process.exit(1);
		}
		// On macOS, launch through `open` so the app activates properly (Dock,
		// menu bar, frontmost window). `--env KEY=VALUE` forwards the workspace
		// variable to the launched process (see `man open`).
		if (platform() === "darwin") {
			const appPath = dirname(dirname(dirname(binary)));
			cmd = "open";
			args = ["-na", appPath, "--env", `${WORKSPACE_ENV}=${workspace}`];
		} else {
			cmd = binary;
			args = [];
		}
	}

	const env: NodeJS.ProcessEnv = { ...process.env, [WORKSPACE_ENV]: workspace };
	const child = spawn(cmd, args, {
		detached: true,
		stdio: "ignore",
		cwd: spawnCwd,
		env,
		shell,
	});
	child.unref();

	child.on("error", (err) => {
		console.error(chalk.red(`Failed to launch A-Coder Desktop: ${err.message}`));
		// The process already detached; only exit if we never spawned.
	});

	console.log(chalk.green(`Opening A-Coder Desktop at ${chalk.cyan(workspace)}`));
}

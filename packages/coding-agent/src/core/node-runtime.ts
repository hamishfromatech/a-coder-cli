import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { getPackageDir } from "../config.ts";

/**
 * Locate the portable Node runtime shipped next to the compiled CLI.
 *
 * Bun runs the engine itself, but stdio MCP servers are still commonly
 * launched with `npx`, `npm`, or `node`. The release archive carries the
 * official Node distribution under `node/`; prepending its bin directory to
 * PATH makes those servers work without a system Node install. The same tree
 * ships inside the desktop app's bundled engine.
 */
export function bundledNodeBinDir(
	packageDir: string = getPackageDir(),
	platform: string = process.platform,
): string | undefined {
	const dir = platform === "win32" ? join(packageDir, "node") : join(packageDir, "node", "bin");
	const executable = platform === "win32" ? join(dir, "node.exe") : join(dir, "node");
	return existsSync(executable) ? dir : undefined;
}

/**
 * Prepend the bundled Node bin directory to PATH once. Child processes (MCP
 * servers, npm/npx, shell tools) inherit process.env, so this is the single
 * integration point for both the CLI and the desktop-spawned engine.
 */
export function ensureBundledNodeOnPath(
	packageDir: string = getPackageDir(),
	platform: string = process.platform,
): string | undefined {
	const dir = bundledNodeBinDir(packageDir, platform);
	if (!dir) return undefined;
	const current = process.env.PATH ?? "";
	const parts = current.split(delimiter).filter((part) => part.length > 0);
	if (parts[0] === dir) return dir;
	process.env.PATH = [dir, ...parts.filter((part) => part !== dir)].join(delimiter);
	return dir;
}

/**
 * One-time migrations that run on startup.
 */

import chalk from "chalk";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { CONFIG_DIR_NAME, getAgentDir, getBinDir, USER_CONFIG_DIR_NAME } from "./config.ts";
import { migrateKeybindingsConfig } from "./core/keybindings.ts";

const MIGRATION_GUIDE_URL =
	"https://github.com/hamishfromatech/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md#extensions-migration";
const EXTENSIONS_DOC_URL =
	"https://github.com/hamishfromatech/pi-mono/blob/main/packages/coding-agent/docs/extensions.md";

/**
 * Migrate legacy oauth.json and settings.json apiKeys to auth.json.
 *
 * @returns Array of provider names that were migrated
 */
export function migrateAuthToAuthJson(): string[] {
	const agentDir = getAgentDir();
	const authPath = join(agentDir, "auth.json");
	const oauthPath = join(agentDir, "oauth.json");
	const settingsPath = join(agentDir, "settings.json");

	// Skip if auth.json already exists
	if (existsSync(authPath)) return [];

	const migrated: Record<string, unknown> = {};
	const providers: string[] = [];

	// Migrate oauth.json
	if (existsSync(oauthPath)) {
		try {
			const oauth = JSON.parse(readFileSync(oauthPath, "utf-8"));
			for (const [provider, cred] of Object.entries(oauth)) {
				migrated[provider] = { type: "oauth", ...(cred as object) };
				providers.push(provider);
			}
			renameSync(oauthPath, `${oauthPath}.migrated`);
		} catch {
			// Skip on error
		}
	}

	// Migrate settings.json apiKeys
	if (existsSync(settingsPath)) {
		try {
			const content = readFileSync(settingsPath, "utf-8");
			const settings = JSON.parse(content);
			if (settings.apiKeys && typeof settings.apiKeys === "object") {
				for (const [provider, key] of Object.entries(settings.apiKeys)) {
					if (!migrated[provider] && typeof key === "string") {
						migrated[provider] = { type: "api_key", key };
						providers.push(provider);
					}
				}
				delete settings.apiKeys;
				writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
			}
		} catch {
			// Skip on error
		}
	}

	if (Object.keys(migrated).length > 0) {
		mkdirSync(dirname(authPath), { recursive: true });
		writeFileSync(authPath, JSON.stringify(migrated, null, 2), { mode: 0o600 });
	}

	return providers;
}

/**
 * Migrate sessions from ~/.a-coder-cli/agent/*.jsonl to proper session directories.
 *
 * Bug in v0.30.0: Sessions were saved to ~/.a-coder-cli/agent/ instead of
 * ~/.a-coder-cli/agent/sessions/<encoded-cwd>/. This migration moves them
 * to the correct location based on the cwd in their session header.
 *
 * See: https://github.com/hamishfromatech/pi-mono/issues/320
 */
export function migrateSessionsFromAgentRoot(): void {
	const agentDir = getAgentDir();

	// Find all .jsonl files directly in agentDir (not in subdirectories)
	let files: string[];
	try {
		files = readdirSync(agentDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => join(agentDir, f));
	} catch {
		return;
	}

	if (files.length === 0) return;

	for (const file of files) {
		try {
			// Read first line to get session header
			const content = readFileSync(file, "utf8");
			const firstLine = content.split("\n")[0];
			if (!firstLine?.trim()) continue;

			const header = JSON.parse(firstLine);
			if (header.type !== "session" || !header.cwd) continue;

			const cwd: string = header.cwd;

			// Compute the correct session directory (same encoding as session-manager.ts)
			const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
			const correctDir = join(agentDir, "sessions", safePath);

			// Create directory if needed
			if (!existsSync(correctDir)) {
				mkdirSync(correctDir, { recursive: true });
			}

			// Move the file
			const fileName = file.split("/").pop() || file.split("\\").pop();
			const newPath = join(correctDir, fileName!);

			if (existsSync(newPath)) continue; // Skip if target exists

			renameSync(file, newPath);
		} catch {
			// Skip files that can't be migrated
		}
	}
}

/**
 * Migrate commands/ to prompts/ if needed.
 * Works for both regular directories and symlinks.
 */
function migrateCommandsToPrompts(baseDir: string, label: string): boolean {
	const commandsDir = join(baseDir, "commands");
	const promptsDir = join(baseDir, "prompts");

	if (existsSync(commandsDir) && !existsSync(promptsDir)) {
		try {
			renameSync(commandsDir, promptsDir);
			console.log(chalk.green(`Migrated ${label} commands/ → prompts/`));
			return true;
		} catch (err) {
			console.log(
				chalk.yellow(
					`Warning: Could not migrate ${label} commands/ to prompts/: ${err instanceof Error ? err.message : err}`,
				),
			);
		}
	}
	return false;
}

function migrateKeybindingsConfigFile(): void {
	const configPath = join(getAgentDir(), "keybindings.json");
	if (!existsSync(configPath)) return;

	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return;
		}
		const { config, migrated } = migrateKeybindingsConfig(parsed as Record<string, unknown>);
		if (!migrated) return;
		writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
	} catch {
		// Ignore malformed files during migration
	}
}

/**
 * Move fd/rg binaries from tools/ to bin/ if they exist.
 */
function migrateToolsToBin(): void {
	const agentDir = getAgentDir();
	const toolsDir = join(agentDir, "tools");
	const binDir = getBinDir();

	if (!existsSync(toolsDir)) return;

	const binaries = ["fd", "rg", "fd.exe", "rg.exe"];
	let movedAny = false;

	for (const bin of binaries) {
		const oldPath = join(toolsDir, bin);
		const newPath = join(binDir, bin);

		if (existsSync(oldPath)) {
			if (!existsSync(binDir)) {
				mkdirSync(binDir, { recursive: true });
			}
			if (!existsSync(newPath)) {
				try {
					renameSync(oldPath, newPath);
					movedAny = true;
				} catch {
					// Ignore errors
				}
			} else {
				// Target exists, just delete the old one
				try {
					rmSync?.(oldPath, { force: true });
				} catch {
					// Ignore
				}
			}
		}
	}

	if (movedAny) {
		console.log(chalk.green(`Migrated managed binaries tools/ → bin/`));
	}
}

/**
 * Check for deprecated hooks/ and tools/ directories.
 * Note: tools/ may contain fd/rg binaries extracted by pi, so only warn if it has other files.
 */
function checkDeprecatedExtensionDirs(baseDir: string, label: string): string[] {
	const hooksDir = join(baseDir, "hooks");
	const toolsDir = join(baseDir, "tools");
	const warnings: string[] = [];

	if (existsSync(hooksDir)) {
		warnings.push(`${label} hooks/ directory found. Hooks have been renamed to extensions.`);
	}

	if (existsSync(toolsDir)) {
		// Check if tools/ contains anything other than fd/rg (which are auto-extracted binaries)
		try {
			const entries = readdirSync(toolsDir);
			const customTools = entries.filter((e) => {
				const lower = e.toLowerCase();
				return (
					lower !== "fd" && lower !== "rg" && lower !== "fd.exe" && lower !== "rg.exe" && !e.startsWith(".") // Ignore .DS_Store and other hidden files
				);
			});
			if (customTools.length > 0) {
				warnings.push(
					`${label} tools/ directory contains custom tools. Custom tools have been merged into extensions.`,
				);
			}
		} catch {
			// Ignore read errors
		}
	}

	return warnings;
}

/**
 * Run extension system migrations (commands→prompts) and collect warnings about deprecated directories.
 */
function migrateExtensionSystem(cwd: string): string[] {
	const agentDir = getAgentDir();
	const projectDir = join(cwd, CONFIG_DIR_NAME);

	// Migrate commands/ to prompts/
	migrateCommandsToPrompts(agentDir, "Global");
	migrateCommandsToPrompts(projectDir, "Project");

	// Check for deprecated directories
	const warnings = [
		...checkDeprecatedExtensionDirs(agentDir, "Global"),
		...checkDeprecatedExtensionDirs(projectDir, "Project"),
	];

	return warnings;
}

/**
 * Print deprecation warnings and wait for keypress.
 */
export async function showDeprecationWarnings(warnings: string[]): Promise<void> {
	if (warnings.length === 0) return;

	for (const warning of warnings) {
		console.log(chalk.yellow(`Warning: ${warning}`));
	}
	console.log(chalk.yellow(`\nMove your extensions to the extensions/ directory.`));
	console.log(chalk.yellow(`Migration guide: ${MIGRATION_GUIDE_URL}`));
	console.log(chalk.yellow(`Documentation: ${EXTENSIONS_DOC_URL}`));
	console.log(chalk.dim(`\nPress any key to continue...`));

	await new Promise<void>((resolve) => {
		process.stdin.setRawMode?.(true);
		process.stdin.resume();
		process.stdin.once("data", () => {
			process.stdin.setRawMode?.(false);
			process.stdin.pause();
			resolve();
		});
	});
	console.log();
}

/**
 * Migrate a single legacy config directory (global or project-local)
 * from `.a-coder` to `.a-coder-cli`. Returns true if any entry was moved.
 *
 * Used both for the global `~/.a-coder-cli/agent` directory and any project-local
 * `.a-coder-cli/` directory under `cwd`.
 */
function migrateOneConfigDir(oldDir: string, newDir: string, label: string): boolean {
	if (!existsSync(oldDir)) return false;
	if (existsSync(join(newDir, "settings.json"))) return false;

	try {
		mkdirSync(newDir, { recursive: true });
	} catch {
		return false;
	}

	let movedAny = false;
	try {
		for (const entry of readdirSync(oldDir)) {
			const from = join(oldDir, entry);
			const to = join(newDir, entry);
			if (existsSync(to)) continue;
			try {
				renameSync(from, to);
				movedAny = true;
			} catch {
				// Skip entries that can't be moved (permissions, locks, etc.).
			}
		}
	} catch {
		// Ignore readdir errors.
	}

	if (movedAny) {
		console.log(chalk.green(`Migrated ${label} ${oldDir} → ${newDir}`));
	}
	return movedAny;
}

/**
 * Move user-scope config data from the legacy flat root `~/.a-coder-cli` to
 * `~/.a-coder/cli` (the shared A-Coder root, product-nested: IDE → `ide/`,
 * CLI → `cli/`, desktop → `desktop/`).
 *
 * - If the new root doesn't exist yet, the old dir is renamed wholesale.
 * - If both exist (e.g. the desktop bootstrap already installed the engine
 *   into `~/.a-coder/cli/lib`), entries are moved individually without
 *   overwriting anything already in place.
 *
 * Non-destructive and idempotent: entries that already exist at the target
 * are skipped, and a fully-drained old dir is removed if empty.
 */
function migrateUserConfigRoot(home: string): void {
	if (USER_CONFIG_DIR_NAME === CONFIG_DIR_NAME) return;
	const oldDir = join(home, CONFIG_DIR_NAME);
	const newDir = join(home, USER_CONFIG_DIR_NAME);
	if (!existsSync(oldDir)) return;

	if (!existsSync(newDir)) {
		try {
			mkdirSync(dirname(newDir), { recursive: true });
			renameSync(oldDir, newDir);
			console.log(chalk.green(`Migrated config dir ${oldDir} → ${newDir}`));
		} catch {
			// Fall through to per-entry migration on failure.
		}
		return;
	}

	let movedAny = false;
	try {
		for (const entry of readdirSync(oldDir)) {
			const from = join(oldDir, entry);
			const to = join(newDir, entry);
			if (existsSync(to)) continue;
			try {
				renameSync(from, to);
				movedAny = true;
			} catch {
				// Skip entries that can't be moved (permissions, locks, etc.).
			}
		}
	} catch {
		// Ignore readdir errors.
	}
	if (movedAny) {
		console.log(chalk.green(`Migrated config dir ${oldDir} → ${newDir}`));
	}
	try {
		rmSync(oldDir); // remove if now empty
	} catch {
		// Still has content — leave it alone.
	}
}

/**
 * Migrate the legacy config directory `~/.a-coder` to `~/.a-coder-cli`.
 *
 * The config dir was renamed from `.a-coder` to `.a-coder-cli` to avoid
 * collisions with other tools. This migration moves the entire `agent/`
 * subdirectory contents (settings.json, auth.json, models.json, sessions/,
 * etc.) from the old location to the new one if the new location is empty
 * or doesn't exist yet. Also migrates project-local `.a-coder-cli/` under `cwd`
 * to `.a-coder-cli/` if one exists.
 *
 * Skips silently if the old dir doesn't exist or the new dir already has
 * a settings.json (already migrated or user started fresh).
 */
export function migrateConfigDir(cwd: string): void {
	// Only migrate when running under the official config dir name.
	if (CONFIG_DIR_NAME !== ".a-coder-cli") return;

	const home = process.env.HOME || process.env.USERPROFILE;
	if (home) {
		// Newest first: flat `~/.a-coder-cli` → nested `~/.a-coder/cli`.
		migrateUserConfigRoot(home);
		migrateOneConfigDir(join(home, ".a-coder", "agent"), getAgentDir(), "global");
	}

	// Legacy project-local `.a-coder` → `.a-coder-cli`. Skipped when the "project"
	// is the home directory itself: there `~/.a-coder` is the shared product root
	// (cli/, ide/, desktop/), not a legacy project config — renaming it would
	// destroy the layout migrateUserConfigRoot just created.
	const isHomeCwd = home !== undefined && resolve(cwd) === resolve(home);
	if (cwd && cwd !== "." && !isHomeCwd) {
		migrateOneConfigDir(join(cwd, ".a-coder"), join(cwd, ".a-coder-cli"), "project-local");
	}
}

/**
 * Run all migrations. Called once on startup.
 *
 * @returns Object with migration results and deprecation warnings
 */
export function runMigrations(cwd: string): {
	migratedAuthProviders: string[];
	deprecationWarnings: string[];
} {
	migrateConfigDir(cwd);
	const migratedAuthProviders = migrateAuthToAuthJson();
	migrateSessionsFromAgentRoot();
	migrateToolsToBin();
	migrateKeybindingsConfigFile();
	const deprecationWarnings = migrateExtensionSystem(cwd);
	return { migratedAuthProviders, deprecationWarnings };
}

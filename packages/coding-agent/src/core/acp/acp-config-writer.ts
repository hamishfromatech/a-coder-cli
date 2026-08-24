/**
 * ACP config writer — auto-registers the CLI's ACP server in the A-Coder IDE's
 * `acp.json` so the IDE picks it up with no manual editing.
 *
 * The IDE reads `~/.a-coder/acp.json` (product.json dataFolderName + "acp.json")
 * and watches it for changes. Shape: { acpServers: { name: { url, headers? } } }.
 * On server start we merge our entry in, preserving any existing servers, and
 * create the file if absent. The IDE detects the file change and calls
 * GET /agents automatically.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** IDE-side ACP config file entry. */
export interface AcpConfigEntry {
	url: string;
	headers?: Record<string, string>;
}

/** IDE-side ACP config file shape (mirrors the IDE's ACPConfigFileJSON). */
export interface AcpConfigFile {
	acpServers: Record<string, AcpConfigEntry>;
}

/** Default path to the IDE's ACP config: ~/.a-coder/acp.json */
export function defaultAcpConfigPath(): string {
	return join(homedir(), ".a-coder", "acp.json");
}

export interface EnsureAcpConfigEntryOptions {
	/** The server name to register (e.g. "a-coder-cli"). */
	name: string;
	/** The server URL (e.g. http://127.0.0.1:54321). */
	url: string;
	/** Optional headers. */
	headers?: Record<string, string>;
	/** Path to acp.json. Defaults to ~/.a-coder/acp.json. */
	configPath?: string;
}

/** Read the existing ACP config, or return an empty one if missing/invalid. */
function readAcpConfig(path: string): AcpConfigFile {
	if (!existsSync(path)) return { acpServers: {} };
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as Partial<AcpConfigFile>;
		if (!parsed.acpServers || typeof parsed.acpServers !== "object") {
			return { acpServers: {} };
		}
		return parsed as AcpConfigFile;
	} catch {
		return { acpServers: {} };
	}
}

/**
 * Ensure an ACP server entry exists in the IDE's acp.json, creating the file
 * and entry if needed. Existing servers are preserved; an existing entry with
 * the same name is updated to the new URL. Returns whether the file changed.
 */
export function ensureAcpConfigEntry(options: EnsureAcpConfigEntryOptions): boolean {
	const path = options.configPath ?? defaultAcpConfigPath();
	const config = readAcpConfig(path);

	const existing = config.acpServers[options.name];
	if (existing && existing.url === options.url && !options.headers) {
		// Already registered with the same URL and no new headers — no change.
		return false;
	}

	config.acpServers[options.name] = {
		url: options.url,
		...(options.headers ? { headers: options.headers } : {}),
	};

	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// best-effort on platforms that don't honor chmod
	}
	return true;
}

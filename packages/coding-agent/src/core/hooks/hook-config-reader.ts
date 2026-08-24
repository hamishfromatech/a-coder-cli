/**
 * Hook config reader — reads Claude-Code-compatible hooks from the same
 * settings.json files the A-Coder IDE reads, so a hook config written for
 * the IDE also applies in a-coder-cli / A-Coder Desktop.
 *
 * Roots searched (mirrors the IDE's hookService):
 *   global:  ~/.a-coder/settings.json, ~/.claude/settings.json
 *   project: <cwd>/.a-coder/settings.json, <cwd>/.claude/settings.json
 *
 * The `hooks` key in each settings.json holds a HooksConfig keyed by
 * PascalCase event names. This reader merges them (project overrides global,
 * .a-coder overrides .claude) and returns the aggregated config.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLAUDE_HOOK_EVENTS, type ClaudeHookEventName, type HooksConfig } from "./hook-events.ts";

const A_CODER_DIR = ".a-coder";
const CLAUDE_DIR = ".claude";

/** Parse a single settings.json file's `hooks` key. Returns {} if missing/invalid. */
function readHooksFromFile(filePath: string): HooksConfig {
	if (!existsSync(filePath)) return {};
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const hooks = parsed.hooks;
		if (!hooks || typeof hooks !== "object") return {};
		return filterKnownEvents(hooks as Record<string, unknown>);
	} catch {
		return {};
	}
}

/** Keep only entries keyed by recognized Claude-Code event names. */
function filterKnownEvents(raw: Record<string, unknown>): HooksConfig {
	const out: HooksConfig = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!CLAUDE_HOOK_EVENTS.has(key as ClaudeHookEventName)) continue;
		if (!value || typeof value !== "object") continue;
		out[key as ClaudeHookEventName] = value as never;
	}
	return out;
}

/** Shallow-merge two hook configs: `over` wins on key collision. */
function mergeHooks(base: HooksConfig, over: HooksConfig): HooksConfig {
	return { ...base, ...over };
}

export interface ReadHooksOptions {
	/** Working directory for project-scoped hooks. Defaults to cwd. */
	cwd?: string;
	/** Home directory for global hooks. Defaults to os.homedir(). */
	home?: string;
}

/**
 * Read and merge Claude-Code-compatible hooks from all settings.json roots.
 * Precedence (lowest → highest):
 *   ~/.claude/settings.json  →  ~/.a-coder/settings.json
 *   →  <cwd>/.claude/settings.json  →  <cwd>/.a-coder/settings.json
 */
export function readHooksConfig(options?: ReadHooksOptions): HooksConfig {
	const home = options?.home ?? homedir();
	const cwd = options?.cwd ?? process.cwd();
	const files = [
		join(home, CLAUDE_DIR, "settings.json"),
		join(home, A_CODER_DIR, "settings.json"),
		join(cwd, CLAUDE_DIR, "settings.json"),
		join(cwd, A_CODER_DIR, "settings.json"),
	];
	let merged: HooksConfig = {};
	for (const file of files) {
		merged = mergeHooks(merged, readHooksFromFile(file));
	}
	return merged;
}

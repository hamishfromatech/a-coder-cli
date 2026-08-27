/**
 * Disk-based loader for custom sub-agent definitions (`.md` + YAML frontmatter).
 *
 * Two scopes are scanned (project overrides user on name collision):
 *   1. user    — `~/.a-coder/cli/agent/agents/*.md`   (lower priority)
 *   2. project  — `<cwd>/.a-coder-cli/agents/*.md`     (higher priority)
 *
 * Files with malformed frontmatter or missing required fields (`name`,
 * `description`, non-empty body) are skipped with a warning so a typo doesn't
 * crash startup. Reuses pi-mono's shared `parseFrontmatter` (same parser as
 * skills). Sync fs to match the skills loader.
 */

import * as path from "node:path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.ts";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import type { AgentDefinition, AgentIsolation, AgentPermissionMode, AgentSource } from "./types.ts";

/** `~/.a-coder/cli/agent/agents` */
export function getUserAgentsDir(): string {
	return path.join(getAgentDir(), "agents");
}

/** `<cwd>/.a-coder-cli/agents` */
export function getProjectAgentsDir(cwd: string): string {
	return path.join(cwd, CONFIG_DIR_NAME, "agents");
}

interface AgentFrontmatter {
	name?: string;
	description?: string;
	tools?: string[] | string;
	disallowedTools?: string[] | string;
	disallowed_tools?: string[] | string;
	model?: string;
	maxTurns?: number | string;
	max_turns?: number | string;
	permissionMode?: string;
	permission_mode?: string;
	isolation?: string;
	[key: string]: unknown;
}

function asString(value: unknown): string | undefined {
	if (typeof value === "string") {
		const t = value.trim();
		return t.length > 0 ? t : undefined;
	}
	return undefined;
}

function asStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((v) => (typeof v === "string" ? v.trim() : undefined)).filter((v): v is string => Boolean(v));
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return [];
}

function asPositiveInt(value: unknown): number | undefined {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value.trim(), 10) : NaN;
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function asPermissionMode(value: unknown): AgentPermissionMode | undefined {
	return value === "default" || value === "plan" || value === "auto" ? value : undefined;
}

function asIsolation(value: unknown): AgentIsolation | undefined {
	return value === "worktree" || value === "none" ? value : undefined;
}

function loadFromOneDir(dir: string, source: AgentSource): { agents: AgentDefinition[]; warnings: string[] } {
	if (!existsSync(dir)) {
		return { agents: [], warnings: [] };
	}

	let entries: string[];
	try {
		const dirents = readdirSync(dir, { withFileTypes: true });
		entries = dirents.filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".md")).map((d) => d.name);
	} catch (error) {
		return { agents: [], warnings: [`[agents] Failed to read ${dir}: ${(error as Error).message}`] };
	}

	const out: AgentDefinition[] = [];
	const warnings: string[] = [];

	for (const fileName of entries) {
		const filePath = path.join(dir, fileName);
		let raw: string;
		try {
			raw = readFileSync(filePath, "utf-8");
		} catch (error) {
			warnings.push(`[agents] Skipping ${filePath}: ${(error as Error).message}`);
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(raw);
		const name = asString(frontmatter.name);
		const description = asString(frontmatter.description);
		if (!name) {
			warnings.push(`[agents] Skipping ${fileName}: missing required 'name' field`);
			continue;
		}
		if (!description) {
			warnings.push(`[agents] Skipping ${fileName}: missing required 'description' field`);
			continue;
		}

		const systemPrompt = body.trim();
		if (!systemPrompt) {
			warnings.push(`[agents] Skipping ${fileName}: empty body — agent definition needs a system prompt`);
			continue;
		}

		const tools = asStringArray(frontmatter.tools);
		const disallowedTools = asStringArray(frontmatter.disallowedTools ?? frontmatter.disallowed_tools);
		const model = asString(frontmatter.model);
		const maxTurns = asPositiveInt(frontmatter.maxTurns ?? frontmatter.max_turns);
		const permissionMode = asPermissionMode(frontmatter.permissionMode ?? frontmatter.permission_mode);
		const isolation = asIsolation(frontmatter.isolation);

		out.push({
			agentType: name,
			whenToUse: description,
			...(tools.length > 0 ? { tools } : {}),
			...(disallowedTools.length > 0 ? { disallowedTools } : {}),
			...(model ? { model } : {}),
			...(maxTurns !== undefined ? { maxTurns } : {}),
			...(permissionMode ? { permissionMode } : {}),
			...(isolation ? { isolation } : {}),
			source,
			filePath,
			getSystemPrompt: () => systemPrompt,
		});
	}

	return { agents: out, warnings };
}

/**
 * Load every custom agent from the user + project scopes. User agents are
 * returned first and the registry's setAgents overwrites on collision, so
 * project > user (project returned last wins).
 */
/**
 * Load agent definitions from ONE directory (e.g. a plugin's `agents/` dir),
 * reusing the same frontmatter parser and validation as the user/project scopes.
 */
export function loadAgentsFromDir(dir: string, source: AgentSource): { agents: AgentDefinition[]; warnings: string[] } {
	return loadFromOneDir(dir, source);
}

export function loadAllCustomAgents(cwd: string): { agents: AgentDefinition[]; warnings: string[] } {
	const userResult = loadFromOneDir(getUserAgentsDir(), "user");
	const projectResult = loadFromOneDir(getProjectAgentsDir(cwd), "project");
	return {
		agents: [...userResult.agents, ...projectResult.agents],
		warnings: [...userResult.warnings, ...projectResult.warnings],
	};
}

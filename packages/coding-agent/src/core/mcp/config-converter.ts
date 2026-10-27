/**
 * MCP config converter — bidirectional serialization between a-coder-cli's
 * MCP server config and the A-Coder IDE's MCP config file format.
 *
 * a-coder-cli stores MCP servers as an array in settings.json:
 *   { mcpServers: McpServerConfig[] }
 * each entry: { name, transport: "stdio"|"http"|"sse", commandOrUrl, args?, env?, headers?, disabled? }
 *
 * The A-Coder IDE stores them as a named map in mcp.json:
 *   { mcpServers: Record<name, MCPConfigFileEntryJSON> }
 * each entry: { command?, args?, env?, url?, headers? }
 *
 * These are semantically equivalent but structurally different. This module
 * converts between the two so MCP server definitions written for one product
 * can be imported into the other, enabling shared MCP configuration across
 * A-Coder IDE, a-coder-cli, and A-Coder Desktop.
 */

import type { McpServerConfig } from "./types.ts";

/** IDE-side MCP config file entry (mirrors A-Coder IDE's MCPConfigFileEntryJSON). */
export interface IdeMcpConfigEntry {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
}

/** IDE-side MCP config file shape (mirrors A-Coder IDE's MCPConfigFileJSON). */
export interface IdeMcpConfigFile {
	mcpServers: Record<string, IdeMcpConfigEntry>;
}

/**
 * Convert a-coder-cli's MCP server configs to the IDE's named-map format.
 * Each CLI server becomes a key in `mcpServers` keyed by its `name`.
 * - stdio transport → `command` + `args` + `env`
 * - http/sse transport → `url` + `headers`
 * Disabled servers are omitted (the IDE has no disabled flag).
 */
export function cliMcpToIde(servers: McpServerConfig[]): IdeMcpConfigFile {
	const mcpServers: Record<string, IdeMcpConfigEntry> = {};
	for (const server of servers) {
		if (server.disabled) continue;
		if (server.transport === "stdio") {
			mcpServers[server.name] = {
				command: server.commandOrUrl,
				args: server.args,
				env: server.env,
			};
		} else {
			// http or sse — both serialize to a url entry.
			mcpServers[server.name] = {
				url: server.commandOrUrl,
				headers: server.headers,
			};
		}
	}
	return { mcpServers };
}

/**
 * Convert the IDE's named-map MCP config to a-coder-cli's array format.
 * A map entry with `command` is a stdio server; an entry with `url` is an
 * http server (sse is not distinguishable from the IDE shape, so http is the
 * default). Servers present in the CLI config keep their `disabled` flag.
 */
export function ideMcpToCli(config: IdeMcpConfigFile, existing?: McpServerConfig[]): McpServerConfig[] {
	const existingByName = new Map((existing ?? []).map((s) => [s.name, s]));
	const servers: McpServerConfig[] = [];
	for (const [name, entry] of Object.entries(config.mcpServers)) {
		if (entry.command) {
			servers.push({
				name,
				transport: "stdio",
				commandOrUrl: entry.command,
				args: entry.args,
				env: entry.env,
				disabled: existingByName.get(name)?.disabled,
			});
		} else if (entry.url) {
			servers.push({
				name,
				transport: "http",
				commandOrUrl: entry.url,
				headers: entry.headers,
				disabled: existingByName.get(name)?.disabled,
			});
		}
	}
	return servers;
}

/**
 * Merge IDE MCP servers into an existing CLI config without losing CLI-only
 * servers. CLI servers not present in the IDE config are preserved; IDE
 * entries override CLI entries of the same name.
 */
export function mergeIdeMcpIntoCli(config: IdeMcpConfigFile, existing: McpServerConfig[]): McpServerConfig[] {
	const ideServers = ideMcpToCli(config, existing);
	const ideNames = new Set(ideServers.map((s) => s.name));
	const cliOnly = existing.filter((s) => !ideNames.has(s.name));
	return [...ideServers, ...cliOnly];
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out = value.filter((entry): entry is string => typeof entry === "string");
	return out.length > 0 ? out : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw === "string") out[key] = raw;
		else if (typeof raw === "number" || typeof raw === "boolean") out[key] = String(raw);
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function toServer(name: string, raw: unknown): McpServerConfig | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const entry = raw as Record<string, unknown>;
	const declared =
		typeof entry.transport === "string"
			? entry.transport.toLowerCase()
			: typeof entry.type === "string"
				? entry.type.toLowerCase()
				: undefined;
	const resolvedName = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : name;
	if (!resolvedName) return undefined;

	const fromIdeCommand = typeof entry.command === "string" && entry.command.length > 0;
	const fromIdeUrl = typeof entry.url === "string" && entry.url.length > 0;
	const commandOrUrl =
		typeof entry.commandOrUrl === "string" && entry.commandOrUrl.length > 0
			? entry.commandOrUrl
			: fromIdeCommand
				? (entry.command as string)
				: fromIdeUrl
					? (entry.url as string)
					: undefined;
	if (!commandOrUrl) return undefined;

	const transport =
		declared === "stdio" || declared === "http" || declared === "sse"
			? declared
			: fromIdeUrl && !fromIdeCommand
				? "http"
				: "stdio";
	const args = asStringArray(entry.args);
	const env = asStringRecord(entry.env);
	const headers = asStringRecord(entry.headers);
	// Keep an explicit `[]`: it opts a server out of the built-in defaults.
	const suppress = Array.isArray(entry.suppressStderrPatterns)
		? entry.suppressStderrPatterns.filter((item): item is string => typeof item === "string")
		: undefined;
	return {
		name: resolvedName,
		transport,
		commandOrUrl,
		...(args ? { args } : {}),
		...(env ? { env } : {}),
		...(headers ? { headers } : {}),
		...(entry.disabled === true ? { disabled: true } : {}),
		...(typeof entry.timeoutMs === "number" ? { timeoutMs: entry.timeoutMs } : {}),
		...(suppress ? { suppressStderrPatterns: suppress } : {}),
		...(entry.forwardStderr === true ? { forwardStderr: true } : {}),
	};
}

/**
 * Normalize whatever a settings file holds under `mcpServers` into the CLI's
 * array form. Hand-edited project files frequently use the IDE / Claude named
 * map (`{ name: { command, args } }`) instead of the CLI array, which used to
 * crash settings reload (`.map is not a function`). Accepts:
 *   - the CLI array: `[{ name, transport, commandOrUrl, ... }]`
 *   - the IDE map: `{ name: { command, args } | { url, headers } }`
 *   - a map whose entries are already CLI-shaped (name comes from the key)
 * Entries that resolve to neither a command nor a URL are dropped. Returns
 * `undefined` when the value is absent or not an object, so callers keep their
 * default (an absent `mcpServers` is not an error).
 */
export function normalizeMcpServers(value: unknown): McpServerConfig[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) {
		const servers: McpServerConfig[] = [];
		for (const entry of value) {
			const server = toServer("", entry);
			if (server) servers.push(server);
		}
		return servers;
	}
	if (typeof value !== "object") return undefined;
	const servers: McpServerConfig[] = [];
	for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
		const server = toServer(name, entry);
		if (server) servers.push(server);
	}
	return servers;
}

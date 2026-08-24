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

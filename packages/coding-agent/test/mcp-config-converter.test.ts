import { describe, expect, it } from "vitest";
import {
	cliMcpToIde,
	type IdeMcpConfigFile,
	ideMcpToCli,
	mergeIdeMcpIntoCli,
	normalizeMcpServers,
} from "../src/core/mcp/config-converter.ts";
import type { McpServerConfig } from "../src/core/mcp/types.ts";

describe("MCP config converter", () => {
	describe("cliMcpToIde", () => {
		it("converts a stdio server to the IDE command shape", () => {
			const cli: McpServerConfig[] = [
				{
					name: "filesystem",
					transport: "stdio",
					commandOrUrl: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem"],
					env: { ROOT: "/tmp" },
				},
			];
			const ide = cliMcpToIde(cli);
			expect(ide).toEqual({
				mcpServers: {
					filesystem: {
						command: "npx",
						args: ["-y", "@modelcontextprotocol/server-filesystem"],
						env: { ROOT: "/tmp" },
					},
				},
			});
		});

		it("converts an http server to the IDE url shape", () => {
			const cli: McpServerConfig[] = [
				{
					name: "remote",
					transport: "http",
					commandOrUrl: "http://localhost:8000/mcp",
					headers: { Authorization: "Bearer x" },
				},
			];
			const ide = cliMcpToIde(cli);
			expect(ide.mcpServers.remote).toEqual({
				url: "http://localhost:8000/mcp",
				headers: { Authorization: "Bearer x" },
			});
		});

		it("omits disabled servers", () => {
			const cli: McpServerConfig[] = [
				{ name: "on", transport: "stdio", commandOrUrl: "a" },
				{ name: "off", transport: "stdio", commandOrUrl: "b", disabled: true },
			];
			const ide = cliMcpToIde(cli);
			expect(ide.mcpServers.on).toBeDefined();
			expect(ide.mcpServers.off).toBeUndefined();
		});
	});

	describe("ideMcpToCli", () => {
		it("converts a command entry to a stdio server", () => {
			const ide: IdeMcpConfigFile = {
				mcpServers: {
					fs: { command: "npx", args: ["server"], env: { X: "1" } },
				},
			};
			const cli = ideMcpToCli(ide);
			expect(cli).toEqual([
				{
					name: "fs",
					transport: "stdio",
					commandOrUrl: "npx",
					args: ["server"],
					env: { X: "1" },
					disabled: undefined,
				},
			]);
		});

		it("converts a url entry to an http server", () => {
			const ide: IdeMcpConfigFile = {
				mcpServers: { remote: { url: "http://x/mcp", headers: { H: "v" } } },
			};
			const cli = ideMcpToCli(ide);
			expect(cli[0]).toMatchObject({
				name: "remote",
				transport: "http",
				commandOrUrl: "http://x/mcp",
				headers: { H: "v" },
			});
		});

		it("preserves the disabled flag from existing CLI config", () => {
			const ide: IdeMcpConfigFile = { mcpServers: { fs: { command: "npx" } } };
			const existing: McpServerConfig[] = [{ name: "fs", transport: "stdio", commandOrUrl: "old", disabled: true }];
			const cli = ideMcpToCli(ide, existing);
			expect(cli[0].disabled).toBe(true);
		});
	});

	describe("mergeIdeMcpIntoCli", () => {
		it("preserves CLI-only servers and overrides shared names", () => {
			const ide: IdeMcpConfigFile = { mcpServers: { shared: { command: "new" } } };
			const existing: McpServerConfig[] = [
				{ name: "shared", transport: "stdio", commandOrUrl: "old" },
				{ name: "cliOnly", transport: "http", commandOrUrl: "http://x" },
			];
			const merged = mergeIdeMcpIntoCli(ide, existing);
			const byName = new Map(merged.map((s) => [s.name, s]));
			expect(byName.get("shared")?.commandOrUrl).toBe("new"); // IDE overrides
			expect(byName.get("cliOnly")?.commandOrUrl).toBe("http://x"); // CLI-only preserved
		});
	});

	describe("round-trip", () => {
		it("cli -> ide -> cli preserves stdio servers", () => {
			const cli: McpServerConfig[] = [
				{ name: "fs", transport: "stdio", commandOrUrl: "npx", args: ["x"], env: { Y: "1" } },
			];
			const roundTripped = ideMcpToCli(cliMcpToIde(cli));
			expect(roundTripped[0]).toMatchObject({
				name: "fs",
				transport: "stdio",
				commandOrUrl: "npx",
				args: ["x"],
				env: { Y: "1" },
			});
		});

		it("cli -> ide -> cli preserves http servers", () => {
			const cli: McpServerConfig[] = [
				{ name: "r", transport: "http", commandOrUrl: "http://x", headers: { A: "b" } },
			];
			const roundTripped = ideMcpToCli(cliMcpToIde(cli));
			expect(roundTripped[0]).toMatchObject({
				name: "r",
				transport: "http",
				commandOrUrl: "http://x",
				headers: { A: "b" },
			});
		});
	});

	describe("normalizeMcpServers", () => {
		it("converts the IDE named-map shape used in hand-edited settings", () => {
			const servers = normalizeMcpServers({
				filesystem: { command: "npx", args: ["-y", "server-filesystem"], env: { ROOT: "/tmp" } },
				context7: { url: "https://mcp.context7.com/mcp", headers: { Authorization: "Bearer x" } },
				events: { type: "sse", url: "https://example.test/sse" },
			});
			expect(servers).toHaveLength(3);
			expect(servers?.find((server) => server.name === "filesystem")).toMatchObject({
				transport: "stdio",
				commandOrUrl: "npx",
				args: ["-y", "server-filesystem"],
				env: { ROOT: "/tmp" },
			});
			expect(servers?.find((server) => server.name === "context7")).toMatchObject({
				transport: "http",
				commandOrUrl: "https://mcp.context7.com/mcp",
				headers: { Authorization: "Bearer x" },
			});
			expect(servers?.find((server) => server.name === "events")?.transport).toBe("sse");
		});

		it("keeps the CLI array shape untouched", () => {
			const cli: McpServerConfig[] = [
				{ name: "a", transport: "stdio", commandOrUrl: "node", args: ["a.js"], disabled: true },
			];
			expect(normalizeMcpServers(cli)).toEqual(cli);
		});

		it("accepts CLI-shaped entries inside a map and drops unusable ones", () => {
			const servers = normalizeMcpServers({
				tools: { commandOrUrl: "node", args: ["tools.js"] },
				broken: { args: ["nope"] },
				nullish: null,
			});
			expect(servers).toEqual([{ name: "tools", transport: "stdio", commandOrUrl: "node", args: ["tools.js"] }]);
		});

		it("returns undefined for absent or non-object values", () => {
			expect(normalizeMcpServers(undefined)).toBeUndefined();
			expect(normalizeMcpServers("nope")).toBeUndefined();
		});
	});
});

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";

const { mcpFactoryCalls } = vi.hoisted(() => ({
	mcpFactoryCalls: [] as Array<{
		servers: Array<{ name: string; transport: string; commandOrUrl: string }>;
	}>,
}));

vi.mock("../src/core/mcp/inline-extension.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/core/mcp/inline-extension.ts")>();
	return {
		...actual,
		// Widened capture: settings.json round-trips through JSON, so the
		// transport union arrives as string; cast once into the real factory.
		createMcpExtensionFactory: (options: {
			servers: Array<{ name: string; transport: string; commandOrUrl: string }>;
		}) => {
			mcpFactoryCalls.push(options);
			return actual.createMcpExtensionFactory(options as Parameters<typeof actual.createMcpExtensionFactory>[0]);
		},
	};
});

/**
 * /reload must rebuild the inline extension factories from fresh settings so
 * MCP servers added/changed/removed in settings.json take effect without
 * restarting the CLI.
 */
describe("resource loader reloads MCP server settings", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		mcpFactoryCalls.length = 0;
		tempDir = join(tmpdir(), `rl-mcp-reload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function writeSettings(mcpServers: Array<Record<string, unknown>>): void {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ mcpServers }));
	}

	it("rebuilds the MCP factory from fresh settings on reload", async () => {
		writeSettings([{ name: "alpha", transport: "http", commandOrUrl: "https://a.example/mcp" }]);

		const loader = new DefaultResourceLoader({ cwd, agentDir });
		// Constructor captures the settings-known server list.
		expect(mcpFactoryCalls).toHaveLength(1);
		expect(mcpFactoryCalls[0]?.servers).toHaveLength(1);

		await loader.reload();
		expect(mcpFactoryCalls).toHaveLength(2);
		expect(mcpFactoryCalls[1]?.servers).toHaveLength(1);

		// Add a second server and change the first — reload must see them.
		writeSettings([
			{ name: "alpha", transport: "http", commandOrUrl: "https://a2.example/mcp" },
			{ name: "beta", transport: "stdio", commandOrUrl: "beta-cmd" },
		]);
		await loader.reload();
		expect(mcpFactoryCalls).toHaveLength(3);
		const servers = mcpFactoryCalls[2]!.servers;
		expect(servers).toHaveLength(2);
		expect(servers.find((s) => s.name === "beta")?.commandOrUrl).toBe("beta-cmd");
		expect(servers.find((s) => s.name === "alpha")?.commandOrUrl).toBe("https://a2.example/mcp");

		// Removing all servers drops the MCP factory on the next reload.
		writeSettings([]);
		await loader.reload();
		expect(mcpFactoryCalls).toHaveLength(3);
	});
});

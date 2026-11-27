/**
 * `a-coder-cli mcp` — headless OAuth management for MCP servers.
 *
 * The desktop app can run the same flow through its Connect button and the RPC
 * surface exposes `mcp_oauth_start`; this command is the terminal equivalent
 * for users who never open Settings.
 */

import process from "node:process";
import { getAgentDir } from "../config.ts";
import { clearMcpOAuth, getMcpOAuthCredentialState, startMcpOAuthFlow } from "../core/mcp/oauth.ts";
import type { McpServerConfig } from "../core/mcp/types.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { openBrowser } from "../utils/open-browser.ts";

function printUsage(): void {
	console.log(`Use \`a-coder-cli mcp\` with one of:

  a-coder-cli mcp status                 List OAuth-enabled MCP servers
  a-coder-cli mcp login <server>         Open the browser and complete OAuth
  a-coder-cli mcp logout <server>        Remove stored OAuth credentials

The server must be enabled in settings.json and use an HTTP/SSE transport with
"oauth": true.`);
}

function oauthServers(servers: McpServerConfig[]): McpServerConfig[] {
	return servers.filter((server) => server.transport !== "stdio" && Boolean(server.oauth));
}

function findServer(servers: McpServerConfig[], name: string): McpServerConfig | undefined {
	return oauthServers(servers).find((server) => server.name === name);
}

function printStatus(servers: McpServerConfig[]): void {
	const candidates = oauthServers(servers);
	if (candidates.length === 0) {
		console.log('No OAuth-enabled MCP servers. Set "oauth": true on an HTTP/SSE server in settings.json.');
		return;
	}
	console.log("MCP OAuth servers:");
	for (const server of candidates) {
		const state = getMcpOAuthCredentialState(server.name);
		const status = server.disabled
			? "disabled"
			: state === "signed-in"
				? "signed in"
				: state === "client-registered"
					? "sign-in required"
					: "not signed in";
		console.log(`  ${server.name.padEnd(24)} ${server.transport.padEnd(8)} ${status}`);
	}
}

export async function handleMcpCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "mcp") return false;
	const [subcommand, ...rest] = args.slice(1);

	if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
		printUsage();
		return true;
	}

	const settingsManager = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false });
	const servers = oauthServers(settingsManager.getMcpServers());

	if (subcommand === "status" || subcommand === "list") {
		printStatus(servers);
		return true;
	}

	if (subcommand !== "login" && subcommand !== "logout") {
		console.error(`Unknown mcp command: ${subcommand}`);
		printUsage();
		process.exitCode = 1;
		return true;
	}

	const name = rest[0]?.trim();
	if (!name) {
		console.error(`Usage: a-coder-cli mcp ${subcommand} <server>`);
		process.exitCode = 1;
		return true;
	}

	const server = findServer(servers, name);
	if (!server) {
		console.error(`Unknown OAuth MCP server: ${name}`);
		process.exitCode = 1;
		return true;
	}

	if (subcommand === "logout") {
		clearMcpOAuth(name);
		console.log(`Removed OAuth credentials for ${name}.`);
		return true;
	}

	if (server.disabled) {
		console.error(`MCP server "${name}" is disabled. Enable it in settings.json first.`);
		process.exitCode = 1;
		return true;
	}

	console.log(`Starting OAuth for ${name}…`);
	try {
		let printedUrl = false;
		await startMcpOAuthFlow(server, (event) => {
			printedUrl = true;
			console.log(`\nOpen this URL to sign in:\n${event.url}\n`);
			openBrowser(event.url);
		});
		if (!printedUrl) {
			console.log(`No browser sign-in was needed; ${name} already has a valid token.`);
		} else {
			console.log(`Signed in to ${name}. Credentials stored for the next session.`);
		}
	} catch (error) {
		console.error(`OAuth failed for ${name}: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
	return true;
}

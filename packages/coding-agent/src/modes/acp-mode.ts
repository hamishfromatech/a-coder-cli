/**
 * ACP server mode — runs the ACP (Agent Communication Protocol) HTTP server
 * backed by a live AgentSession, so the A-Coder IDE can discover and call
 * a-coder-cli as a tool.
 *
 * Launched via `a-coder-cli --acp-server [PORT]`. The server listens on
 * localhost (127.0.0.1) and on startup prints the URL the IDE should be
 * pointed at (write it to ~/.a-coder/acp.json under `acpServers`).
 */

import chalk from "chalk";
import { ensureAcpConfigEntry } from "../core/acp/acp-config-writer.ts";
import { createAcpRunner, listAcpAgents, MAIN_AGENT_NAME } from "../core/acp/acp-runner.ts";
import { startAcpServer } from "../core/acp/acp-server.ts";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";

export interface AcpServerModeOptions {
	/** Port to listen on. 0 / undefined = pick a free port. */
	port?: number;
}

/** Run the ACP server until the process is asked to exit. */
export async function runAcpServerMode(
	runtime: AgentSessionRuntime,
	options: AcpServerModeOptions = {},
): Promise<number> {
	const runner = createAcpRunner(runtime);
	const handle = await startAcpServer({
		runner,
		port: options.port ?? 0,
		host: "127.0.0.1",
	});

	const agents = listAcpAgents();
	const agentNames = agents.map((a) => a.name).join(", ");

	// Auto-register in the A-Coder IDE's acp.json so it picks the server up
	// with no manual editing. The IDE watches the file for changes.
	const serverName = MAIN_AGENT_NAME;
	let registered = false;
	try {
		registered = ensureAcpConfigEntry({ name: serverName, url: handle.url });
	} catch (err: unknown) {
		// eslint-disable-next-line no-console
		console.error(
			chalk.yellow(`Could not write ~/.a-coder/acp.json: ${err instanceof Error ? err.message : String(err)}`),
		);
	}

	// eslint-disable-next-line no-console
	console.error(chalk.cyan("A-Coder CLI ACP server listening at:"), chalk.bold(handle.url));
	// eslint-disable-next-line no-console
	console.error(chalk.gray(`Exposed agents: ${agentNames}`));
	if (registered) {
		// eslint-disable-next-line no-console
		console.error(chalk.green(`Registered in ~/.a-coder/acp.json as "${serverName}".`));
	} else {
		// eslint-disable-next-line no-console
		console.error(chalk.gray(`Already registered in ~/.a-coder/acp.json as "${serverName}".`));
	}
	// eslint-disable-next-line no-console
	console.error(chalk.gray(`The A-Coder IDE will discover this server automatically. Press Ctrl+C to stop.`));

	// Keep the process alive until interrupted.
	const shutdown = (signal: string): void => {
		// eslint-disable-next-line no-console
		console.error(chalk.gray(`\nReceived ${signal}, shutting down ACP server…`));
		void handle
			.close()
			.then(() => runtime.dispose())
			.finally(() => process.exit(0));
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));

	// Block until the process exits.
	return new Promise<number>(() => {});
}

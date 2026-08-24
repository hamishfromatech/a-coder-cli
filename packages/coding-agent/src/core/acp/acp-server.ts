/**
 * ACP server — an HTTP server implementing the i-am-bee/acp REST endpoints,
 * so the A-Coder IDE can discover and call a-coder-cli as a tool.
 *
 * Endpoints:
 *   GET  /agents        → list exposed agents
 *   POST /runs          → create + execute a run (sync / async / stream)
 *   GET  /runs/{id}     → poll an async run
 *   GET  /health        → liveness probe
 *
 * The server is transport-only: it delegates agent listing and execution to
 * an injected AcpAgentRunner, keeping it testable without the full agent
 * runtime. The runner is implemented in acp-runner.ts against the real
 * AgentSession.
 *
 * No external HTTP dependencies — uses Node's built-in `http` module.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
	type AcpAgent,
	type AcpRunEvent,
	type AcpRunRequest,
	type AcpRunResponse,
	inputToText,
	resolveAgentName,
	textOutput,
} from "./types.ts";

/** Provider for the list of agents (called on each GET /agents). */
export type AcpAgentProvider = () => AcpAgent[] | Promise<AcpAgent[]>;

/** Result of a single agent run. */
export interface AcpRunResult {
	/** The agent's final text output. */
	output: string;
	/** Whether the run failed. */
	error?: string;
}

/**
 * Injected runner that executes one agent run. The server calls it for each
 * POST /runs. For streaming runs, `onEvent` is invoked with incremental
 * message/thought/tool_call events as they happen.
 */
export interface AcpAgentRunner {
	listAgents: AcpAgentProvider;
	runAgent: (
		agentName: string,
		inputText: string,
		options: { sessionId?: string; onEvent?: (event: AcpRunEvent) => void },
	) => Promise<AcpRunResult>;
}

export interface AcpServerOptions {
	runner: AcpAgentRunner;
	/** Port to listen on. 0 = pick a free port. */
	port?: number;
	/** Host to bind. Defaults to 127.0.0.1 (localhost only — never expose remotely). */
	host?: string;
}

export interface AcpServerHandle {
	server: Server;
	/** The actual port the server bound to (useful when port=0). */
	port: number;
	/** The base URL the IDE can point at. */
	url: string;
	close: () => Promise<void>;
}

/** Read and parse a JSON request body. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf-8");
			if (!raw) return resolve({});
			try {
				resolve(JSON.parse(raw));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}

/** Send a JSON response with a status code. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Content-Type, Accept",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	});
	res.end(payload);
}

/** Send an SSE event. */
function sendSse(res: ServerResponse, event: AcpRunEvent): void {
	res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Handle CORS preflight. */
function isPreflight(req: IncomingMessage): boolean {
	return req.method === "OPTIONS";
}

function handlePreflight(res: ServerResponse): void {
	res.writeHead(204, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Content-Type, Accept",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	});
	res.end();
}

/**
 * Start the ACP server. Returns a handle with the bound port and a close()
 * function. Resolves once the server is listening.
 */
export function startAcpServer(options: AcpServerOptions): Promise<AcpServerHandle> {
	const { runner } = options;
	const port = options.port ?? 0;
	const host = options.host ?? "127.0.0.1";

	const server = createServer(async (req, res) => {
		if (isPreflight(req)) return handlePreflight(res);

		const url = new URL(req.url ?? "/", `http://${host}`);
		const path = url.pathname;

		try {
			// GET /health — liveness probe.
			if (req.method === "GET" && path === "/health") {
				return sendJson(res, 200, { status: "ok" });
			}

			// GET /agents — list exposed agents.
			if (req.method === "GET" && path === "/agents") {
				const agents = await runner.listAgents();
				return sendJson(res, 200, { agents });
			}

			// POST /runs — create + execute a run.
			if (req.method === "POST" && path === "/runs") {
				const body = (await readJsonBody(req)) as AcpRunRequest;
				const agentName = resolveAgentName(body);
				if (!agentName) {
					return sendJson(res, 400, { error: { message: "Missing 'agent_name' or 'agent' field" } });
				}

				const agents = await runner.listAgents();
				if (!agents.some((a) => a.name === agentName)) {
					return sendJson(res, 404, { error: { message: `Unknown agent: ${agentName}` } });
				}

				const mode: AcpRunRequest["mode"] = body.mode ?? "sync";
				const inputText = inputToText(body.input);
				const runId = randomUUID();
				const sessionId = body.session_id ?? runId;

				// Streaming mode — SSE.
				if (mode === "stream") {
					res.writeHead(200, {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
						"Access-Control-Allow-Origin": "*",
					});
					const created: AcpRunResponse = {
						run_id: runId,
						agent_name: agentName,
						session_id: sessionId,
						status: "in-progress",
						output: [],
						error: null,
					};
					sendSse(res, { type: "run.created", run: created });
					sendSse(res, { type: "run.in-progress", run: created });

					try {
						const result = await runner.runAgent(agentName, inputText, {
							sessionId,
							onEvent: (event) => sendSse(res, event),
						});
						const completed: AcpRunResponse = {
							run_id: runId,
							agent_name: agentName,
							session_id: sessionId,
							status: result.error ? "failed" : "completed",
							output: textOutput(agentName, result.output),
							error: result.error ? { message: result.error } : null,
						};
						sendSse(res, { type: result.error ? "run.failed" : "run.completed", run: completed });
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : String(err);
						sendSse(res, { type: "run.failed", error: { message } });
					} finally {
						res.end();
					}
					return;
				}

				// Sync / async mode — collect the full result.
				let result: AcpRunResult;
				try {
					result = await runner.runAgent(agentName, inputText, { sessionId });
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					return sendJson(res, 500, {
						run_id: runId,
						agent_name: agentName,
						session_id: sessionId,
						status: "failed",
						output: [],
						error: { message },
					} satisfies AcpRunResponse);
				}

				const response: AcpRunResponse = {
					run_id: runId,
					agent_name: agentName,
					session_id: sessionId,
					status: result.error ? "failed" : "completed",
					output: textOutput(agentName, result.output),
					error: result.error ? { message: result.error } : null,
				};

				// async returns 202 with the run id; sync returns 200 with output.
				if (mode === "async") {
					return sendJson(res, 202, { run_id: runId, status: "in-progress" });
				}
				return sendJson(res, 200, response);
			}

			// GET /runs/{run_id} — poll an async run.
			if (req.method === "GET" && path.startsWith("/runs/")) {
				// Stateless server: async runs are not persisted across requests
				// in this minimal implementation. Return a not-implemented marker.
				return sendJson(res, 501, {
					error: { message: "Async run polling is not supported by this server" },
				});
			}

			return sendJson(res, 404, { error: { message: `Not found: ${req.method} ${path}` } });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return sendJson(res, 500, { error: { message } });
		}
	});

	return new Promise<AcpServerHandle>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			const address = server.address();
			const actualPort = typeof address === "object" && address ? address.port : port;
			server.removeListener("error", reject);
			resolve({
				server,
				port: actualPort,
				url: `http://${host}:${actualPort}`,
				close: () =>
					new Promise<void>((res, rej) => {
						server.close((err) => (err ? rej(err) : res()));
					}),
			});
		});
	});
}

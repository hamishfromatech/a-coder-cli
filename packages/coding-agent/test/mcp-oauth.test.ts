import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileOAuthProvider, McpOAuthRequiredError, startMcpOAuthFlow } from "../src/core/mcp/oauth.ts";

const originalAgentDir = process.env.A_CODER_CLI_CODING_AGENT_DIR;
const originalOAuthPort = process.env.A_CODER_CLI_MCP_OAUTH_PORT;

function listen(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve((server.address() as AddressInfo).port);
		});
	});
}

function close(server: Server): Promise<void> {
	return new Promise((resolve) => {
		server.close(() => resolve());
		server.closeAllConnections?.();
	});
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
		});
		request.on("end", () => resolve(body));
	});
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("Timed out waiting for the OAuth browser URL");
}

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	else process.env.A_CODER_CLI_CODING_AGENT_DIR = originalAgentDir;
	if (originalOAuthPort === undefined) delete process.env.A_CODER_CLI_MCP_OAUTH_PORT;
	else process.env.A_CODER_CLI_MCP_OAUTH_PORT = originalOAuthPort;
});

describe("MCP OAuth", () => {
	it("asks the session client to surface a sign-in instead of opening a browser", () => {
		const provider = new FileOAuthProvider({
			server: { name: "needs-auth", transport: "http", commandOrUrl: "https://example.com/mcp", oauth: true },
			interactive: false,
		});
		expect(() => provider.redirectToAuthorization(new URL("https://example.com/authorize"))).toThrow(
			McpOAuthRequiredError,
		);
	});

	it("runs discovery, registration, PKCE authorization, and stores tokens", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "mcp-oauth-agent-"));
		// Reserve a free callback port, then close the probe so the flow can bind it.
		const probe = createServer();
		const port = await listen(probe);
		await close(probe);
		process.env.A_CODER_CLI_CODING_AGENT_DIR = agentDir;
		process.env.A_CODER_CLI_MCP_OAUTH_PORT = String(port);

		let base = "";
		const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
			const url = new URL(request.url ?? "/", base);
			if (url.pathname === "/mcp") {
				if (!request.headers.authorization) {
					response.writeHead(401, {
						"www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
					});
					response.end();
					return;
				}
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
				return;
			}
			if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						resource: `${base}/mcp`,
						authorization_servers: [base],
						scopes_supported: ["mcp"],
					}),
				);
				return;
			}
			if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						issuer: base,
						authorization_endpoint: `${base}/authorize`,
						token_endpoint: `${base}/token`,
						registration_endpoint: `${base}/register`,
						response_types_supported: ["code"],
						grant_types_supported: ["authorization_code", "refresh_token"],
						token_endpoint_auth_methods_supported: ["none"],
						code_challenge_methods_supported: ["S256"],
					}),
				);
				return;
			}
			if (url.pathname === "/register" && request.method === "POST") {
				const body = JSON.parse(await readBody(request)) as { redirect_uris?: string[] };
				response.writeHead(201, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						client_id: "test-client",
						redirect_uris: body.redirect_uris,
						token_endpoint_auth_method: "none",
						grant_types: ["authorization_code", "refresh_token"],
						response_types: ["code"],
					}),
				);
				return;
			}
			if (url.pathname === "/authorize") {
				const redirect = url.searchParams.get("redirect_uri");
				const state = url.searchParams.get("state") ?? "";
				if (!redirect) {
					response.writeHead(400).end("missing redirect_uri");
					return;
				}
				const target = new URL(redirect);
				target.searchParams.set("code", "test-code");
				target.searchParams.set("state", state);
				response.writeHead(302, { location: target.toString() });
				response.end();
				return;
			}
			if (url.pathname === "/token" && request.method === "POST") {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						access_token: "test-access",
						token_type: "Bearer",
						refresh_token: "test-refresh",
						expires_in: 3600,
						scope: "mcp",
					}),
				);
				return;
			}
			response.writeHead(404).end("not found");
		});
		base = `http://127.0.0.1:${await listen(server)}`;

		const urls: string[] = [];
		const flow = startMcpOAuthFlow(
			{
				name: "mock-oauth",
				transport: "http",
				commandOrUrl: `${base}/mcp`,
				oauth: true,
			},
			(event) => urls.push(event.url),
		);

		try {
			await waitFor(() => urls.length > 0);
			const authorization = await fetch(urls[0]!, { redirect: "manual" });
			expect(authorization.status).toBe(302);
			const location = authorization.headers.get("location");
			expect(location).toContain("/oauth/callback?");
			const callback = await fetch(location!);
			expect(callback.status).toBe(200);

			await flow;
			const credentials = JSON.parse(readFileSync(join(agentDir, "mcp-oauth", "mock-oauth.json"), "utf-8"));
			expect(credentials.tokens.access_token).toBe("test-access");
			expect(credentials.tokens.refresh_token).toBe("test-refresh");
			expect(credentials.clientInformation.client_id).toBe("test-client");
		} finally {
			await close(server);
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});

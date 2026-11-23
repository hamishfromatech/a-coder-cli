/**
 * OAuth for HTTP/SSE MCP servers.
 *
 * The MCP spec uses the standard OAuth 2.1 authorization-code + PKCE flow.
 * The engine owns the callback server and token store; the desktop only opens
 * the authorization URL and reflects status. Tokens never enter settings.json.
 *
 * Callback: http://127.0.0.1:45454/oauth/callback (override the port with
 * A_CODER_CLI_MCP_OAUTH_PORT before starting the engine).
 * Store: ~/.a-coder/cli/agent/mcp-oauth/<server>.json (0600, atomic write).
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { type OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getAgentDir, VERSION } from "../../config.ts";
import type { McpOAuthSettings, McpServerConfig } from "./types.ts";

function oauthPort(): number {
	return Number(process.env.A_CODER_CLI_MCP_OAUTH_PORT) || 45_454;
}

function oauthRedirectUrl(): string {
	return `http://127.0.0.1:${oauthPort()}/oauth/callback`;
}

const OAUTH_TIMEOUT_MS = 5 * 60_000;
const OAUTH_CONNECT_TIMEOUT_MS = 30_000;

interface StoredOAuthCredentials {
	clientInformation?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
}

function oauthDir(): string {
	return join(getAgentDir(), "mcp-oauth");
}

function oauthPath(serverName: string): string {
	const safe = serverName.replace(/[^a-zA-Z0-9._-]+/g, "_") || "server";
	return join(oauthDir(), `${safe}.json`);
}

function readCredentials(serverName: string): StoredOAuthCredentials {
	try {
		const parsed: unknown = JSON.parse(readFileSync(oauthPath(serverName), "utf-8"));
		return parsed && typeof parsed === "object" ? (parsed as StoredOAuthCredentials) : {};
	} catch {
		return {};
	}
}

function writeCredentials(serverName: string, data: StoredOAuthCredentials): void {
	const dir = oauthDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const file = oauthPath(serverName);
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
	try {
		renameSync(tmp, file);
	} catch {
		rmSync(file, { force: true });
		renameSync(tmp, file);
	}
}

/** Remove stored OAuth state for one server. */
export function clearMcpOAuth(serverName: string): void {
	rmSync(oauthPath(serverName), { force: true });
}

/** The engine-facing provider error: a browser sign-in is needed. */
export class McpOAuthRequiredError extends Error {
	readonly serverName: string;
	readonly authorizationUrl?: string;

	constructor(serverName: string, authorizationUrl?: string) {
		super(
			`OAuth sign-in required for MCP server "${serverName}". Use Connect in the desktop MCP settings (or the mcp_oauth_start RPC).`,
		);
		this.name = "McpOAuthRequiredError";
		this.serverName = serverName;
		this.authorizationUrl = authorizationUrl;
	}
}

function oauthSettings(server: McpServerConfig): McpOAuthSettings {
	return typeof server.oauth === "object" ? server.oauth : {};
}

/** Resolve a single ${ENV_VAR} placeholder without ever persisting the secret. */
function resolveSecret(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
	return match ? process.env[match[1]] : value;
}

export interface FileOAuthProviderOptions {
	server: McpServerConfig;
	/** A browser sign-in is expected. False for the session client, which only
	 *  refreshes stored tokens and asks the UI to start a flow when needed. */
	interactive?: boolean;
	redirectUrl?: string;
	onAuthorizationUrl?: (url: string) => void;
}

/** File-backed OAuthClientProvider shared by the session client and the
 *  interactive sign-in flow. */
export class FileOAuthProvider implements OAuthClientProvider {
	private readonly server: McpServerConfig;
	private readonly interactive: boolean;
	private readonly redirect: string;
	private readonly onAuthorizationUrl?: (url: string) => void;
	private readonly stateValue = randomUUID();
	private verifier: string | undefined;

	readonly clientMetadataUrl?: string;

	constructor(options: FileOAuthProviderOptions) {
		this.server = options.server;
		this.interactive = options.interactive !== false;
		this.redirect = options.redirectUrl ?? oauthRedirectUrl();
		this.onAuthorizationUrl = options.onAuthorizationUrl;
		this.clientMetadataUrl = oauthSettings(options.server).clientMetadataUrl;
	}

	get redirectUrl(): string {
		return this.redirect;
	}

	get clientMetadata(): OAuthClientMetadata {
		const settings = oauthSettings(this.server);
		const secret = resolveSecret(settings.clientSecret);
		return {
			redirect_uris: [this.redirect],
			token_endpoint_auth_method: secret ? "client_secret_post" : "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			client_name: "A-Coder",
			...(settings.scopes?.length ? { scope: settings.scopes.join(" ") } : {}),
		};
	}

	state(): string {
		return this.stateValue;
	}

	get expectedState(): string {
		return this.stateValue;
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		const settings = oauthSettings(this.server);
		if (settings.clientId) {
			const secret = resolveSecret(settings.clientSecret);
			return { client_id: settings.clientId, ...(secret ? { client_secret: secret } : {}) };
		}
		return readCredentials(this.server.name).clientInformation;
	}

	saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
		writeCredentials(this.server.name, { ...readCredentials(this.server.name), clientInformation });
	}

	tokens(): OAuthTokens | undefined {
		return readCredentials(this.server.name).tokens;
	}

	saveTokens(tokens: OAuthTokens): void {
		writeCredentials(this.server.name, { ...readCredentials(this.server.name), tokens });
	}

	redirectToAuthorization(authorizationUrl: URL): void {
		if (!this.interactive) {
			throw new McpOAuthRequiredError(this.server.name, authorizationUrl.toString());
		}
		this.onAuthorizationUrl?.(authorizationUrl.toString());
	}

	saveCodeVerifier(codeVerifier: string): void {
		this.verifier = codeVerifier;
	}

	codeVerifier(): string {
		if (!this.verifier) throw new Error(`No PKCE verifier saved for MCP server "${this.server.name}"`);
		return this.verifier;
	}

	invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
		if (scope === "all") {
			clearMcpOAuth(this.server.name);
			return;
		}
		if (scope === "verifier" || scope === "discovery") return;
		const current = readCredentials(this.server.name);
		if (scope === "client") delete current.clientInformation;
		if (scope === "tokens") delete current.tokens;
		if (current.clientInformation || current.tokens) writeCredentials(this.server.name, current);
		else clearMcpOAuth(this.server.name);
	}
}

export type McpOAuthFlowEvent = { phase: "browser"; url: string };

interface CallbackServer {
	server: Server;
	redirectUrl: string;
	wait(state: string): { promise: Promise<string>; cancel: () => void };
	close(): Promise<void>;
}

async function createCallbackServer(): Promise<CallbackServer> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(oauthPort(), "127.0.0.1");
	});
	const redirectUrl = oauthRedirectUrl();

	return {
		server,
		redirectUrl,
		wait(expectedState) {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let resolvePromise: ((code: string) => void) | undefined;
			let onRequest: ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
			const promise = new Promise<string>((resolve, reject) => {
				resolvePromise = resolve;
				timer = setTimeout(() => {
					if (settled) return;
					settled = true;
					if (onRequest) server.off("request", onRequest);
					reject(new Error("Timed out waiting for the browser OAuth sign-in."));
				}, OAUTH_TIMEOUT_MS);
				timer.unref?.();

				const finish = (respond: () => void, resolveCode?: string, error?: Error) => {
					if (settled) return;
					settled = true;
					if (timer) clearTimeout(timer);
					if (onRequest) server.off("request", onRequest);
					respond();
					if (error) reject(error);
					else if (resolveCode !== undefined) resolve(resolveCode);
				};

				onRequest = (request: IncomingMessage, response: ServerResponse) => {
					const url = new URL(request.url ?? "/", "http://127.0.0.1");
					if (url.pathname !== "/oauth/callback") {
						response.writeHead(404).end("Not found");
						return;
					}
					const error = url.searchParams.get("error");
					const description = url.searchParams.get("error_description");
					if (error) {
						finish(
							() => sendCallbackPage(response, false, description ?? error),
							undefined,
							new Error(description ?? error),
						);
						return;
					}
					if (url.searchParams.get("state") !== expectedState) {
						finish(
							() => sendCallbackPage(response, false, "The sign-in state did not match."),
							undefined,
							new Error("OAuth state mismatch; start the sign-in again."),
						);
						return;
					}
					const code = url.searchParams.get("code");
					if (!code) {
						finish(
							() => sendCallbackPage(response, false, "No authorization code was returned."),
							undefined,
							new Error("OAuth callback did not include a code."),
						);
						return;
					}
					finish(() => sendCallbackPage(response, true), code);
				};
				server.on("request", onRequest);
			});
			return {
				promise,
				cancel: () => {
					if (settled) return;
					settled = true;
					if (timer) clearTimeout(timer);
					if (onRequest) server.off("request", onRequest);
					resolvePromise?.("");
				},
			};
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections?.();
			}),
	};
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

function sendCallbackPage(response: ServerResponse, ok: boolean, detail?: string): void {
	const message = escapeHtml(ok ? "Sign-in complete. You can close this window." : `Sign-in failed. ${detail ?? ""}`);
	response.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
	response.end(`<!doctype html><meta charset="utf-8"><title>A-Coder</title>
<body style="font:14px system-ui;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="max-width:34rem;padding:2rem;text-align:center"><h1 style="font-size:1.1rem">${message}</h1>
<p style="color:#94a3b8">Return to A-Coder to finish connecting the MCP server.</p></div></body>`);
}

let activeFlow: Promise<void> | null = null;

/** Run the interactive browser flow. The caller emits the browser URL and
 *  reconnects the MCP client after this resolves. */
export async function startMcpOAuthFlow(
	server: McpServerConfig,
	onEvent: (event: McpOAuthFlowEvent) => void,
): Promise<void> {
	if (server.transport === "stdio") throw new Error("OAuth is only available for HTTP/SSE MCP servers");
	if (!server.oauth) throw new Error(`MCP server "${server.name}" does not have OAuth enabled`);
	if (activeFlow) throw new Error("Another MCP OAuth sign-in is already in progress");

	const flow = runOAuthFlow(server, onEvent).finally(() => {
		activeFlow = null;
	});
	activeFlow = flow;
	return flow;
}

async function runOAuthFlow(server: McpServerConfig, onEvent: (event: McpOAuthFlowEvent) => void): Promise<void> {
	const callback = await createCallbackServer();
	let authorizationUrl: string | undefined;
	const provider = new FileOAuthProvider({
		server,
		interactive: true,
		redirectUrl: callback.redirectUrl,
		onAuthorizationUrl: (url) => {
			authorizationUrl = url;
			onEvent({ phase: "browser", url });
		},
	});
	const pending = callback.wait(provider.expectedState);
	const client = new Client({ name: "a-coder-cli-mcp-oauth", version: VERSION }, {});
	const transport =
		server.transport === "sse"
			? new SSEClientTransport(new URL(server.commandOrUrl), { authProvider: provider })
			: new StreamableHTTPClientTransport(new URL(server.commandOrUrl), { authProvider: provider });

	try {
		try {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					client.connect(transport),
					new Promise<never>((_, reject) => {
						timer = setTimeout(
							() => reject(new Error("Timed out contacting the MCP server for OAuth discovery.")),
							OAUTH_CONNECT_TIMEOUT_MS,
						);
						timer.unref?.();
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
			}
			// The server accepted the request without OAuth; nothing to authorize.
			pending.cancel();
			return;
		} catch (error) {
			if (!(error instanceof UnauthorizedError)) throw error;
		}
		if (!authorizationUrl) {
			pending.cancel();
			throw new Error("OAuth discovery did not produce an authorization URL.");
		}
		const code = await pending.promise;
		await transport.finishAuth(code);
	} finally {
		pending.cancel();
		await client.close().catch(() => {});
		await transport.close().catch(() => {});
		await callback.close().catch(() => {});
	}
}

/** Whether stored credentials exist, for doctor/UI display. */
export function hasMcpOAuthCredentials(serverName: string): boolean {
	const file = oauthPath(serverName);
	return existsSync(file);
}

/** Public callback URL, for diagnostics/docs. */
export function mcpOAuthCallbackUrl(): string {
	return oauthRedirectUrl();
}

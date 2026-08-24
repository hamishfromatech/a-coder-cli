/**
 * A-Coder OAuth client — performs the PKCE OAuth flow against the A-Coder
 * backend so a-coder-cli / A-Coder Desktop can reuse an A-Coder IDE account
 * (shared auth + backend-proxied models).
 *
 * Mirrors the IDE's aCoderOAuthMainService.ts flow:
 *   1. Generate PKCE code_verifier + code_challenge (S256)
 *   2. Start a local loopback HTTP server (RFC 8252) for the callback
 *   3. Open the browser to {backend}/auth/{provider}?redirect_uri=...&code_challenge=...
 *   4. Receive ?code&state on the callback, verify state (CSRF)
 *   5. POST {backend}/auth/exchange with {code, codeVerifier, state} → tokens
 *   6. Persist {sessionToken, refreshToken, expiresAt, userEmail, userId, provider}
 *   7. Refresh via POST {backend}/auth/refresh before expiry
 *   8. Fetch models via GET {backend}/models with Bearer sessionToken
 *
 * Tokens are stored in a JSON file (default ~/.a-coder-cli/agent/acoder-auth.json)
 * with 0600 permissions — the CLI has no OS keychain, so file perms are the
 * boundary. fetch and the browser-opener are injectable for testability.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";

/** A-Coder backend base URL (overridable via ACODER_API_URL). */
export const ACODER_BACKEND_URL = process.env.ACODER_API_URL || "https://api.a-coder.dev/v1";

/** The OpenAI-compatible inference proxy the session token authorizes. */
export const ACODER_INFERENCE_BASE_URL = "https://provider.atech.industries/v1";

export type OAuthProvider = "google" | "github";

/** Token exchange response from the A-Coder backend. */
export interface ACoderTokenResponse {
	sessionToken: string;
	refreshToken: string;
	expiresIn: number; // seconds
	userEmail: string;
	userId: string;
}

/** Persisted auth state. */
export interface ACoderAuthState {
	sessionToken: string;
	refreshToken: string;
	/** Unix seconds when the session token expires. */
	expiresAt: number;
	userEmail: string;
	userId: string;
	provider: OAuthProvider;
}

/** Model entry from GET /models. */
export interface ACoderModel {
	id: string;
	name: string;
	contextLength: number;
	supportsTools: boolean;
	isHidden?: boolean;
}

export interface ACoderModelResponse {
	models: ACoderModel[];
}

/** Injected fetch (defaults to global fetch). */
export type FetchImpl = typeof fetch;
/** Injected browser opener (defaults to the platform open). */
export type OpenUrlFn = (url: string) => Promise<void>;

export interface ACoderOAuthClientOptions {
	/** Path to the auth file. Defaults to ~/.a-coder-cli/agent/acoder-auth.json. */
	authPath?: string;
	/** Backend URL. Defaults to ACODER_BACKEND_URL. */
	backendUrl?: string;
	/** Injected fetch (tests). */
	fetchImpl?: FetchImpl;
	/** Injected browser opener (tests). */
	openUrl?: OpenUrlFn;
}

/** Generate a PKCE code_verifier and S256 code_challenge. */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	return { codeVerifier, codeChallenge };
}

/** Default browser opener — uses the CLI's cross-platform openBrowser util. */
async function defaultOpenUrl(url: string): Promise<void> {
	// Lazy import so the module loads in test environments without the shell
	// dependency, and so the test harness (which injects its own openUrl)
	// never triggers a real browser launch.
	const { openBrowser } = await import("../../utils/open-browser.ts");
	openBrowser(url);
}

export class ACoderOAuthClient {
	private readonly authPath: string;
	private readonly backendUrl: string;
	private readonly fetchImpl: FetchImpl;
	private readonly openUrl: OpenUrlFn;

	constructor(options: ACoderOAuthClientOptions = {}) {
		this.authPath = options.authPath ?? join(getAgentDir(), "acoder-auth.json");
		this.backendUrl = options.backendUrl ?? ACODER_BACKEND_URL;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.openUrl = options.openUrl ?? defaultOpenUrl;
	}

	/** Load persisted auth state, or null if absent/invalid. */
	loadAuth(): ACoderAuthState | null {
		if (!existsSync(this.authPath)) return null;
		try {
			const raw = readFileSync(this.authPath, "utf-8");
			const parsed = JSON.parse(raw) as ACoderAuthState;
			if (!parsed.sessionToken || !parsed.refreshToken) return null;
			return parsed;
		} catch {
			return null;
		}
	}

	/** Persist auth state to disk with 0600 permissions. */
	private saveAuth(state: ACoderAuthState): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(this.authPath, JSON.stringify(state, null, 2), { mode: 0o600 });
		try {
			chmodSync(this.authPath, 0o600);
		} catch {
			// best-effort on platforms that don't honor chmod
		}
	}

	/** Clear persisted auth (sign out). */
	clearAuth(): void {
		if (existsSync(this.authPath)) {
			writeFileSync(this.authPath, "{}", { mode: 0o600 });
		}
	}

	/** True if a non-expired session token is available. */
	isAuthenticated(): boolean {
		const auth = this.loadAuth();
		return !!auth && auth.expiresAt > 0 && Date.now() < auth.expiresAt * 1000;
	}

	/** The current session token, refreshing first if expired. */
	async getSessionToken(): Promise<string | null> {
		const auth = this.loadAuth();
		if (!auth) return null;
		// Refresh if within 5 minutes of expiry.
		const nowSec = Math.floor(Date.now() / 1000);
		if (auth.expiresAt - nowSec <= 300) {
			try {
				const refreshed = await this.refreshSessionToken(auth);
				return refreshed.sessionToken;
			} catch {
				return null;
			}
		}
		return auth.sessionToken;
	}

	/** Run the full OAuth flow for the given provider. Resolves when tokens are stored. */
	async signIn(provider: OAuthProvider): Promise<ACoderAuthState> {
		const { codeVerifier, codeChallenge } = generatePKCE();
		const state = randomUUID();

		// Start a loopback callback server.
		const port = await this.startCallbackServer();
		const redirectUri = `http://127.0.0.1:${port}/callback`;

		const oauthPromise = new Promise<ACoderTokenResponse>((resolve, reject) => {
			this.currentFlow = { codeVerifier, state, resolve, reject };
		});

		const oauthUrl =
			`${this.backendUrl}/auth/${provider}` +
			`?redirect_uri=${encodeURIComponent(redirectUri)}` +
			`&code_challenge=${codeChallenge}` +
			`&code_challenge_method=S256` +
			`&state=${state}`;

		await this.openUrl(oauthUrl);

		try {
			const result = await oauthPromise;
			const authState: ACoderAuthState = {
				sessionToken: result.sessionToken,
				refreshToken: result.refreshToken,
				expiresAt: Math.floor(Date.now() / 1000) + result.expiresIn,
				userEmail: result.userEmail,
				userId: result.userId,
				provider,
			};
			this.saveAuth(authState);
			return authState;
		} finally {
			this.currentFlow = null;
			this.stopCallbackServer();
		}
	}

	/** Refresh the session token using the refresh token. Returns the new state. */
	async refreshSessionToken(auth: ACoderAuthState): Promise<ACoderAuthState> {
		const response = await this.fetchImpl(`${this.backendUrl}/auth/refresh`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refreshToken: auth.refreshToken }),
		});
		if (!response.ok) {
			this.clearAuth();
			throw new Error(`Token refresh failed: ${response.status}`);
		}
		const result = (await response.json()) as ACoderTokenResponse;
		const refreshed: ACoderAuthState = {
			...auth,
			sessionToken: result.sessionToken,
			refreshToken: result.refreshToken,
			expiresAt: Math.floor(Date.now() / 1000) + result.expiresIn,
		};
		this.saveAuth(refreshed);
		return refreshed;
	}

	/** Fetch the list of models the account can use. */
	async fetchModels(): Promise<ACoderModelResponse> {
		const token = await this.getSessionToken();
		if (!token) throw new Error("Not authenticated. Run `a-coder-cli --login-acoder` first.");
		const response = await this.fetchImpl(`${this.backendUrl}/models`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!response.ok) throw new Error(`Failed to fetch models: ${response.status}`);
		return (await response.json()) as ACoderModelResponse;
	}

	// ── Callback server ──────────────────────────────────────────────────────

	private callbackServer: Server | null = null;
	private currentFlow: {
		codeVerifier: string;
		state: string;
		resolve: (r: ACoderTokenResponse) => void;
		reject: (e: Error) => void;
	} | null = null;

	private startCallbackServer(): Promise<number> {
		this.stopCallbackServer();
		return new Promise<number>((resolve, reject) => {
			const server = createServer((req, res) => {
				const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
				if (url.pathname !== "/callback") {
					res.writeHead(404);
					res.end();
					return;
				}
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				const error = url.searchParams.get("error");
				const errorDescription = url.searchParams.get("error_description");
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(
					`<html><body><h1>${error ? "Authentication Failed" : "Authentication Successful"}</h1>` +
						`<p>${error ? errorDescription : "You can close this window."}</p>` +
						`<script>window.close();</script></body></html>`,
				);
				if (error) {
					this.currentFlow?.reject?.(new Error(`OAuth error: ${error} - ${errorDescription}`));
				} else if (code && state && this.currentFlow) {
					this.exchangeCode(code, state)
						.then((result) => this.currentFlow?.resolve?.(result))
						.catch((err) => this.currentFlow?.reject?.(err));
				}
			});
			this.callbackServer = server;
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				resolve(typeof address === "object" && address ? address.port : 0);
			});
			server.on("error", reject);
		});
	}

	private stopCallbackServer(): void {
		if (this.callbackServer) {
			this.callbackServer.close();
			this.callbackServer = null;
		}
	}

	/** Exchange the authorization code for tokens (CSRF-verified via state). */
	private async exchangeCode(code: string, state: string): Promise<ACoderTokenResponse> {
		if (state !== this.currentFlow?.state) {
			throw new Error("Invalid OAuth state. Possible CSRF attack.");
		}
		const response = await this.fetchImpl(`${this.backendUrl}/auth/exchange`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, codeVerifier: this.currentFlow.codeVerifier, state }),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Failed to exchange code: ${response.status} ${text}`);
		}
		return (await response.json()) as ACoderTokenResponse;
	}
}

/** Default auth file path for the A-Coder OAuth client. */
export function defaultACoderAuthPath(): string {
	return join(getAgentDir(), "acoder-auth.json");
}

void homedir; // re-exported indirectly via getAgentDir; keep import for callers who build paths manually

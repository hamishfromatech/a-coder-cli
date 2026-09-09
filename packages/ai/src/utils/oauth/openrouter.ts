/**
 * OpenRouter OAuth PKCE flow.
 *
 * OpenRouter exchanges an authorization code for a permanent, user-controlled
 * API key rather than an expiring access/refresh token pair. The callback is
 * handled by a one-shot loopback server on an ephemeral port, raced against a
 * manual prompt so remote/headless sessions can paste the redirect URL when
 * the browser cannot reach the loopback server.
 *
 * NOTE: This module uses Node.js http.createServer for the OAuth callback server.
 * It is only intended for CLI use, not browser environments.
 */

import type { Server, ServerResponse } from "node:http";
import type { OAuthAuth } from "../../auth/types.ts";
import { getProviderEnvValue } from "../provider-env.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";
import { generatePKCE } from "./pkce.ts";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.ts";

const AUTHORIZE_URL = "https://openrouter.ai/auth";
const TOKEN_URL = "https://openrouter.ai/api/v1/auth/keys";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000;

const MANUAL_INPUT_MESSAGE = "Complete sign-in in your browser, or paste the authorization code / redirect URL here:";

function getCallbackHost(): string {
	return getProviderEnvValue("PI_OAUTH_CALLBACK_HOST") || "127.0.0.1";
}

type NodeApis = {
	createServer: typeof import("node:http").createServer;
};

let nodeApis: NodeApis | null = null;
let nodeApisPromise: Promise<NodeApis> | null = null;

async function getNodeApis(): Promise<NodeApis> {
	if (nodeApis) return nodeApis;
	if (!nodeApisPromise) {
		if (typeof process === "undefined" || (!process.versions?.node && !process.versions?.bun)) {
			throw new Error("OpenRouter OAuth is only available in Node.js environments");
		}
		nodeApisPromise = import("node:http").then((httpModule) => ({
			createServer: httpModule.createServer,
		}));
	}
	nodeApis = await nodeApisPromise;
	return nodeApis;
}

type JsonObject = Record<string, unknown>;

type OpenRouterCallbackServer = {
	callbackUrl: string;
	/** Stop listening and release timers without settling `waitForCredential`. */
	close: () => void;
	/** Hand the login over to manual code entry unless a callback already claimed the exchange. */
	cancelWait: () => void;
	/**
	 * Resolves with the credential once a browser callback completes the key
	 * exchange, or with null once `cancelWait` hands the login over to manual
	 * code entry. Rejects on timeout, cancellation, or a failed exchange.
	 */
	waitForCredential: () => Promise<OAuthCredentials | null>;
};

function sendHtml(response: ServerResponse, status: number, html: string): void {
	response.statusCode = status;
	response.setHeader("content-type", "text/html; charset=utf-8");
	response.setHeader("cache-control", "no-store");
	response.end(html);
}

function parseAuthorizationInput(input: string): string | undefined {
	const value = input.trim();
	if (!value) return undefined;

	try {
		return new URL(value).searchParams.get("code") ?? undefined;
	} catch {
		// not a URL
	}

	if (value.includes("code=")) {
		return new URLSearchParams(value).get("code") ?? undefined;
	}

	return value;
}

function errorDetail(body: JsonObject): string | undefined {
	if (typeof body.error_description === "string") return body.error_description;
	if (typeof body.message === "string") return body.message;
	if (typeof body.error === "string") return body.error;
	if (body.error && typeof body.error === "object" && !Array.isArray(body.error)) {
		const message = (body.error as JsonObject).message;
		if (typeof message === "string") return message;
	}
	return undefined;
}

async function exchangeAuthorizationCode(
	code: string,
	verifier: string,
	signal?: AbortSignal,
): Promise<OAuthCredentials> {
	if (signal?.aborted) throw new Error("Login cancelled");
	const controller = new AbortController();
	const onAbort = () => controller.abort(signal?.reason);
	signal?.addEventListener("abort", onAbort, { once: true });
	const timeout = setTimeout(
		() => controller.abort(new Error("OpenRouter OAuth token exchange timed out")),
		TOKEN_EXCHANGE_TIMEOUT_MS,
	);

	let response: Response;
	let body: JsonObject = {};
	try {
		response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
			signal: controller.signal,
		});
		try {
			const parsed = (await response.json()) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as JsonObject;
		} catch {
			if (response.ok) throw new Error("OpenRouter OAuth returned invalid JSON");
		}
	} catch (error) {
		if (signal?.aborted) throw new Error("Login cancelled");
		if (controller.signal.aborted) throw new Error("OpenRouter OAuth token exchange timed out");
		throw error;
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", onAbort);
	}

	if (!response.ok) {
		const detail = errorDetail(body);
		throw new Error(`OpenRouter OAuth key exchange failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
	}

	if (typeof body.key !== "string" || body.key.length === 0) {
		throw new Error('OpenRouter OAuth response carries no "key"');
	}

	return {
		type: "oauth",
		access: body.key,
		refresh: "",
		expires: Number.MAX_SAFE_INTEGER,
	};
}

async function startCallbackServer(
	callbackPath: string,
	verifier: string,
	signal?: AbortSignal,
): Promise<OpenRouterCallbackServer> {
	if (signal?.aborted) throw new Error("Login cancelled");
	const { createServer } = await getNodeApis();
	const callbackHost = getCallbackHost();
	let resolveCredential: (credential: OAuthCredentials | null) => void = () => {};
	let rejectCredential: (error: Error) => void = () => {};
	const credential = new Promise<OAuthCredentials | null>((resolve, reject) => {
		resolveCredential = resolve;
		rejectCredential = reject;
	});

	let server: Server;
	let claimed = false;
	let settled = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;

	const close = (): void => {
		if (timeout) clearTimeout(timeout);
		if (onAbort) signal?.removeEventListener("abort", onAbort);
		server.close();
	};

	const finish = (result: { credential: OAuthCredentials | null } | { error: Error }): void => {
		if (settled) return;
		settled = true;
		close();
		if ("credential" in result) resolveCredential(result.credential);
		else rejectCredential(result.error);
	};

	server = createServer((request, response) => {
		void (async () => {
			const requestUrl = new URL(request.url ?? "/", `http://${callbackHost}`);
			if (request.method !== "GET" || requestUrl.pathname !== callbackPath) {
				sendHtml(response, 404, oauthErrorHtml("OAuth callback route not found."));
				return;
			}
			if (claimed || settled) {
				sendHtml(response, 409, oauthErrorHtml("This OAuth callback has already been used."));
				return;
			}

			const oauthError = requestUrl.searchParams.get("error");
			if (oauthError) {
				const description = requestUrl.searchParams.get("error_description") ?? oauthError;
				sendHtml(response, 400, oauthErrorHtml("OpenRouter authorization was denied.", description));
				finish({ error: new Error(`OpenRouter authorization failed: ${description}`) });
				return;
			}

			const code = requestUrl.searchParams.get("code");
			if (!code) {
				sendHtml(response, 400, oauthErrorHtml("OpenRouter returned no authorization code."));
				return;
			}
			claimed = true;

			try {
				const result = await exchangeAuthorizationCode(code, verifier, signal);
				sendHtml(response, 200, oauthSuccessHtml("Signed in to OpenRouter. You may now close this page."));
				finish({ credential: result });
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown token exchange error";
				sendHtml(response, 502, oauthErrorHtml("OpenRouter key exchange failed.", message));
				finish({ error: error instanceof Error ? error : new Error(message) });
			}
		})();
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, callbackHost, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});

	server.on("error", (error) => finish({ error }));
	onAbort = () => finish({ error: new Error("Login cancelled") });
	signal?.addEventListener("abort", onAbort, { once: true });
	if (signal?.aborted) {
		close();
		throw new Error("Login cancelled");
	}
	timeout = setTimeout(() => finish({ error: new Error("OpenRouter OAuth login timed out") }), LOGIN_TIMEOUT_MS);

	const address = server.address();
	if (!address || typeof address === "string") {
		close();
		throw new Error("Could not determine the OpenRouter OAuth callback port");
	}

	return {
		callbackUrl: `http://${callbackHost}:${address.port}${callbackPath}`,
		close,
		// A claimed callback is already exchanging its code; let that exchange settle the login.
		cancelWait: () => {
			if (!claimed) finish({ credential: null });
		},
		waitForCredential: () => credential,
	};
}

/**
 * Login with OpenRouter OAuth (authorization code + PKCE, permanent API key)
 *
 * @param options.onAuth - Called with URL and instructions when auth starts
 * @param options.onPrompt - Called to prompt user for manual code paste (fallback if no onManualCodeInput)
 * @param options.onProgress - Optional progress messages
 * @param options.onManualCodeInput - Optional promise that resolves with user-pasted redirect URL or code.
 *                                    Races with browser callback - whichever completes first wins.
 *                                    Useful for showing paste input immediately alongside browser flow.
 * @param options.signal - Aborts the whole login flow
 */
export async function loginOpenRouter(options: {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	signal?: AbortSignal;
}): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();
	const callbackPath = `/oauth/callback/${crypto.randomUUID()}`;
	const callback = await startCallbackServer(callbackPath, verifier, options.signal);

	try {
		const authorizeUrl = new URL(AUTHORIZE_URL);
		authorizeUrl.search = new URLSearchParams({
			callback_url: callback.callbackUrl,
			code_challenge: challenge,
			code_challenge_method: "S256",
		}).toString();

		options.onAuth({
			url: authorizeUrl.toString(),
			instructions:
				"Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.",
		});

		if (options.onManualCodeInput) {
			// The manual input races the local callback server; a claimed callback
			// keeps priority so a pasted code cannot interrupt an in-flight exchange.
			let manualInput: string | undefined;
			let manualError: Error | undefined;
			const manualPromise = options
				.onManualCodeInput()
				.then((input) => {
					manualInput = input;
					callback.cancelWait();
				})
				.catch((error) => {
					manualError = error instanceof Error ? error : new Error(String(error));
					callback.cancelWait();
				});

			const credential = await callback.waitForCredential();
			if (manualError) throw manualError;
			if (credential) return credential;

			await manualPromise;
			if (manualError) throw manualError;
			const code = manualInput ? parseAuthorizationInput(manualInput) : undefined;
			if (!code) throw new Error("Missing authorization code");
			options.onProgress?.("Exchanging authorization code for an API key...");
			return await exchangeAuthorizationCode(code, verifier, options.signal);
		}

		// Prompt-only UIs: wait for the callback, then ask for a manual paste.
		const credential = await callback.waitForCredential();
		if (credential) return credential;

		const input = await options.onPrompt({
			message: "Paste the authorization code (or full redirect URL):",
			placeholder: callback.callbackUrl,
		});
		const code = parseAuthorizationInput(input);
		if (!code) throw new Error("Missing authorization code");
		options.onProgress?.("Exchanging authorization code for an API key...");
		return await exchangeAuthorizationCode(code, verifier, options.signal);
	} finally {
		callback.close();
	}
}

export const openRouterOAuth: OAuthAuth = {
	name: "OpenRouter OAuth",

	async login(callbacks) {
		// The manual_code prompt races the local callback server; abort it once
		// the flow settles so the UI can dismiss the pending input.
		const manualAbort = new AbortController();
		try {
			const credentials = await loginOpenRouter({
				onAuth: (info) => callbacks.notify({ type: "auth_url", url: info.url, instructions: info.instructions }),
				onProgress: (message) => callbacks.notify({ type: "progress", message }),
				onPrompt: (prompt) =>
					callbacks.prompt({ type: "text", message: prompt.message, placeholder: prompt.placeholder }),
				onManualCodeInput: () =>
					callbacks.prompt({
						type: "manual_code",
						message: MANUAL_INPUT_MESSAGE,
						signal: manualAbort.signal,
					}),
				signal: callbacks.signal,
			});
			return { ...credentials, type: "oauth" };
		} finally {
			manualAbort.abort();
		}
	},

	async refresh(credential) {
		// OpenRouter mints a permanent, user-controlled API key; nothing to refresh.
		return credential;
	},

	async toAuth(credential) {
		return { apiKey: credential.access };
	},
};

export const openRouterOAuthProvider: OAuthProviderInterface = {
	id: "openrouter",
	name: "OpenRouter",
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginOpenRouter({
			onAuth: callbacks.onAuth,
			onPrompt: callbacks.onPrompt,
			onProgress: callbacks.onProgress,
			onManualCodeInput: callbacks.onManualCodeInput,
			signal: callbacks.signal,
		});
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return credentials;
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};

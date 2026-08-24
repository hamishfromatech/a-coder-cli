import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ACoderOAuthClient,
	type ACoderTokenResponse,
	generatePKCE,
} from "../src/core/acoder-oauth/acoder-oauth-client.ts";

describe("generatePKCE", () => {
	it("produces a verifier and S256 challenge", () => {
		const { codeVerifier, codeChallenge } = generatePKCE();
		expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
		expect(codeChallenge).not.toBe(codeVerifier);
		expect(codeChallenge.length).toBe(43);
	});

	it("produces different values each call", () => {
		const a = generatePKCE();
		const b = generatePKCE();
		expect(a.codeVerifier).not.toBe(b.codeVerifier);
	});
});

describe("ACoderOAuthClient token storage", () => {
	it("loadAuth returns null when no auth file exists", () => {
		const dir = mkdtempSync(join(tmpdir(), "acoder-"));
		const client = new ACoderOAuthClient({ authPath: join(dir, "auth.json") });
		expect(client.loadAuth()).toBeNull();
		expect(client.isAuthenticated()).toBe(false);
	});

	it("refreshSessionToken persists the new token and flips isAuthenticated", async () => {
		const dir = mkdtempSync(join(tmpdir(), "acoder-"));
		const authPath = join(dir, "auth.json");
		const client = new ACoderOAuthClient({
			authPath,
			fetchImpl: (async (url: string, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body ?? "{}"));
				void url;
				return new Response(
					JSON.stringify({
						sessionToken: "new-session",
						refreshToken: body.refreshToken,
						expiresIn: 3600,
						userEmail: "u@x.com",
						userId: "u1",
					} satisfies ACoderTokenResponse),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}) as never,
		});
		const expired = {
			sessionToken: "old",
			refreshToken: "rt",
			expiresAt: 1,
			userEmail: "u@x.com",
			userId: "u1",
			provider: "github" as const,
		};
		writeFileSync(authPath, JSON.stringify(expired), { mode: 0o600 });
		expect(client.isAuthenticated()).toBe(false);
		const refreshed = await client.refreshSessionToken(expired);
		expect(refreshed.sessionToken).toBe("new-session");
		expect(refreshed.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
		expect(client.isAuthenticated()).toBe(true);
		const persisted = JSON.parse(readFileSync(authPath, "utf-8"));
		expect(persisted.sessionToken).toBe("new-session");
	});

	it("clearAuth removes credentials", () => {
		const dir = mkdtempSync(join(tmpdir(), "acoder-"));
		const authPath = join(dir, "auth.json");
		writeFileSync(
			authPath,
			JSON.stringify({
				sessionToken: "s",
				refreshToken: "r",
				expiresAt: 9999999999,
				userEmail: "u@x.com",
				userId: "u1",
				provider: "google",
			}),
			{ mode: 0o600 },
		);
		const client = new ACoderOAuthClient({ authPath });
		expect(client.isAuthenticated()).toBe(true);
		client.clearAuth();
		expect(client.isAuthenticated()).toBe(false);
	});
});

describe("ACoderOAuthClient models fetch", () => {
	it("fetchModels sends the session token as Bearer", async () => {
		const dir = mkdtempSync(join(tmpdir(), "acoder-"));
		const authPath = join(dir, "auth.json");
		writeFileSync(
			authPath,
			JSON.stringify({
				sessionToken: "tok",
				refreshToken: "r",
				expiresAt: Math.floor(Date.now() / 1000) + 3600,
				userEmail: "u@x.com",
				userId: "u1",
				provider: "google",
			}),
			{ mode: 0o600 },
		);
		const fetchCalls: Array<{ url: string; headers?: Record<string, string> }> = [];
		const client = new ACoderOAuthClient({
			authPath,
			backendUrl: "https://api.example/v1",
			fetchImpl: (async (url: string, init?: RequestInit) => {
				fetchCalls.push({ url: String(url), headers: init?.headers as Record<string, string> });
				return new Response(
					JSON.stringify({
						models: [{ id: "claude-sonnet-4", name: "Sonnet", contextLength: 200000, supportsTools: true }],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}) as never,
		});
		const result = await client.fetchModels();
		expect(result.models).toHaveLength(1);
		expect(result.models[0].id).toBe("claude-sonnet-4");
		expect(fetchCalls[0].url).toBe("https://api.example/v1/models");
		expect(fetchCalls[0].headers?.Authorization).toBe("Bearer tok");
	});

	it("fetchModels throws when not authenticated", async () => {
		const dir = mkdtempSync(join(tmpdir(), "acoder-"));
		const client = new ACoderOAuthClient({ authPath: join(dir, "auth.json") });
		await expect(client.fetchModels()).rejects.toThrow("Not authenticated");
	});
});

describe("ACoderOAuthClient signIn flow", () => {
	it("exchanges the code and persists tokens", async () => {
		const dir = mkdtempSync(join(tmpdir(), "acoder-"));
		const authPath = join(dir, "auth.json");
		const openedUrls: string[] = [];
		let exchangeBody: unknown;
		const client = new ACoderOAuthClient({
			authPath,
			backendUrl: "https://api.example/v1",
			openUrl: async (url: string) => {
				openedUrls.push(url);
				const params = new URL(url).searchParams;
				const redirectUri = params.get("redirect_uri")!;
				const state = params.get("state")!;
				// Defer so the callback server is ready, then simulate the browser redirect.
				setTimeout(async () => {
					const cbUrl = `${redirectUri}?code=CODE&state=${state}`;
					await fetch(cbUrl).catch(() => {});
				}, 50);
			},
			fetchImpl: (async (url: string, init?: RequestInit) => {
				if (String(url).endsWith("/auth/exchange")) {
					exchangeBody = JSON.parse(String(init?.body));
					return new Response(
						JSON.stringify({
							sessionToken: "session-tok",
							refreshToken: "refresh-tok",
							expiresIn: 3600,
							userEmail: "user@example.com",
							userId: "user-1",
						} satisfies ACoderTokenResponse),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response("", { status: 404 });
			}) as never,
		});

		const auth = await client.signIn("google");
		expect(auth.sessionToken).toBe("session-tok");
		expect(auth.userEmail).toBe("user@example.com");
		expect(auth.provider).toBe("google");
		expect(exchangeBody).toMatchObject({ code: "CODE" });
		expect((exchangeBody as { codeVerifier: string }).codeVerifier).toBeTruthy();
		expect(existsSync(authPath)).toBe(true);
		const persisted = JSON.parse(readFileSync(authPath, "utf-8"));
		expect(persisted.sessionToken).toBe("session-tok");
		expect(openedUrls[0]).toContain("/auth/google");
		expect(openedUrls[0]).toContain("code_challenge_method=S256");
	});

	it("rejects a mismatched state (CSRF)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "acoder-"));
		const client = new ACoderOAuthClient({
			authPath: join(dir, "auth.json"),
			backendUrl: "https://api.example/v1",
			openUrl: async (url: string) => {
				const params = new URL(url).searchParams;
				const redirectUri = params.get("redirect_uri")!;
				setTimeout(async () => {
					await fetch(`${redirectUri}?code=CODE&state=WRONG`).catch(() => {});
				}, 50);
			},
			fetchImpl: (async () => new Response("", { status: 200 })) as never,
		});
		await expect(client.signIn("github")).rejects.toThrow("Invalid OAuth state");
	});
});

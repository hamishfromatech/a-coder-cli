/**
 * OAuth compatibility surface.
 *
 * Upstream moved OAuth flows to per-provider `auth.oauth` entries resolved
 * through `auth/oauth/*`; this module adds the coding-agent's registry-style
 * API (`getOAuthProvider`, `registerOAuthProvider`, `getOAuthApiKey`, …) over
 * those static flows, with an adapter from the extension-facing
 * `OAuthLoginCallbacks` to the new `ProviderAuthInteraction`.
 */

export type {
	OAuthAuthInfo,
	OAuthCredentials,
	OAuthDeviceCodeInfo,
	OAuthLoginCallbacks,
	OAuthPrompt,
	OAuthProvider,
	OAuthProviderId,
	OAuthProviderInfo,
	OAuthProviderInterface,
	OAuthSelectOption,
	OAuthSelectPrompt,
} from "./compat/extension-oauth-types.ts";

import type { AuthInteraction, AuthPrompt, OAuthAuth, OAuthCredentials } from "./auth/types.ts";
import type { OAuthLoginCallbacks, OAuthProviderId, OAuthProviderInterface } from "./compat/extension-oauth-types.ts";
import { builtinProviders } from "./providers/all.ts";

// ============================================================================
// Callbacks → interaction adapter
// ============================================================================

/** Adapts the legacy callback surface to a normalized login prompt. */
async function promptFromCallbacks(callbacks: OAuthLoginCallbacks, prompt: AuthPrompt): Promise<string> {
	switch (prompt.type) {
		case "select":
			return callbacks
				.onSelect({ message: prompt.message, options: prompt.options.map((o) => ({ id: o.id, label: o.label })) })
				.then((id) => {
					if (id === undefined) {
						throw new Error("Login cancelled");
					}
					return id;
				});
		case "manual_code":
			if (!callbacks.onManualCodeInput) {
				throw new Error("This login flow requires manual code input, which this client does not support");
			}
			return callbacks.onManualCodeInput();
		case "secret":
		case "text":
			return callbacks.onPrompt({
				message: prompt.message,
				placeholder: prompt.placeholder,
				allowEmpty: false,
			});
	}
}

function notifyAuthEvent(callbacks: OAuthLoginCallbacks, event: { type: string } & Record<string, unknown>): void {
	switch (event.type) {
		case "device_code":
			callbacks.onDeviceCode({
				userCode: String(event.userCode ?? ""),
				verificationUri: String(event.verificationUri ?? ""),
				intervalSeconds: typeof event.intervalSeconds === "number" ? event.intervalSeconds : undefined,
				expiresInSeconds: typeof event.expiresInSeconds === "number" ? event.expiresInSeconds : undefined,
			});
			break;
		case "auth_url":
			callbacks.onAuth({ url: String(event.url ?? "") });
			break;
		case "progress":
		case "info":
			callbacks.onProgress?.(String(event.message ?? ""));
			break;
	}
}

function interactionFromCallbacks(callbacks: OAuthLoginCallbacks): AuthInteraction & { signal: AbortSignal } {
	const signal = callbacks.signal ?? new AbortController().signal;
	return {
		signal,
		prompt: (prompt: AuthPrompt) => promptFromCallbacks(callbacks, prompt),
		notify: (event) => notifyAuthEvent(callbacks, event as { type: string } & Record<string, unknown>),
	};
}

// ============================================================================
// Legacy registry over static provider OAuth flows
// ============================================================================

const oauthProviderRegistry = new Map<string, OAuthProviderInterface>();

/** Wrap a new-style OAuthAuth flow in the legacy registry-facing provider shape. */
function toLegacyProvider(id: string, name: string, flow: OAuthAuth): OAuthProviderInterface {
	return {
		id,
		name,
		loginLabel: flow.loginLabel,
		isSubscription: flow.isSubscription,
		usesCallbackServer: true,
		async login(callbacks: OAuthLoginCallbacks) {
			const options = callbacks.getDeviceId ? { getDeviceId: callbacks.getDeviceId } : undefined;
			const credential = await flow.login(interactionFromCallbacks(callbacks), options);
			return credential as OAuthCredentials;
		},
		async refreshToken(credentials: OAuthCredentials) {
			const refreshed = await flow.refresh(
				credentials as Parameters<OAuthAuth["refresh"]>[0],
				new AbortController().signal,
			);
			return refreshed as OAuthCredentials;
		},
		async getApiKey(credentials: OAuthCredentials) {
			const auth = await flow.toAuth(credentials as Parameters<OAuthAuth["toAuth"]>[0]);
			if (!auth.apiKey) {
				throw new Error(`OAuth login for ${id} produced no API key`);
			}
			return auth.apiKey;
		},
	};
}

/** Get an OAuth provider by ID — custom registrations win over built-in flows. */
export function getOAuthProvider(id: OAuthProviderId): OAuthProviderInterface | undefined {
	const custom = oauthProviderRegistry.get(id);
	if (custom) {
		return custom;
	}
	for (const provider of builtinProviders()) {
		if (provider.id === id && provider.auth.oauth) {
			return toLegacyProvider(id, provider.name, provider.auth.oauth);
		}
	}
	return undefined;
}

/** Register a custom OAuth provider (extensions, tests, custom provider configs). */
export function registerOAuthProvider(provider: OAuthProviderInterface): void {
	oauthProviderRegistry.set(provider.id, provider);
}

/**
 * Unregister an OAuth provider. Built-ins are never removed by this — the
 * registry only holds custom registrations, and lookups fall back to built-ins.
 */
export function unregisterOAuthProvider(id: string): void {
	oauthProviderRegistry.delete(id);
}

/** Reset custom OAuth registrations. */
export function resetOAuthProviders(): void {
	oauthProviderRegistry.clear();
}

/** All OAuth-capable providers: built-ins with a flow plus custom registrations. */
export function getOAuthProviders(): OAuthProviderInterface[] {
	const seen = new Set<string>();
	const result: OAuthProviderInterface[] = [];
	for (const provider of builtinProviders()) {
		if (provider.auth.oauth && !seen.has(provider.id)) {
			seen.add(provider.id);
			result.push(toLegacyProvider(provider.id, provider.name, provider.auth.oauth));
		}
	}
	for (const provider of oauthProviderRegistry.values()) {
		if (!seen.has(provider.id)) {
			seen.add(provider.id);
			result.push(provider);
		}
	}
	return result;
}

/**
 * Get API key for a provider from OAuth credentials.
 *
 * Note: unlike the pre-port registry, custom providers may expose async
 * `getApiKey`; the returned promise always resolves to the key pair.
 *
 * @returns API key string and updated credentials, or null when there are no
 * credentials or the provider is unknown
 * @throws Error if the refresh or key derivation fails
 */
export async function getOAuthApiKey(
	providerId: OAuthProviderId,
	credentials: Record<string, OAuthCredentials>,
): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> {
	const provider = getOAuthProvider(providerId) as
		| (OAuthProviderInterface & { getApiKey?: (c: OAuthCredentials) => Promise<string> })
		| undefined;
	if (!provider) {
		return null;
	}
	const creds = credentials[providerId];
	if (!creds) {
		return null;
	}
	const refreshed = await provider.refreshToken(creds);
	const apiKey = (await provider.getApiKey(refreshed)) as string;
	return { newCredentials: refreshed, apiKey };
}

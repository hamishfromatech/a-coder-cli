import type { OAuthCredentials } from "../auth/types.ts";

/** Legacy extension OAuth prompt. */
export interface OAuthPrompt {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
}

/** Legacy extension OAuth authorization link. */
export interface OAuthAuthInfo {
	url: string;
	instructions?: string;
}

/** Legacy extension OAuth device-code notification. */
export interface OAuthDeviceCodeInfo {
	userCode: string;
	verificationUri: string;
	intervalSeconds?: number;
	expiresInSeconds?: number;
}

export interface OAuthSelectOption {
	id: string;
	label: string;
}

export interface OAuthSelectPrompt {
	message: string;
	options: OAuthSelectOption[];
}

/** Callback surface retained only for coding-agent extension compatibility. */
export interface OAuthLoginCallbacks {
	onAuth(info: OAuthAuthInfo): void;
	onDeviceCode(info: OAuthDeviceCodeInfo): void;
	onPrompt(prompt: OAuthPrompt): Promise<string>;
	onProgress?(message: string): void;
	onManualCodeInput?(): Promise<string>;
	onSelect(prompt: OAuthSelectPrompt): Promise<string | undefined>;
	signal?: AbortSignal;
}

/** Legacy registry-facing provider id (string). */
export type OAuthProviderId = string;

/** @deprecated Use OAuthProviderId instead */
export type OAuthProvider = OAuthProviderId;

/** Registry-facing OAuth provider (legacy shape used by coding-agent + tests). */
export interface OAuthProviderInterface {
	readonly id: OAuthProviderId;
	readonly name: string;
	/** Optional selector label, e.g. "Sign in with SuperGrok or X Premium". */
	loginLabel?: string;
	/** Optional subscription marker for login menus. */
	isSubscription?: boolean;
	/** Whether login uses a local callback server and supports manual code input. */
	usesCallbackServer?: boolean;
	/** Run the login flow, return credentials to persist */
	login(callbacks: OAuthLoginCallbacks): OAuthCredentials | Promise<OAuthCredentials>;
	/** Refresh expired credentials, return updated credentials to persist */
	refreshToken(credentials: OAuthCredentials): OAuthCredentials | Promise<OAuthCredentials>;
	/** Convert credentials to API key string for the provider */
	getApiKey(credentials: OAuthCredentials): string | Promise<string>;
	/** Optional: modify models for this provider (e.g., update baseUrl) */
	modifyModels?(models: unknown[], credentials: OAuthCredentials): unknown[];
}

/** @deprecated Use OAuthProviderInterface instead */
export interface OAuthProviderInfo {
	id: OAuthProviderId;
	name: string;
	available: boolean;
}

export type { OAuthCredentials };

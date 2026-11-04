/**
 * Built-in keyless local model providers. Their auth resolver always returns a
 * no-key credential, so:
 *   - {@link ModelRegistry.getAvailable} treats their models as configured even
 *     without stored auth, and
 *   - the interactive /login flow skips the API-key dialog in favor of a
 *     base-URL dialog.
 *
 * Keep this list in sync with the built-in providers registered in
 * `@earendil-works/pi-ai` (`lm-studio`, `llama-cpp`, `ollama`, `unsloth`, `vllm`, `sglang`).
 */
export const KEYLESS_LOCAL_PROVIDERS: ReadonlySet<string> = new Set([
	"lm-studio",
	"llama-cpp",
	"ollama",
	"unsloth",
	"vllm",
	"sglang",
]);

/**
 * Sentinel API key for keyless local providers. The API layer requires a
 * non-empty key, so requests carry this placeholder (`Authorization: Bearer
 * not-needed`), which local servers ignore. This is the same credential the
 * `/login` base-URL dialog stores for these providers.
 */
export const KEYLESS_LOCAL_API_KEY = "not-needed";

/**
 * Per-keyless-provider env var holding the base URL of the local server, as set
 * via /login (stored in auth.json) or via `settings.json` `localProviders.*`.
 * The single source of truth for the env-var name each provider reads.
 */
export const KEYLESS_LOCAL_PROVIDER_ENV: Record<string, string> = {
	"lm-studio": "LM_STUDIO_BASE_URL",
	"llama-cpp": "LLAMACPP_BASE_URL",
	ollama: "OLLAMA_BASE_URL",
	unsloth: "UNSLOTH_BASE_URL",
	vllm: "VLLM_BASE_URL",
	sglang: "SGLANG_BASE_URL",
};

/**
 * Resolve a keyless local provider's base URL.
 *
 * `settings.json` `localProviders.*` is applied to `process.env` and is the
 * user-facing source of truth. A value stored in `auth.json` (for example by
 * an earlier `/login` with the default URL) must not override a newer setting,
 * otherwise model discovery silently polls the stale server.
 */
export function resolveLocalProviderBaseUrl(provider: string, storedEnv?: Record<string, string>): string | undefined {
	const envName = KEYLESS_LOCAL_PROVIDER_ENV[provider];
	if (!envName) return undefined;
	const fromSettings = typeof process !== "undefined" ? process.env[envName] : undefined;
	return fromSettings || storedEnv?.[envName];
}

/**
 * Stored provider env with the settings-applied base URL taking precedence.
 * Passed to the auth resolver so requests and model discovery use the same
 * server as the settings UI.
 */
export function withLocalProviderEnv(
	provider: string,
	storedEnv?: Record<string, string>,
): Record<string, string> | undefined {
	const envName = KEYLESS_LOCAL_PROVIDER_ENV[provider];
	const baseUrl = resolveLocalProviderBaseUrl(provider, storedEnv);
	if (!envName || !baseUrl) return storedEnv;
	return { ...storedEnv, [envName]: baseUrl };
}

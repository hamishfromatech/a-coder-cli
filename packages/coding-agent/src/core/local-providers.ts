/**
 * Built-in keyless local model providers. Their auth resolver always returns a
 * no-key credential, so:
 *   - {@link ModelRegistry.getAvailable} treats their models as configured even
 *     without stored auth, and
 *   - the interactive /login flow skips the API-key dialog in favor of a
 *     base-URL dialog.
 *
 * Keep this list in sync with the built-in providers registered in
 * `@earendil-works/pi-ai` (`lm-studio`, `llama-cpp`, `ollama`).
 */
export const KEYLESS_LOCAL_PROVIDERS: ReadonlySet<string> = new Set(["lm-studio", "llama-cpp", "ollama"]);

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
};

/** Optional OAuth settings for an HTTP/SSE MCP server. `true` uses the
 *  engine's loopback callback and dynamic client registration. */
export interface McpOAuthSettings {
	/** Requested scopes; merged with the server's advertised scopes by the SDK. */
	scopes?: string[];
	/** Pre-registered client id. Omit to use dynamic client registration. */
	clientId?: string;
	/** Pre-registered client secret. Supports a single `${ENV_VAR}` placeholder. */
	clientSecret?: string;
	/** SEP-991 client metadata document URL, when the server supports it. */
	clientMetadataUrl?: string;
}

export interface McpServerConfig {
	name: string;
	transport: "stdio" | "http" | "sse";
	commandOrUrl: string;
	args?: string[];
	/** Environment entries. A value that is exactly `${ENV_VAR}` is resolved
	 *  from the parent environment at connect time; a missing variable drops
	 *  the key rather than passing the literal placeholder. */
	env?: Record<string, string>;
	/** HTTP/SSE headers. Values support the same single `${ENV_VAR}` form. */
	headers?: Record<string, string>;
	/**
	 * Regex sources (tested per stderr line) whose matching lines are dropped
	 * from the captured MCP server log. Only applied to stdio transports, and
	 * only when non-empty. Use to silence known-benign server noise, e.g.
	 * chrome-devtools-mcp's "No handler registered for issue code ...".
	 */
	suppressStderrPatterns?: string[];
	/**
	 * Forward captured stdio stderr to the terminal in addition to the MCP log
	 * file. Defaults to false so server banners, warnings, and debug output do
	 * not corrupt the TUI/chat. Set true only while debugging a server; the
	 * tail is always preserved for connection-failure errors.
	 */
	forwardStderr?: boolean;
	/**
	 * Timeout in ms for requests to this server (tool calls and the connection
	 * handshake). Defaults to the MCP SDK's 60s. Increase for slow servers
	 * (e.g. browser automation, long-running queries).
	 */
	timeoutMs?: number;
	disabled?: boolean;
	/** Enable OAuth for an HTTP/SSE server. */
	oauth?: boolean | McpOAuthSettings;
	/**
	 * Where this server's effective config came from: the project
	 * `.a-coder-cli/settings.json` (same-name project overrides global) or the
	 * global agent settings. Annotated by settings-manager.getMcpServers —
	 * never persisted in settings files.
	 */
	source?: "global" | "project";
}

/**
 * chrome-devtools-mcp logs this to stderr for every MCP "issue" notification
 * the client doesn't subscribe to (e.g. its PerformanceIssue insights) — pure
 * log noise while DevTools collects metrics mid-run.
 */
const CHROME_DEVTOOLS_NOISE_PATTERN = "No handler registered for issue code";

/**
 * Built-in stderr suppression for known-noisy MCP servers, applied by
 * settings-manager when the server configures no explicit
 * `suppressStderrPatterns` (pass `[]` to opt out). Matched loosely on
 * name/command so a custom server name still qualifies.
 */
export function defaultStderrSuppressPatterns(
	server: Pick<McpServerConfig, "name" | "commandOrUrl" | "args">,
): string[] {
	const haystack = [server.name, server.commandOrUrl, ...(server.args ?? [])].join(" ");
	if (/chrome-devtools/i.test(haystack)) return [CHROME_DEVTOOLS_NOISE_PATTERN];
	return [];
}

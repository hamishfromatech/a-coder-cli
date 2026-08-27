export interface McpServerConfig {
	name: string;
	transport: "stdio" | "http" | "sse";
	commandOrUrl: string;
	args?: string[];
	env?: Record<string, string>;
	headers?: Record<string, string>;
	/**
	 * Regex sources (tested per stderr line) whose matching lines are dropped
	 * from the MCP server's stderr before it reaches the terminal. Only applied
	 * to stdio transports, and only when non-empty (otherwise stderr is
	 * inherited unchanged). Use to silence known-benign server noise, e.g.
	 * chrome-devtools-mcp's "No handler registered for issue code ...".
	 */
	suppressStderrPatterns?: string[];
	/**
	 * Timeout in ms for requests to this server (tool calls and the connection
	 * handshake). Defaults to the MCP SDK's 60s. Increase for slow servers
	 * (e.g. browser automation, long-running queries).
	 */
	timeoutMs?: number;
	disabled?: boolean;
}

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
	disabled?: boolean;
}

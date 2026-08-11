export interface McpServerConfig {
	name: string;
	transport: "stdio" | "http" | "sse";
	commandOrUrl: string;
	args?: string[];
	env?: Record<string, string>;
	headers?: Record<string, string>;
	disabled?: boolean;
}

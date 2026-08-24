export { McpClient, type McpDiscoveredTool } from "./client.ts";
export {
	cliMcpToIde,
	type IdeMcpConfigEntry,
	type IdeMcpConfigFile,
	ideMcpToCli,
	mergeIdeMcpIntoCli,
} from "./config-converter.ts";
export { createMcpExtensionFactory } from "./inline-extension.ts";
export { jsonSchemaToTypeBox } from "./schema.ts";
export type { McpServerConfig } from "./types.ts";

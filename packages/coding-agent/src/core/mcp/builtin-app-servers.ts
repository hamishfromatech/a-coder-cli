/**
 * Built-in MCP integrations for the game, 3D and design apps users already
 * run. They are shipped disabled so a fresh install never pays a startup cost
 * for an app it does not have; enabling one is a deliberate choice in the
 * desktop MCP editor (or settings.json).
 *
 * Each entry is also the source of the desktop "App integrations" catalog, so
 * existing installs can add a server that was seeded only into fresh settings
 * files. All of these are third-party MCP servers launched over stdio/HTTP;
 * none of their code ships in this package.
 */

import type { McpServerConfig } from "./types.ts";

export interface McpAppCatalogEntry {
	/** Stable catalog id; also the default server name. */
	id: string;
	/** MCP server name; tool names become mcp__<name>__<tool>. */
	name: string;
	title: string;
	description: string;
	/** Human-readable prerequisites shown in the desktop editor. */
	requirements: string;
	docsUrl: string;
	/** Seed into fresh-install settings. Defaults to true; false entries are
	 *  catalog-only alternatives. */
	seed?: boolean;
	config: McpServerConfig;
}

/** Build an npx launcher. Windows needs cmd /c because npx is a .cmd shim the
 *  MCP SDK cannot execute directly (same rule as chrome-devtools-mcp). */
function npx(args: string[]): Pick<McpServerConfig, "commandOrUrl" | "args"> {
	return process.platform === "win32"
		? { commandOrUrl: "cmd", args: ["/c", "npx", ...args] }
		: { commandOrUrl: "npx", args };
}

const ENTRIES: McpAppCatalogEntry[] = [
	{
		id: "blender",
		name: "blender",
		title: "Blender",
		description: "Model, dress and light scenes through the MCP for Blender add-on.",
		requirements: "uv, Blender 4.x, and the MCP for Blender add-on enabled in Blender.",
		docsUrl: "https://github.com/ahujasid/mcp-for-blender",
		config: {
			name: "blender",
			transport: "stdio",
			commandOrUrl: "uvx",
			args: ["mcp-for-blender"],
		},
	},
	{
		id: "unity",
		name: "unity",
		title: "Unity",
		description: "Inspect assets, scenes and scripts and run editor automation in Unity.",
		requirements: "Unity Editor with the MCP for Unity package, plus Python 3.10+ and uv.",
		docsUrl: "https://github.com/CoplayDev/unity-mcp",
		config: {
			name: "unity",
			transport: "stdio",
			commandOrUrl: "uvx",
			args: ["--from", "mcpforunityserver", "mcp-for-unity", "--transport", "stdio"],
		},
	},
	{
		id: "unreal-engine",
		name: "unreal-engine",
		title: "Unreal Engine",
		description: "Drive Blueprints, scenes and assets through the EngineWire plugin's native MCP server.",
		requirements: "Unreal Engine 5 with the EngineWire plugin and its Native MCP Server enabled on port 3000.",
		docsUrl: "https://github.com/ChiR24/Unreal_mcp",
		config: {
			name: "unreal-engine",
			transport: "http",
			commandOrUrl: "http://127.0.0.1:3000/mcp",
			timeoutMs: 120_000,
		},
	},
	{
		id: "figma",
		name: "figma",
		title: "Figma",
		description: "Read design context, variables and assets from Figma files for implementation.",
		requirements: "A Figma personal access token in FIGMA_API_KEY (environment or Environment variables).",
		docsUrl: "https://github.com/glips/figma-context-mcp",
		config: {
			name: "figma",
			transport: "stdio",
			...npx(["-y", "figma-developer-mcp", "--stdio"]),
			// biome-ignore lint/suspicious/noTemplateCurlyInString: deliberate placeholder resolved from the environment at connect time
			env: { FIGMA_API_KEY: "${FIGMA_API_KEY}" },
		},
	},
	{
		id: "figma-oauth",
		name: "figma-oauth",
		title: "Figma (official OAuth)",
		description: "The official Figma remote MCP server, using browser OAuth instead of a personal token.",
		requirements:
			"A Figma account and a client the Figma MCP server accepts. Generic OAuth registration may be refused; use the token entry if it is.",
		docsUrl: "https://github.com/figma/mcp-server-guide",
		seed: false,
		config: {
			name: "figma-oauth",
			transport: "http",
			commandOrUrl: "https://mcp.figma.com/mcp",
			timeoutMs: 120_000,
			oauth: true,
		},
	},
	{
		id: "godot",
		name: "godot",
		title: "Godot",
		description: "Launch, inspect and modify Godot projects, scenes and scripts.",
		requirements: "Node.js/npx. Set GODOT_PATH if auto-detection fails.",
		docsUrl: "https://github.com/Coding-Solo/godot-mcp",
		config: {
			name: "godot",
			transport: "stdio",
			...npx(["-y", "@coding-solo/godot-mcp"]),
			// biome-ignore lint/suspicious/noTemplateCurlyInString: deliberate placeholder resolved from the environment at connect time
			env: { GODOT_PATH: "${GODOT_PATH}" },
		},
	},
	{
		id: "roblox-studio",
		name: "roblox-studio",
		title: "Roblox Studio",
		description: "Explore places, read and edit scripts, and manipulate instances in Roblox Studio.",
		requirements: "Install the Roblox Studio plugin and enable Allow HTTP Requests in the experience settings.",
		docsUrl: "https://github.com/boshyxd/robloxstudio-mcp",
		config: {
			name: "roblox-studio",
			transport: "stdio",
			...npx(["-y", "robloxstudio-mcp@latest"]),
		},
	},
];

function cloneEntry(entry: McpAppCatalogEntry): McpAppCatalogEntry {
	const { config } = entry;
	return {
		...entry,
		config: {
			...config,
			args: config.args ? [...config.args] : undefined,
			env: config.env ? { ...config.env } : undefined,
			headers: config.headers ? { ...config.headers } : undefined,
		},
	};
}

/** Catalog for the desktop MCP editor and doctor-style surfaces. */
export function getMcpAppCatalog(): McpAppCatalogEntry[] {
	return ENTRIES.map(cloneEntry);
}

/** Fresh-install seed: every integration is present but disabled. */
export function defaultAppMcpServers(): McpServerConfig[] {
	return ENTRIES.filter((entry) => entry.seed !== false).map((entry) => ({
		...cloneEntry(entry).config,
		disabled: true,
	}));
}

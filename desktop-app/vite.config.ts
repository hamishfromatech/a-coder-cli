import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Monaco ships an exports map that blocks both bare-subpath and package.json
 * resolution (its main entry resolves for require, though). Locating the
 * package root by walking up from the resolved main entry gives us a stable
 * alias for the ?worker imports that works under BOTH install layouts: the
 * npm-workspaces hoist (deps at the repo root) and the desktop CI standalone
 * install (`npm ci --no-workspaces`, deps inside desktop-app/).
 */
function locateMonacoRoot(): string {
	const require = createRequire(import.meta.url);
	let dir = path.dirname(require.resolve("monaco-editor"));
	for (let steps = 0; steps < 8; steps += 1) {
		if (existsSync(path.join(dir, "package.json"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve("node_modules/monaco-editor");
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
	plugins: [react()],
	resolve: {
		alias: {
			"@monaco-editor-root": locateMonacoRoot(),
		},
	},
	// Vite options tailored for Tauri development and explicit separation from the CLI's own port usage.
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			// 3. tell vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
			hmr: {
			protocol: "ws",
			host: "127.0.0.1",
			port: 1421,
		},
	},
}));

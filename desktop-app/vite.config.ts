import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
	plugins: [react()],
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

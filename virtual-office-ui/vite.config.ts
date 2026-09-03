import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone dev/preview config — the desktop app imports src/ directly, so
// this file only serves the mock harness in this folder.
export default defineConfig({
	plugins: [react()],
	server: { port: 1425 },
});
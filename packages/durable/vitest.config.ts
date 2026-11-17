import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Run in workerd by their own config: `npm run test:workers`.
		exclude: [...configDefaults.exclude, "test-workers/**"],
	},
});

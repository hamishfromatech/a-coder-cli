import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveComposioConfig } from "../src/core/composio.ts";

describe("resolveComposioConfig", () => {
	const origKey = process.env.COMPOSIO_API_KEY;
	beforeEach(() => {
		delete process.env.COMPOSIO_API_KEY;
	});
	afterEach(() => {
		if (origKey === undefined) delete process.env.COMPOSIO_API_KEY;
		else process.env.COMPOSIO_API_KEY = origKey;
	});

	it("returns null when nothing is configured", () => {
		expect(resolveComposioConfig(undefined)).toBeNull();
		expect(resolveComposioConfig({})).toBeNull();
	});

	it("returns null when enabled but no api key is present", () => {
		expect(resolveComposioConfig({ enabled: true })).toBeNull();
	});

	it("returns null when an api key is present but enabled is explicitly false", () => {
		process.env.COMPOSIO_API_KEY = "k_secret";
		expect(resolveComposioConfig({ enabled: false })).toBeNull();
	});

	it("enables implicitly when an api key is present and enabled is unset", () => {
		process.env.COMPOSIO_API_KEY = "k_secret";
		const cfg = resolveComposioConfig(undefined);
		expect(cfg).not.toBeNull();
		expect(cfg?.apiKey).toBe("k_secret");
	});

	it("env api key takes precedence over settings api key", () => {
		process.env.COMPOSIO_API_KEY = "env_key";
		const cfg = resolveComposioConfig({ apiKey: "settings_key", toolkits: ["github"] });
		expect(cfg?.apiKey).toBe("env_key");
		expect(cfg?.toolkits).toEqual(["github"]);
	});

	it("falls back to settings api key when env is absent", () => {
		const cfg = resolveComposioConfig({ apiKey: "settings_key", sandbox: true });
		expect(cfg?.apiKey).toBe("settings_key");
		expect(cfg?.sandbox).toBe(true);
	});
});

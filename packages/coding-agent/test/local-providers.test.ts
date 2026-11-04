import { afterEach, describe, expect, it } from "vitest";
import { resolveLocalProviderBaseUrl, withLocalProviderEnv } from "../src/core/local-providers.ts";

const ENV = "LLAMACPP_BASE_URL";

afterEach(() => {
	delete process.env[ENV];
});

describe("local provider base URL precedence", () => {
	it("settings-applied env wins over a stale auth.json URL", () => {
		process.env[ENV] = "https://cpp.atechds.com/v1";
		const stored = { LLAMACPP_BASE_URL: "http://localhost:8080/v1" };

		expect(resolveLocalProviderBaseUrl("llama-cpp", stored)).toBe("https://cpp.atechds.com/v1");
		expect(withLocalProviderEnv("llama-cpp", stored)).toEqual({
			LLAMACPP_BASE_URL: "https://cpp.atechds.com/v1",
		});
	});

	it("falls back to the stored URL when no setting is applied", () => {
		const stored = { LLAMACPP_BASE_URL: "http://localhost:8080/v1" };

		expect(resolveLocalProviderBaseUrl("llama-cpp", stored)).toBe("http://localhost:8080/v1");
		expect(withLocalProviderEnv("llama-cpp", stored)).toEqual(stored);
	});

	it("does not invent a URL for non-local providers", () => {
		expect(resolveLocalProviderBaseUrl("anthropic", { ANTHROPIC_API_KEY: "x" })).toBeUndefined();
	});
});

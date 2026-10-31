import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatUserAgent, getAttributionHeaders, mergeClientIdentity, PI_ATTRIBUTION } from "../src/utils/identity.ts";
import { PI_AI_VERSION } from "../src/utils/version.ts";

describe("client identity", () => {
	it("keeps the version constant in lockstep with package.json", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			version: string;
		};
		expect(PI_AI_VERSION).toBe(pkg.version);
	});

	it("formats short, detailed, and custom user agents", () => {
		expect(formatUserAgent({ userAgent: "short" })).toBe("pi");
		expect(formatUserAgent({ userAgent: "detailed", version: "9.9.9" })).toContain("pi/9.9.9");
		expect(formatUserAgent({ userAgent: { custom: "my-app/1.0" } })).toBe("my-app/1.0");
	});

	it("maps attribution per provider", () => {
		const identity = { attribution: PI_ATTRIBUTION };
		const openrouter = getAttributionHeaders(
			{ provider: "openrouter", baseUrl: "https://openrouter.ai/api" },
			identity,
		);
		expect(openrouter["HTTP-Referer"]).toBe("https://pi.dev");
		expect(openrouter["X-OpenRouter-Title"]).toBe("pi");
		expect(openrouter["X-OpenRouter-Categories"]).toBe("cli-agent");

		const nvidia = getAttributionHeaders({ provider: "nvidia", baseUrl: "https://x.dev" }, identity);
		expect(nvidia["X-BILLING-INVOKE-ORIGIN"]).toBe("Pi");

		const other = getAttributionHeaders({ provider: "openai", baseUrl: "https://api.openai.com" }, identity);
		expect(other).toEqual({});
	});

	it("merges identities field by field with later sources winning", () => {
		const merged = mergeClientIdentity(
			{ userAgent: "short", attribution: PI_ATTRIBUTION },
			{ attribution: null },
			undefined,
		);
		expect(merged).toEqual({ userAgent: "short", attribution: null });
	});
});

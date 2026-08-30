import { describe, expect, it } from "vitest";
import { extractRetryAfterMs, parseRetryAfterValue } from "../../ai/src/utils/retry.ts";

describe("extractRetryAfterMs", () => {
	it("reads retry-after (seconds) from a Headers object", () => {
		const headers = new Headers({ "retry-after": "2" });
		expect(extractRetryAfterMs({ headers })).toBe(2000);
	});

	it("reads retry-after-ms as milliseconds", () => {
		const headers = new Headers({ "retry-after-ms": "750" });
		expect(extractRetryAfterMs({ headers })).toBe(750);
	});

	it("reads retry-after from a plain header record", () => {
		expect(extractRetryAfterMs({ headers: { "retry-after": "3" } })).toBe(3000);
	});

	it("parses HTTP-date values relative to now", () => {
		const future = new Date(Date.now() + 5_000).toUTCString();
		const value = extractRetryAfterMs({ headers: { "retry-after": future } });
		expect(value).toBeGreaterThan(0);
		expect(value).toBeLessThanOrEqual(5_000);
		// Past dates clamp to zero.
		const past = new Date(Date.now() - 60_000).toUTCString();
		expect(extractRetryAfterMs({ headers: { "retry-after": past } })).toBe(0);
	});

	it("reads SDK retryAfterMs / numeric retryAfter fields", () => {
		expect(extractRetryAfterMs({ retryAfterMs: 1250 })).toBe(1250);
		expect(extractRetryAfterMs({ retryAfter: 900 })).toBe(900);
		expect(extractRetryAfterMs({ retryAfterMs: "500" })).toBe(500);
	});

	it("reads Bedrock-style $response.headers", () => {
		const headers = new Headers({ "retry-after": "1" });
		expect(extractRetryAfterMs({ $response: { headers } })).toBe(1000);
	});

	it("returns undefined when no hint exists", () => {
		expect(extractRetryAfterMs(new Error("boom"))).toBeUndefined();
		expect(extractRetryAfterMs(undefined)).toBeUndefined();
		expect(extractRetryAfterMs({ headers: {} })).toBeUndefined();
		expect(extractRetryAfterMs({ retryAfter: "not-a-number-or-date" })).toBeUndefined();
	});
});

describe("parseRetryAfterValue", () => {
	it("parses plain seconds", () => {
		expect(parseRetryAfterValue("0")).toBe(0);
		expect(parseRetryAfterValue("30")).toBe(30_000);
	});

	it("parses HTTP-dates", () => {
		const now = Date.now();
		const value = parseRetryAfterValue(new Date(now + 1_000).toUTCString());
		expect(value).toBeGreaterThan(0);
		expect(value).toBeLessThanOrEqual(1_000);
	});

	it("returns undefined for garbage", () => {
		expect(parseRetryAfterValue("soon-ish")).toBeUndefined();
	});
});

import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../lib/normalize-url";

describe("normalizeUrl", () => {
	it("defaults localhost to http", () => {
		expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000/");
		expect(normalizeUrl("127.0.0.1:5173/app")).toBe("http://127.0.0.1:5173/app");
		expect(normalizeUrl("app.localhost")).toBe("http://app.localhost/");
	});

	it("keeps https for public hosts and explicit schemes", () => {
		expect(normalizeUrl("example.com")).toBe("https://example.com/");
		expect(normalizeUrl("http://example.com/x")).toBe("http://example.com/x");
	});
});

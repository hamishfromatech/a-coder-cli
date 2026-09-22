import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthoritativeSession, isAuthoritativeSession, setAuthoritativeSession } from "./session-authority";

describe("session authority marker", () => {
	beforeEach(() => {
		resetAuthoritativeSession();
	});

	it("is authoritative only for the marked file", () => {
		setAuthoritativeSession("/s/a.jsonl");
		expect(isAuthoritativeSession("/s/a.jsonl")).toBe(true);
		expect(isAuthoritativeSession("/s/b.jsonl")).toBe(false);
	});

	it("clears on reset and never matches null", () => {
		setAuthoritativeSession("/s/a.jsonl");
		resetAuthoritativeSession();
		expect(isAuthoritativeSession("/s/a.jsonl")).toBe(false);
		expect(isAuthoritativeSession(null)).toBe(false);
		expect(isAuthoritativeSession(undefined)).toBe(false);
	});
});
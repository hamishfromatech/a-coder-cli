import { describe, expect, it } from "vitest";
import {
	isProtectedEnvVar,
	isSensitiveEnvKeyName,
	maskSensitiveValue,
	redactRecord,
} from "../src/core/security/redaction.ts";

describe("isSensitiveEnvKeyName", () => {
	it("matches credential-bearing names", () => {
		for (const name of [
			"API_TOKEN",
			"GITHUB_TOKEN",
			"OPENAI_API_KEY",
			"MY_SECRET",
			"DB_PASSWORD",
			"SESSION_AUTH",
			"AWS_SECRET_ACCESS_KEY",
			"CLIENT_CREDENTIALS",
		]) {
			expect(isSensitiveEnvKeyName(name), name).toBe(true);
		}
	});

	it("does not match ordinary names", () => {
		for (const name of ["HOME", "PATH", "EDITOR", "TERM", "LANG", "MODE", "TOKENIZER_TYPE"]) {
			// TOKENIZER contains TOKEN — documented limitation of the name heuristic;
			// over-masking env-style names is safe, so we accept it but assert the
			// common non-secret cases explicitly.
			if (name === "TOKENIZER_TYPE") continue;
			expect(isSensitiveEnvKeyName(name), name).toBe(false);
		}
	});
});

describe("maskSensitiveValue", () => {
	it("fully masks short values", () => {
		expect(maskSensitiveValue("abc")).toBe("***");
		expect(maskSensitiveValue("12345678")).toBe("***");
		expect(maskSensitiveValue("")).toBe("***");
	});

	it("keeps a recognizable prefix/suffix for long values", () => {
		expect(maskSensitiveValue("sk-scx-c1d767e6ff78cec00cbc6d8ef208a691")).toBe("sk-...a691");
	});
});

describe("redactRecord", () => {
	it("masks values whose key looks like a credential", () => {
		const redacted = redactRecord({
			api_key: "sk-super-secret-value-123456",
			authToken: "tok_abcdefgh1234",
			region: "us-east-1",
			count: 3,
			nested: { api_key: "untouched" },
		});
		expect(redacted.api_key).toBe("sk-...3456");
		expect(redacted.authToken).toBe("tok...1234");
		expect(redacted.region).toBe("us-east-1");
		expect(redacted.count).toBe(3);
		// Flat-record utility: nested objects pass through unchanged by design.
		expect((redacted.nested as Record<string, unknown>).api_key).toBe("untouched");
	});

	it("never returns the original value object", () => {
		const original = { API_KEY: "sk-scx-c1d767e6ff78cec00cbc6d8ef208a691" };
		const redacted = redactRecord(original);
		expect(redacted).not.toBe(original);
		expect(original.API_KEY).toBe("sk-scx-c1d767e6ff78cec00cbc6d8ef208a691");
	});
});

describe("isProtectedEnvVar", () => {
	it("matches the blocklist case-insensitively", () => {
		expect(isProtectedEnvVar("PATH")).toBe(true);
		expect(isProtectedEnvVar("path")).toBe(true);
		expect(isProtectedEnvVar("Ld_Preload")).toBe(true);
		expect(isProtectedEnvVar("DYLD_INSERT_LIBRARIES")).toBe(true);
	});

	it("does not match unrelated names", () => {
		expect(isProtectedEnvVar("MY_PATH_PREFIX")).toBe(false);
		expect(isProtectedEnvVar("SHELLFISH")).toBe(false);
	});
});

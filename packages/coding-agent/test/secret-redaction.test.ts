import { describe, expect, it } from "vitest";
import { REDACTION_MARKER, redactSecrets } from "../src/core/secret-redaction.ts";

describe("redactSecrets", () => {
	it("replaces provider-issued keys", () => {
		const text = [
			"ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
			"openai sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
			"ghp_abcdEFGH1234567890abcdefghijklmno",
			"xoxb-123456789012-abcdefghijkl",
			"AKIAABCDEFGHIJKLMNOP",
			"AIzaSyA1234567890abcdefghijklmnopqrstuv",
		].join("\n");
		const { text: out, redacted } = redactSecrets(text);
		expect(redacted).toBe(6);
		expect(out).not.toContain("sk-ant-");
		expect(out).not.toContain("ghp_");
		expect(out).not.toContain("xoxb-");
		expect(out).not.toContain("AKIA");
		expect(out).not.toContain("AIza");
		expect(out).toContain(REDACTION_MARKER);
	});

	it("keeps the Bearer scheme but drops the credential", () => {
		const { text, redacted } = redactSecrets("Authorization: Bearer abcdefghijklmnop1234");
		expect(redacted).toBe(1);
		expect(text).toContain(`Bearer ${REDACTION_MARKER}`);
		expect(text).not.toContain("abcdefghijklmnop1234");
	});

	it("scrubs key/value assignments while keeping the key name", () => {
		const { text } = redactSecrets('{"api_key": "supersecretvalue123456", "token": "anothervalue987654"}');
		expect(text).toContain("api_key");
		expect(text).toContain("token");
		expect(text).not.toContain("supersecretvalue123456");
		expect(text).not.toContain("anothervalue987654");
	});

	it("removes multiline PEM private keys", () => {
		const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----";
		const { text, redacted } = redactSecrets(`before\n${pem}\nafter`);
		expect(redacted).toBe(1);
		expect(text).toBe(`before\n${REDACTION_MARKER}\nafter`);
	});

	it("leaves ordinary prose and short values alone", () => {
		const prose = "The token is stored in the vault; use your password manager. api key rotation is quarterly.";
		const { text, redacted } = redactSecrets(prose);
		expect(redacted).toBe(0);
		expect(text).toBe(prose);
	});

	it("can be applied repeatedly without corrupting the marker", () => {
		const once = redactSecrets("token=abcdefghijklmnop").text;
		const twice = redactSecrets(once).text;
		expect(twice).toBe(once);
	});
});

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAcpConfigEntry } from "../src/core/acp/acp-config-writer.ts";

describe("ensureAcpConfigEntry", () => {
	it("creates the file and entry when absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "acp-cfg-"));
		const path = join(dir, ".a-coder", "acp.json");
		const changed = ensureAcpConfigEntry({ name: "a-coder-cli", url: "http://127.0.0.1:5432", configPath: path });
		expect(changed).toBe(true);
		expect(existsSync(path)).toBe(true);
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		expect(parsed.acpServers["a-coder-cli"].url).toBe("http://127.0.0.1:5432");
	});

	it("preserves existing servers when adding a new one", () => {
		const dir = mkdtempSync(join(tmpdir(), "acp-cfg-"));
		const path = join(dir, "acp.json");
		writeFileSync(path, JSON.stringify({ acpServers: { "other-agent": { url: "http://localhost:9999" } } }));
		ensureAcpConfigEntry({ name: "a-coder-cli", url: "http://127.0.0.1:5432", configPath: path });
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		expect(parsed.acpServers["other-agent"].url).toBe("http://localhost:9999");
		expect(parsed.acpServers["a-coder-cli"].url).toBe("http://127.0.0.1:5432");
	});

	it("updates the URL for an existing entry", () => {
		const dir = mkdtempSync(join(tmpdir(), "acp-cfg-"));
		const path = join(dir, "acp.json");
		writeFileSync(path, JSON.stringify({ acpServers: { "a-coder-cli": { url: "http://127.0.0.1:1" } } }));
		const changed = ensureAcpConfigEntry({ name: "a-coder-cli", url: "http://127.0.0.1:2", configPath: path });
		expect(changed).toBe(true);
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		expect(parsed.acpServers["a-coder-cli"].url).toBe("http://127.0.0.1:2");
	});

	it("returns false (no write) when the entry already matches", () => {
		const dir = mkdtempSync(join(tmpdir(), "acp-cfg-"));
		const path = join(dir, "acp.json");
		writeFileSync(path, JSON.stringify({ acpServers: { "a-coder-cli": { url: "http://127.0.0.1:5432" } } }));
		const mtimeBefore = require("node:fs").statSync(path).mtimeMs;
		const changed = ensureAcpConfigEntry({ name: "a-coder-cli", url: "http://127.0.0.1:5432", configPath: path });
		expect(changed).toBe(false);
		const mtimeAfter = require("node:fs").statSync(path).mtimeMs;
		expect(mtimeAfter).toBe(mtimeBefore);
	});

	it("recovers from a malformed config file", () => {
		const dir = mkdtempSync(join(tmpdir(), "acp-cfg-"));
		const path = join(dir, "acp.json");
		writeFileSync(path, "{ not valid json");
		ensureAcpConfigEntry({ name: "a-coder-cli", url: "http://127.0.0.1:5432", configPath: path });
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		expect(parsed.acpServers["a-coder-cli"].url).toBe("http://127.0.0.1:5432");
	});

	it("writes headers when provided", () => {
		const dir = mkdtempSync(join(tmpdir(), "acp-cfg-"));
		const path = join(dir, "acp.json");
		ensureAcpConfigEntry({
			name: "a-coder-cli",
			url: "http://127.0.0.1:5432",
			headers: { Authorization: "Bearer x" },
			configPath: path,
		});
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		expect(parsed.acpServers["a-coder-cli"].headers.Authorization).toBe("Bearer x");
	});
});

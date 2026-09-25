import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	bearerFromHeader,
	generateToken,
	loadToken,
	machineId,
	manualChunks,
	pairingPayload,
	resolveToken,
	saveToken,
	serveDir,
	tokenFromUrl,
	tokenMatches,
} from "../../src/serve/pairing.ts";

// The token store lives under getAgentDir(); point that env var at a fresh
// temp dir for the whole file so tests never touch the real agent dir.
const SAVED_ENV = process.env.A_CODER_CLI_CODING_AGENT_DIR;
let tempAgentDir = "";

beforeAll(() => {
	tempAgentDir = fs.mkdtempSync(join(os.tmpdir(), "acoder-serve-test-"));
	process.env.A_CODER_CLI_CODING_AGENT_DIR = tempAgentDir;
});

afterAll(() => {
	if (SAVED_ENV !== undefined) {
		process.env.A_CODER_CLI_CODING_AGENT_DIR = SAVED_ENV;
	} else {
		delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	}
	fs.rmSync(tempAgentDir, { recursive: true, force: true });
});

describe("pairing tokens", () => {
	it("generates URL-safe 43-char base64url tokens", () => {
		const token = generateToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(generateToken()).not.toBe(token);
	});

	it("persists the token and loads it back", () => {
		const token = saveToken("abc");
		expect(token).toBe("abc");
		expect(loadToken()).toBe("abc");
	});

	it("resolveToken generates + persists when nothing exists", () => {
		fs.rmSync(serveDir(), { recursive: true, force: true });
		expect(loadToken()).toBeNull();
		const token = resolveToken({});
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(loadToken()).toBe(token);
	});

	it("resolveToken prefers an explicit override without persisting it", () => {
		fs.rmSync(serveDir(), { recursive: true, force: true });
		resolveToken({ token: "explicit" });
		expect(loadToken()).toBeNull();
		expect(resolveToken({ token: "explicit" })).toBe("explicit");
	});

	it("resolveToken rotates when asked", () => {
		const first = resolveToken({});
		const second = resolveToken({ rotate: true });
		expect(second).not.toBe(first);
		expect(loadToken()).toBe(second);
	});

	it("compares tokens safely (length-mismatch tolerant)", () => {
		expect(tokenMatches("secret", "secret")).toBe(true);
		expect(tokenMatches("secret", "secrets")).toBe(false);
		expect(tokenMatches("wrong", "secret")).toBe(false);
		expect(tokenMatches("", "")).toBe(true);
	});

	it("derives a stable machine id from the token", () => {
		expect(machineId("abc")).toBe(machineId("abc"));
		expect(machineId("abc")).toHaveLength(8);
		expect(machineId("abc")).not.toBe(machineId("abd"));
	});

	it("renders manual chunks as 4x8 groups", () => {
		expect(manualChunks("abcdefghijklmnopqrstuvwxyzABCDEF")).toBe("abcdefgh-ijklmnop-qrstuvwx-yzABCDEF");
	});

	it("builds a versioned pairing payload", () => {
		const payload = pairingPayload({ host: "192.168.1.2", port: 8787, token: "t0k3n", name: "test" });
		expect(payload).toEqual({
			v: 1,
			kind: "acoder",
			host: "192.168.1.2",
			port: 8787,
			tls: false,
			token: "t0k3n",
			name: "test",
			id: machineId("t0k3n"),
		});
	});

	it("keeps the serve state under the agent dir", () => {
		expect(serveDir()).toBe(join(tempAgentDir, "serve"));
	});
});

describe("auth extraction", () => {
	it("parses Bearer headers case-insensitively", () => {
		expect(bearerFromHeader("Bearer abc")).toBe("abc");
		expect(bearerFromHeader("bearer  abc ")).toBe("abc");
		expect(bearerFromHeader("Basic xyz")).toBeNull();
		expect(bearerFromHeader(undefined)).toBeNull();
	});

	it("parses ?token= query values", () => {
		expect(tokenFromUrl("/rpc?token=abc")).toBe("abc");
		expect(tokenFromUrl("/rpc")).toBeNull();
		expect(tokenFromUrl(undefined)).toBeNull();
	});
});

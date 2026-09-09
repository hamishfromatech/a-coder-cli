import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import {
	AuthCommandError,
	getAuthCredential,
	isAuthCommandHelp,
	parseAuthCommand,
	validateAuthCommandArgs,
} from "../src/cli/auth-command.ts";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { handleAuthCommand } from "../src/main.ts";

describe("auth command surface", () => {
	let originalAgentDir: string | undefined;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		originalAgentDir = process.env[ENV_AGENT_DIR];
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
	});

	afterEach(() => {
		if (originalAgentDir === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = originalAgentDir;
		}
		process.exitCode = originalExitCode;
		vi.restoreAllMocks();
	});

	it("parses print-api-key with provider/model", () => {
		const command = parseAuthCommand(["auth", "print-api-key", "--provider", "acme", "--model", "m1"]);
		expect(command).toEqual({
			kind: "api_key",
			args: ["--provider", "acme", "--model", "m1"],
			json: false,
			credentials: false,
			noRefresh: false,
		});
	});

	it("parses auth check flags", () => {
		const command = parseAuthCommand([
			"auth",
			"check",
			"--json",
			"--credentials",
			"--no-refresh",
			"--provider",
			"acme",
		]);
		expect(command).toMatchObject({ kind: "check", json: true, credentials: true, noRefresh: true });
	});

	it("parses bearer --min-expiry durations", () => {
		expect(
			parseAuthCommand(["auth", "print-bearer-token", "--provider", "p", "--min-expiry", "90m"])?.minExpiryMs,
		).toBe(5_400_000);
		expect(
			parseAuthCommand(["auth", "print-bearer-token", "--provider", "p", "--min-expiry", "500ms"])?.minExpiryMs,
		).toBe(500);
		expect(() =>
			parseAuthCommand(["auth", "print-bearer-token", "--provider", "p", "--min-expiry", "bogus"]),
		).toThrow(AuthCommandError);
	});

	it("rejects check-only flags on print commands and unknown subcommands", () => {
		expect(() => parseAuthCommand(["auth", "print-api-key", "--json"])).toThrow(AuthCommandError);
		expect(() => parseAuthCommand(["auth", "frobnicate"])).toThrow(AuthCommandError);
	});

	it("validates args through the shared Args parser", () => {
		expect(() => validateAuthCommandArgs(parseArgs(["--model", "m1", "extra-positional"]), "check")).toThrow(
			"Auth commands only accept --provider and --model",
		);
		expect(() => validateAuthCommandArgs(parseArgs(["--provider", "acme", "--bogus"]), "check")).toThrow(
			AuthCommandError,
		);
		expect(() => validateAuthCommandArgs(parseArgs([]), "check")).toThrow("Auth checks require");
		const { provider, model } = validateAuthCommandArgs(
			parseArgs(["--provider", "acme", "--model", "m1"]),
			"api_key",
		);
		expect(provider).toBe("acme");
		expect(model).toBe("m1");
	});

	it("recognizes the help surface", () => {
		expect(isAuthCommandHelp(["auth"])).toBe(true);
		expect(isAuthCommandHelp(["auth", "help"])).toBe(true);
		expect(isAuthCommandHelp(["auth", "check", "--help"])).toBe(true);
		expect(isAuthCommandHelp(["auth", "print-api-key"])).toBe(false);
	});

	it("extracts credentials from resolved auth", () => {
		expect(getAuthCredential({ ok: true, apiKey: "sk-123", headers: {}, env: {} })).toBe("sk-123");
		expect(
			getAuthCredential({ ok: true, apiKey: undefined, headers: { Authorization: "Bearer tok-9" }, env: {} }),
		).toBe("tok-9");
		expect(getAuthCredential({ ok: false, error: "nope" })).toBeUndefined();
	});

	it("prints help and exits cleanly", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handleAuthCommand(["auth", "help"])).resolves.toBe(true);
		expect(logSpy.mock.calls.join("\n")).toContain("auth check");
		logSpy.mockRestore();
		expect(process.exitCode).toBeUndefined();
	});

	it("reports unknown auth subcommands with exit code 1", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handleAuthCommand(["auth", "frobnicate"])).resolves.toBe(true);
		expect(errorSpy.mock.calls.map(([m]) => String(m)).join("\n")).toContain("Unknown auth command");
		errorSpy.mockRestore();
		expect(process.exitCode).toBe(1);
	});

	it("fails credential printing when nothing is configured", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			handleAuthCommand(["auth", "print-api-key", "--provider", "definitely-not-a-provider"]),
		).resolves.toBe(true);
		expect(errorSpy.mock.calls.map(([m]) => String(m)).join("\n")).toBeTruthy();
		errorSpy.mockRestore();
		expect(process.exitCode).toBe(1);
	});
});

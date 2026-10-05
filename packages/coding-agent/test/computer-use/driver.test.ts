import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR } from "../../src/config.ts";
import {
	type ComputerToolInput,
	createComputerToolDefinition,
	resetComputerToolState,
} from "../../src/core/tools/computer-use/computer.ts";
import {
	DRIVER_RELEASE_TAG,
	getCuaBinDir,
	getDriverInstallGuidance,
	resolveDriverCommand,
} from "../../src/core/tools/computer-use/driver.ts";

const SAVED_ENV_AGENT_DIR = process.env[ENV_AGENT_DIR];

function stubPlatform(platform: NodeJS.Platform, arch: string): void {
	Object.defineProperty(process, "platform", { value: platform });
	Object.defineProperty(process, "arch", { value: arch });
}

function restorePlatform(savedPlatform: NodeJS.Platform, savedArch: string): void {
	Object.defineProperty(process, "platform", { value: savedPlatform });
	Object.defineProperty(process, "arch", { value: savedArch });
}

describe("driver resolution", () => {
	let tempRoot = "";

	beforeEach(() => {
		tempRoot = fs.mkdtempSync(join(os.tmpdir(), "acoder-cua-driver-"));
		vi.stubEnv(ENV_AGENT_DIR, tempRoot);
		delete process.env.A_CODER_CUA_DRIVER_CMD;
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		if (SAVED_ENV_AGENT_DIR !== undefined) {
			process.env[ENV_AGENT_DIR] = SAVED_ENV_AGENT_DIR;
		} else {
			delete process.env[ENV_AGENT_DIR];
		}
		resetComputerToolState();
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	it("is not installed in a clean environment", () => {
		expect(resolveDriverCommand()).toEqual({ installed: false });
	});

	it("falls back to <agent-dir>/bin/cua-driver", () => {
		const bin = getCuaBinDir();
		fs.mkdirSync(bin, { recursive: true });
		const binary = join(bin, process.platform === "win32" ? "cua-driver.exe" : "cua-driver");
		fs.writeFileSync(binary, "#!/bin/sh\nexit 0\n");
		if (process.platform !== "win32") {
			fs.chmodSync(binary, 0o755);
		}
		const resolved = resolveDriverCommand();
		expect(resolved.installed).toBe(true);
		expect(resolved.command).toBe(binary);
	});

	it("prefers the explicit A_CODER_CUA_DRIVER_CMD override", () => {
		vi.stubEnv("A_CODER_CUA_DRIVER_CMD", "/opt/some/cua-driver");
		const resolved = resolveDriverCommand();
		expect(resolved).toEqual({ installed: true, command: "/opt/some/cua-driver" });
	});
});

describe("install guidance", () => {
	const savedPlatform = process.platform;
	const savedArch = process.arch;

	afterEach(() => {
		restorePlatform(savedPlatform, savedArch);
		vi.unstubAllEnvs();
		delete process.env.A_CODER_CUA_DRIVER_CMD;
	});

	it("returns null when an override or PATH lookup succeeds", () => {
		vi.stubEnv("A_CODER_CUA_DRIVER_CMD", "/opt/some/cua-driver");
		expect(getDriverInstallGuidance()).toBeNull();
	});

	it("maps each supported platform to the release asset layout", () => {
		const cases: Array<[NodeJS.Platform, string, string]> = [
			["darwin", "arm64", "cua-driver-rs-0.33.3-darwin-arm64.tar.gz"],
			["darwin", "x64", "cua-driver-rs-0.33.3-darwin-x86_64.tar.gz"],
			["linux", "x64", "cua-driver-rs-0.33.3-linux-x86_64.tar.gz"],
			["linux", "arm64", "cua-driver-rs-0.33.3-linux-arm64.tar.gz"],
			["win32", "x64", "cua-driver-rs-0.33.3-windows-x86_64.zip"],
		];
		for (const [platform, arch, asset] of cases) {
			stubPlatform(platform, arch);
			delete process.env.A_CODER_CUA_DRIVER_CMD;
			const guidance = getDriverInstallGuidance();
			expect(guidance, `${platform}/${arch}`).not.toBeNull();
			expect(guidance?.asset).toBe(asset);
			expect(guidance?.url).toBe(`https://github.com/trycua/cua/releases/download/${DRIVER_RELEASE_TAG}/${asset}`);
			expect(guidance?.commands.length).toBeGreaterThan(0);
			expect(guidance?.commands.join("\n")).toContain(guidance?.asset ?? "");
		}
	});

	it("returns null on unsupported platforms", () => {
		stubPlatform("freebsd" as NodeJS.Platform, "x64");
		expect(getDriverInstallGuidance()).toBeNull();
	});
});

describe("missing-driver tool failures carry install guidance", () => {
	it("doctor reports backend_unavailable with platform-matched install commands", async () => {
		const tempRoot = fs.mkdtempSync(join(os.tmpdir(), "acoder-cua-missing-"));
		const savedAgentDir = process.env[ENV_AGENT_DIR];
		process.env[ENV_AGENT_DIR] = tempRoot;
		delete process.env.A_CODER_CUA_DRIVER_CMD;
		resetComputerToolState();
		try {
			const tool = createComputerToolDefinition();
			const result = await tool.execute(
				"t",
				{ action: "doctor" } as ComputerToolInput,
				undefined,
				undefined,
				{} as Parameters<typeof tool.execute>[4],
			);
			const payload = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as {
				ok: boolean;
				code?: string;
				install?: { asset?: string; commands?: string[]; binDir?: string };
			};
			expect(payload.ok).toBe(false);
			expect(payload.code).toBe("backend_unavailable");
			expect(payload.install?.asset).toMatch(/^cua-driver-rs-/);
			expect(payload.install?.commands?.length ?? 0).toBeGreaterThan(0);
		} finally {
			resetComputerToolState();
			if (savedAgentDir !== undefined) {
				process.env[ENV_AGENT_DIR] = savedAgentDir;
			} else {
				delete process.env[ENV_AGENT_DIR];
			}
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledNodeBinDir, ensureBundledNodeOnPath } from "../src/core/node-runtime.ts";

const tempDirs: string[] = [];

function makeNodeDir(platform: "darwin" | "win32"): string {
	const root = mkdtempSync(join(tmpdir(), "a-coder-node-"));
	tempDirs.push(root);
	const dir = platform === "win32" ? join(root, "node") : join(root, "node", "bin");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, platform === "win32" ? "node.exe" : "node"), "");
	return root;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("bundled Node runtime", () => {
	it("finds the packaged Node bin directory", () => {
		const root = makeNodeDir("darwin");
		expect(bundledNodeBinDir(root, "darwin")).toBe(join(root, "node", "bin"));
		expect(bundledNodeBinDir(root, "linux")).toBe(join(root, "node", "bin"));
	});

	it("finds the Windows node.exe directory", () => {
		const root = makeNodeDir("win32");
		expect(bundledNodeBinDir(root, "win32")).toBe(join(root, "node"));
	});

	it("returns undefined when the release has no bundled Node", () => {
		const root = mkdtempSync(join(tmpdir(), "a-coder-node-empty-"));
		tempDirs.push(root);
		expect(bundledNodeBinDir(root, "darwin")).toBeUndefined();
	});

	it("prepends the runtime to PATH without duplicating it", () => {
		const root = makeNodeDir("darwin");
		const dir = join(root, "node", "bin");
		const original = process.env.PATH;
		try {
			process.env.PATH = ["/usr/bin", dir, "/bin"].join(delimiter);
			expect(ensureBundledNodeOnPath(root, "darwin")).toBe(dir);
			expect(process.env.PATH?.split(delimiter).slice(0, 3)).toEqual([dir, "/usr/bin", "/bin"]);
			expect(ensureBundledNodeOnPath(root, "darwin")).toBe(dir);
			expect(process.env.PATH?.split(delimiter).filter((part) => part === dir)).toHaveLength(1);
		} finally {
			process.env.PATH = original;
		}
	});
});

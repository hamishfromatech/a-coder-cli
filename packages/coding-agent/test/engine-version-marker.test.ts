import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncEngineVersionMarker } from "../src/utils/engine-version-marker.ts";

const dirs: string[] = [];

function makeDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-engine-marker-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("syncEngineVersionMarker", () => {
	it("rewrites a stale marker beside the binary", () => {
		const root = makeDir();
		const execPath = join(root, "pi.exe");
		writeFileSync(execPath, "");
		writeFileSync(join(root, "ENGINE_VERSION"), "0.80.197\n");

		expect(syncEngineVersionMarker(execPath, "0.80.199")).toBe(true);
		expect(readFileSync(join(root, "ENGINE_VERSION"), "utf8")).toBe("0.80.199\n");
	});

	it("leaves a matching marker untouched", () => {
		const root = makeDir();
		const execPath = join(root, "pi");
		writeFileSync(join(root, "ENGINE_VERSION"), "0.80.199\n");

		expect(syncEngineVersionMarker(execPath, "0.80.199")).toBe(false);
		expect(readFileSync(join(root, "ENGINE_VERSION"), "utf8")).toBe("0.80.199\n");
	});

	it("never creates a marker in a CLI-only install", () => {
		const root = makeDir();
		expect(syncEngineVersionMarker(join(root, "pi"), "0.80.199")).toBe(false);
		expect(existsSync(join(root, "ENGINE_VERSION"))).toBe(false);
	});
});

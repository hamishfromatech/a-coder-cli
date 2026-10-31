import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { macosAccessHint, protectedRootFor, withMacosAccessHint } from "../src/harness/env/macos-permissions.ts";

const home = "/Users/tester";

describe("macOS privacy deny hints", () => {
	it("recognizes guarded folders and their children", () => {
		expect(protectedRootFor(`${home}/Downloads/project`, home)?.label).toBe("Downloads");
		expect(protectedRootFor(`${home}/Documents`, home)?.label).toBe("Documents");
		expect(protectedRootFor(`${home}/Library/Mobile Documents/com~apple~CloudDocs`, home)?.label).toBe(
			"iCloud Drive",
		);
		expect(protectedRootFor(`${home}/code/project`, home)).toBeUndefined();
		// Prefix of a sibling folder name must not match.
		expect(protectedRootFor(`${home}/Downloads-old/x`, home)).toBeUndefined();
	});

	it("explains how to restore access, once", () => {
		// The hint resolves against the real home directory.
		const downloads = `${homedir()}/Downloads/a.txt`;
		const message = `EPERM: operation not permitted, open '${downloads}'`;
		const explained = withMacosAccessHint(message, downloads);
		if (process.platform === "darwin") {
			expect(explained).toContain("Privacy & Security");
			expect(explained).toContain("Downloads");
			// Appending again is a no-op.
			expect(withMacosAccessHint(explained, downloads)).toBe(explained);
		} else {
			expect(explained).toBe(message);
		}
	});

	it("stays quiet outside guarded folders", () => {
		expect(macosAccessHint(`${home}/code/project`, "Terminal")).toBeUndefined();
		const message = "EPERM: operation not permitted";
		expect(withMacosAccessHint(message, `${home}/code/project`)).toBe(message);
	});
});

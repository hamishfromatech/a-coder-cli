import { describe, expect, it } from "vitest";
import { parseFileLocation, relativeDir } from "./quick-open";

describe("parseFileLocation", () => {
	it("reads a trailing line number", () => {
		expect(parseFileLocation("src/app.ts:42")).toEqual({ path: "src/app.ts", line: 42 });
		expect(parseFileLocation("  README.md:1  ")).toEqual({ path: "README.md", line: 1 });
	});

	it("leaves plain queries and drive letters alone", () => {
		expect(parseFileLocation("src/app.ts")).toEqual({ path: "src/app.ts" });
		expect(parseFileLocation("C:\\src\\app.ts")).toEqual({ path: "C:\\src\\app.ts" });
		expect(parseFileLocation("weird:name")).toEqual({ path: "weird:name" });
	});

	it("ignores non-positive or malformed suffixes", () => {
		expect(parseFileLocation("a.ts:0")).toEqual({ path: "a.ts:0" });
		expect(parseFileLocation(":12")).toEqual({ path: ":12" });
	});
});

describe("relativeDir", () => {
	it("returns the folder portion", () => {
		expect(relativeDir("src/ide/panel.ts")).toBe("src/ide");
		expect(relativeDir("README.md")).toBe("");
		expect(relativeDir("a\\b\\c.ts")).toBe("a/b");
	});
});

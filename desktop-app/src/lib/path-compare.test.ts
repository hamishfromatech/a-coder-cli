import { describe, expect, it } from "vitest";
import { comparablePath, samePath } from "./path-compare";

describe("path comparison", () => {
	it("matches Windows drive paths across separators, casing, and verbatim prefixes", () => {
		const canonical = String.raw`C:\Users\Hamish\Projects\A-Coder`;
		expect(samePath(canonical, String.raw`c:/users/hamish/projects/a-coder/`)).toBe(true);
		expect(samePath(canonical, String.raw`\\?\C:\Users\Hamish\Projects\A-Coder`)).toBe(true);
		expect(samePath(String.raw`\\?\C:\Users\Hamish\Projects\A-Coder`, String.raw`C:\Users\Hamish\Projects\A-Coder`)).toBe(true);
	});

	it("matches verbatim UNC paths against normal UNC paths", () => {
		expect(samePath(String.raw`\\?\UNC\server\share\repo`, String.raw`\\server\share\repo`)).toBe(true);
		expect(comparablePath(String.raw`\\?\UNC\server\share\repo`)).toBe("//server/share/repo");
	});

	it("matches POSIX paths with trailing slashes", () => {
		expect(samePath("/Users/hamish/Projects/A-Coder", "/Users/hamish/Projects/A-Coder/")).toBe(true);
		expect(comparablePath("/")).toBe("/");
	});

	it("keeps different projects distinct", () => {
		expect(samePath(String.raw`C:\Repo\One`, String.raw`C:\Repo\Two`)).toBe(false);
		expect(samePath("/repo/one", "/repo/two")).toBe(false);
	});
});

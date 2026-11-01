import { describe, expect, it } from "vitest";
import { decorationFor, fileKind, flattenVisible, parentOf, relativeToRoot, sortEntries } from "./explorer";

const root = "/w";
const tree = new Map<string, Array<{ path: string; name: string; is_dir: boolean }>>([
	[
		"/w",
		[
			{ path: "/w/src", name: "src", is_dir: true },
			{ path: "/w/README.md", name: "README.md", is_dir: false },
		],
	],
	[
		"/w/src",
		[
			{ path: "/w/src/b.ts", name: "b.ts", is_dir: false },
			{ path: "/w/src/a.ts", name: "a.ts", is_dir: false },
			{ path: "/w/src/nested", name: "nested", is_dir: true },
		],
	],
	["/w/src/nested", [{ path: "/w/src/nested/c.ts", name: "c.ts", is_dir: false }]],
]);

describe("flattenVisible", () => {
	it("renders collapsed roots and expands what is open", () => {
		const rows = flattenVisible(tree, new Set(["/w/src"]), root);
		expect(rows.map((row) => `${row.depth}:${row.entry.name}`)).toEqual([
			"0:src",
			"1:nested",
			"1:a.ts",
			"1:b.ts",
			"0:README.md",
		]);
	});

	it("auto-expands directories while filtering and hides non-matching files", () => {
		const rows = flattenVisible(tree, new Set(), root, "c.ts");
		expect(rows.map((row) => row.entry.path)).toEqual(["/w/src", "/w/src/nested", "/w/src/nested/c.ts"]);
	});

	it("hides loaded branches without matches but keeps unloaded ones", () => {
		const withUnknown = new Map(tree);
		withUnknown.set("/w", [
			...(tree.get("/w") ?? []),
			{ path: "/w/unloaded", name: "unloaded", is_dir: true },
		]);
		expect(flattenVisible(withUnknown, new Set(), root, "zzz").map((row) => row.entry.name)).toEqual([
			"unloaded",
		]);
		expect(flattenVisible(withUnknown, new Set(), root, "b.ts").map((row) => row.entry.name)).toEqual([
			"src",
			"b.ts",
			"unloaded",
		]);
	});

	it("sorts directories first, then names case-insensitively", () => {
		expect(sortEntries([{ path: "b", name: "b", is_dir: false }, { path: "A", name: "A", is_dir: false }, { path: "d", name: "d", is_dir: true }]).map((entry) => entry.name)).toEqual(["d", "A", "b"]);
	});
});

describe("git decorations", () => {
	it("letters files and flags folders with changed descendants", () => {
		const status = new Map([
			["src/a.ts", "M"],
			["README.md", "U"],
		]);
		expect(decorationFor("/w/src/a.ts", false, root, status)).toEqual({ letter: "M", dirtyDir: false });
		expect(decorationFor("/w/src", true, root, status)).toEqual({ letter: null, dirtyDir: true });
		expect(decorationFor("/w/docs", true, root, status)).toEqual({ letter: null, dirtyDir: false });
	});
});

describe("path helpers", () => {
	it("derives relative paths and parents", () => {
		expect(relativeToRoot("/w/src/a.ts", "/w")).toBe("src/a.ts");
		expect(relativeToRoot("/w", "/w/")).toBe("");
		expect(parentOf("/w/src/a.ts")).toBe("/w/src");
		expect(parentOf("/w/")).toBe("/w");
	});
});

describe("fileKind", () => {
	it("classifies common editor files", () => {
		expect(fileKind("a.ts")).toBe("code");
		expect(fileKind("package.json")).toBe("json");
		expect(fileKind("README.md")).toBe("markdown");
		expect(fileKind("styles.scss")).toBe("style");
		expect(fileKind(".env")).toBe("config");
		expect(fileKind("Dockerfile")).toBe("config");
		expect(fileKind("archive.tar.gz")).toBe("archive");
		expect(fileKind("notes")).toBe("text");
	});
});

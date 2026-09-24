import { describe, expect, it } from "vitest";
import { diffStats, parseDiffRows } from "./EditDiff";

describe("parseDiffRows", () => {
	it("parses added, removed and context rows with line numbers and content", () => {
		// Format from the edit tool: <marker><padded line num> <content>
		const diff = ["+  12 const a = 1;", "-  8 const a = 0;", "   9 unchanged"].join("\n");
		expect(parseDiffRows(diff)).toEqual([
			{ kind: "add", lineNum: "12", content: "const a = 1;" },
			{ kind: "remove", lineNum: "8", content: "const a = 0;" },
			{ kind: "context", lineNum: "9", content: "unchanged" },
		]);
	});

	it("parses an added blank line (content empty, trailing space in diff)", () => {
		const rows = parseDiffRows("+  12 ");
		expect(rows).toEqual([{ kind: "add", lineNum: "12", content: "" }]);
	});

	it("parses collapsed-region markers as skip rows", () => {
		// `${"".padStart(width, " ")} ...`
		const rows = parseDiffRows("      ...");
		expect(rows).toEqual([{ kind: "skip", lineNum: "", content: "..." }]);
	});

	it("preserves leading spaces in content after the line-number separator", () => {
		const rows = parseDiffRows("+  12   indented");
		expect(rows).toEqual([{ kind: "add", lineNum: "12", content: "  indented" }]);
	});

	it("drops empty lines and handles an empty diff", () => {
		expect(parseDiffRows("")).toEqual([]);
		expect(parseDiffRows("\n\n")).toEqual([]);
	});
});

describe("diffStats", () => {
	it("counts added and removed lines", () => {
		const diff = ["+a", "+b", "-c", " d", "      ..."].join("\n");
		expect(diffStats(diff)).toEqual({ added: 2, removed: 1 });
	});

	it("returns zeros for a diff with no changes", () => {
		expect(diffStats("   1 context")).toEqual({ added: 0, removed: 0 });
	});
});
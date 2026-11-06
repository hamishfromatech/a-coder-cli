import { describe, expect, it } from "vitest";
import { parseToolCallArguments } from "../src/utils/json-parse.ts";

describe("parseToolCallArguments", () => {
	it("parses a JSON object", () => {
		expect(parseToolCallArguments('{"path":"a.ts"}')).toEqual({ arguments: { path: "a.ts" } });
	});

	it("treats empty text as no arguments", () => {
		expect(parseToolCallArguments("  ")).toEqual({ arguments: {} });
	});

	it("reports malformed objects instead of silently using {}", () => {
		const result = parseToolCallArguments("[1,2]");
		expect(result.arguments).toEqual({});
		expect(result.argumentsError).toContain("must be a JSON object");
		expect(result.argumentsError).toContain("[1,2]");
	});

	it("does not keep a partial prefix for finished text", () => {
		const result = parseToolCallArguments('{"path":"a.ts","content":"hi');
		expect(result.arguments).toEqual({});
		expect(result.argumentsError).toContain("Received arguments:");
	});
});

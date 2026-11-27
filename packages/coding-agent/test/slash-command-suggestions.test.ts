import { describe, expect, it } from "vitest";
import { suggestSlashCommandName } from "../src/modes/interactive/slash-command-suggestions.ts";

const commands = ["model", "thinking", "theme", "scoped-models", "clear", "help"];

describe("suggestSlashCommandName", () => {
	it("maps the plural /models spelling to /model", () => {
		expect(suggestSlashCommandName("models", commands)).toBe("model");
	});

	it("suggests for a transposed command", () => {
		expect(suggestSlashCommandName("modle", commands)).toBe("model");
	});

	it("prefers the closest command", () => {
		expect(suggestSlashCommandName("thinkin", commands)).toBe("thinking");
	});

	it("does not suggest unrelated commands", () => {
		expect(suggestSlashCommandName("deploy", commands)).toBeUndefined();
	});
});

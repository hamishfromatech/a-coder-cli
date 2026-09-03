import { describe, expect, it } from "vitest";
import { bashIntentTarget, classifyBashIntent } from "../src/core/tools/bash-intent.ts";

describe("classifyBashIntent", () => {
	it("tags git/github/glab commands as Git with the subcommand target", () => {
		expect(classifyBashIntent("git status")).toBe("Git");
		expect(classifyBashIntent("gh pr create --title x")).toBe("Git");
		expect(bashIntentTarget("git status", "Git")).toBe("status");
		expect(bashIntentTarget("gh pr create", "Git")).toBe("pr");
		expect(bashIntentTarget("git", "Git")).toBeUndefined();
	});

	it("tags test runners as Test, taking precedence over build keywords", () => {
		expect(classifyBashIntent("npm test")).toBe("Test");
		expect(classifyBashIntent("npm run test:ci")).toBe("Test");
		expect(classifyBashIntent("CI=1 vitest run test/foo.test.ts")).toBe("Test");
		expect(classifyBashIntent("go test ./...")).toBe("Test");
		expect(classifyBashIntent("python -m pytest -q")).toBe("Test");
	});

	it("tags build commands as Build", () => {
		expect(classifyBashIntent("npm run build")).toBe("Build");
		expect(classifyBashIntent("tsc -p .")).toBe("Build");
		expect(classifyBashIntent("make build")).toBe("Build");
		expect(classifyBashIntent("cargo build --release")).toBe("Build");
	});

	it("tags search commands as Search with the quoted pattern", () => {
		expect(classifyBashIntent('rg "useState" src')).toBe("Search");
		expect(bashIntentTarget('rg "useState" src', "Search")).toBe('"useState"');
		expect(classifyBashIntent("grep -rn TODO .")).toBe("Search");
		expect(classifyBashIntent("find src -name '*.ts'")).toBe("Search");
	});

	it("tags directory listings as List", () => {
		expect(classifyBashIntent("ls -la")).toBe("List");
		expect(classifyBashIntent("tree src")).toBe("List");
	});

	it("leaves unrecognized commands untagged", () => {
		expect(classifyBashIntent("echo hello > notes.txt")).toBeUndefined();
		expect(classifyBashIntent("curl -s https://example.com")).toBeUndefined();
		expect(classifyBashIntent("")).toBeUndefined();
	});

	it("does not mis-bucket npm test by a stray build word", () => {
		expect(classifyBashIntent("npm test && npm run build")).toBe("Test");
	});
});

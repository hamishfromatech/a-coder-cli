// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { speechify } from "./speech-text";

describe("speechify", () => {
	it("strips headings, list markers, and emphasis", () => {
		const md = "# Summary\n\n**Fixed** the *proxy* and ~~removed~~ the retry.\n\n- first item\n- second item\n1. numbered";
		expect(speechify(md)).toBe("Summary Fixed the proxy and removed the retry. first item second item numbered");
	});

	it("keeps link labels and degrades bare URLs to 'a link'", () => {
		const md = "See [the pull request](https://github.com/x/y/pull/123) and https://example.com/a/b?q=1 for details.";
		expect(speechify(md)).toBe("See the pull request and a link for details.");
	});

	it("reads inline code when it makes sense, collapses paths and strips flags", () => {
		const md =
			"Run `npm test` then edit `src/lib/voice.ts`, pass `--verbose`, and set `OPENAI_API_KEY=sk-1234567890123456`.";
		const out = speechify(md);
		expect(out).toContain("Run npm test");
		expect(out).toContain("the file");
		expect(out).not.toContain("voice.ts");
		expect(out).not.toContain("--verbose");
		expect(out).not.toContain("OPENAI_API_KEY");
	});

	it("collapses bare paths in prose", () => {
		const out = speechify("The change is in /Users/me/project/src/index.ts and in src/lib/voice.ts.");
		expect(out).toBe("The change is in the file and in the file.");
	});

	it("drops fenced code and mentions it once", () => {
		const md = "Here is the fix:\n\n```ts\nconst a = 1;\n```\n\nThat should do it.\n\n```sh\nnpm run build\n```";
		expect(speechify(md)).toBe("Here is the fix: With a code sample. That should do it.");
	});

	it("falls back to the transcript when the reply is only code", () => {
		expect(speechify("```ts\nconst a = 1;\nconsole.log(a);\n```")).toBe("The reply is in the transcript.");
	});

	it("drops tables, rules, emoji, and HTML", () => {
		const md = "Status 🎉\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\n<b>done</b>";
		const out = speechify(md);
		expect(out).toBe("Status done");
	});

	it("keeps symbols that are part of names or arithmetic", () => {
		const text = "C++ and C# are not .NET, and 2 * 3 is state-of-the-art math.";
		expect(speechify(text)).toBe(text);
	});

	it("cleans up punctuation left behind by removals", () => {
		const out = speechify("Look here:\n\n```js\nx();\n```");
		expect(out).toBe("Look here: With a code sample.");
	});

	it("returns the input unchanged in verbatim mode", () => {
		const md = "**bold** `code` https://example.com";
		expect(speechify(md, { mode: "verbatim" })).toBe(md);
	});

	it("speaks something for an empty reply", () => {
		expect(speechify("")).toBe("The reply is in the transcript.");
	});

	it("turns hashes and UUIDs into words", () => {
		const out = speechify("Commit 3f2a9c1d8e7b6a5f4c3d2e1b0a9f8e7d and id 123e4567-e89b-12d3-a456-426614174000.");
		expect(out).toBe("Commit a hash and id an identifier.");
	});
});

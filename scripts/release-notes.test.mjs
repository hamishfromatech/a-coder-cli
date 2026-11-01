import assert from "node:assert/strict";
import test from "node:test";

import { buildGenerateMessages, commitsToMarkdown } from "./release-notes.mjs";

const release = {
	previousTag: "v0.80.192",
	commits: [
		{ subject: "feat(desktop): twelve new skins and a contrast-aware accent label", body: "Classic and artistic groups." },
		{ subject: "fix(desktop): explorer keyboard navigation", body: "" },
	],
};

test("fallback notes list only this release's commits", () => {
	const markdown = commitsToMarkdown("v0.80.193", release, "hamishfromatech/a-coder-cli");
	assert.match(markdown, /twelve new skins/);
	assert.match(markdown, /explorer keyboard navigation/);
	assert.doesNotMatch(markdown, /scheduled tasks/i);
	assert.match(markdown, /compare\/v0\.80\.192\.\.\.v0\.80\.193/);
});

test("the writer prompt treats commits as authoritative and omits the changelog backlog", () => {
	const [system, user] = buildGenerateMessages({}, "v0.80.193", [], release);
	assert.match(system.content, /authoritative change set/);
	assert.match(system.content, /Use ONLY these commits/);
	assert.match(user.content, /feat\(desktop\): twelve new skins/);
	assert.doesNotMatch(user.content, /Changelog source material/);
});

test("without commits the changelog path is still available", () => {
	const [system, user] = buildGenerateMessages({}, "v0.80.193", ["### Desktop\n\n- Old entry"], {
		previousTag: null,
		commits: [],
	});
	assert.match(system.content, /raw changelog entries/);
	assert.match(user.content, /Changelog source material/);
	assert.match(user.content, /Old entry/);
});

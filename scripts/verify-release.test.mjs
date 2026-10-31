import assert from "node:assert/strict";
import test from "node:test";

import {
	changedSourcePackages,
	compareVersions,
	parseUnreleased,
	validateLatestManifest,
} from "./verify-release.mjs";

const TAG = "v0.80.191";
const VERSION = "0.80.191";
const REPO = "hamishfromatech/a-coder-cli";

function manifest() {
	const signature = Buffer.from("untrusted comment: test signature\n").toString("base64");
	return {
		version: VERSION,
		notes: "A".repeat(240),
		pub_date: "2026-10-31T01:36:29.587Z",
		platforms: {
			"darwin-aarch64": { signature, url: `https://github.com/${REPO}/releases/download/${TAG}/A-Coder.Desktop.aarch64.app.tar.gz` },
			"darwin-x86_64": { signature, url: `https://github.com/${REPO}/releases/download/${TAG}/A-Coder.Desktop.x86_64.app.tar.gz` },
			"linux-x86_64": { signature, url: `https://github.com/${REPO}/releases/download/${TAG}/A-Coder.Desktop_0.80.191_amd64.AppImage` },
			"windows-x86_64": { signature, url: `https://github.com/${REPO}/releases/download/${TAG}/A-Coder.Desktop_0.80.191_x64-setup.exe` },
		},
	};
}

function assetNames() {
	return new Set([
		"A-Coder.Desktop.aarch64.app.tar.gz",
		"A-Coder.Desktop.x86_64.app.tar.gz",
		"A-Coder.Desktop_0.80.191_amd64.AppImage",
		"A-Coder.Desktop_0.80.191_x64-setup.exe",
	]);
}

test("compareVersions orders release versions numerically", () => {
	assert.equal(compareVersions("0.80.191", "0.80.190"), 1);
	assert.equal(compareVersions("v0.80.190", "0.80.190"), 0);
	assert.equal(Math.sign(compareVersions("0.9.0", "0.80.0")), -1);
});

test("parseUnreleased counts only entries inside the Unreleased section", () => {
	const markdown = [
		"# Changelog",
		"",
		"## [Unreleased]",
		"",
		"### Fixed",
		"",
		"- one",
		"* two",
		"",
		"## [0.80.190] - 2026-10-31",
		"",
		"- released entry",
	].join("\n");
	assert.deepEqual(parseUnreleased(markdown), { present: true, entries: 2 });
});

test("parseUnreleased reports a missing section", () => {
	assert.deepEqual(parseUnreleased("# Changelog\n\n## [0.80.190]\n\n- done"), { present: false, entries: 0 });
});

test("changedSourcePackages maps source changes and ignores metadata", () => {
	const changed = changedSourcePackages([
		"packages/coding-agent/src/a.ts",
		"packages/coding-agent/package.json",
		"packages/coding-agent/CHANGELOG.md",
		"packages/ai/test/a.test.ts",
		"desktop-app/src/App.tsx",
		"desktop-app/src-tauri/src/lib.rs",
		"README.md",
	]);
	assert.deepEqual(changed.sort(), ["desktop-app", "packages/coding-agent"]);
});

test("validateLatestManifest accepts a complete manifest", () => {
	const result = validateLatestManifest(manifest(), { version: VERSION, tag: TAG, repo: REPO, assetNames: assetNames() });
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.warnings, []);
});

test("validateLatestManifest rejects a missing platform", () => {
	const value = manifest();
	delete value.platforms["linux-x86_64"];
	const result = validateLatestManifest(value, { version: VERSION, tag: TAG, repo: REPO, assetNames: assetNames() });
	assert.match(result.errors.join("; "), /platform linux-x86_64 is missing/);
});

test("validateLatestManifest rejects placeholder notes and wrong versions", () => {
	const value = manifest();
	value.version = "0.80.190";
	value.notes = `A-Coder Desktop ${VERSION}`;
	const result = validateLatestManifest(value, { version: VERSION, tag: TAG, repo: REPO, assetNames: assetNames() });
	assert.match(result.errors.join("; "), /version is "0.80.190"/);
	assert.match(result.errors.join("; "), /placeholder/);
});

test("validateLatestManifest rejects URLs whose asset is absent", () => {
	const value = manifest();
	value.platforms["darwin-aarch64"].url = `https://github.com/${REPO}/releases/download/${TAG}/missing.app.tar.gz`;
	const result = validateLatestManifest(value, { version: VERSION, tag: TAG, repo: REPO, assetNames: assetNames() });
	assert.match(result.errors.join("; "), /not a release asset/);
});

test("validateLatestManifest rejects a non-minisign signature", () => {
	const value = manifest();
	value.platforms["windows-x86_64"].signature = "not base64";
	const result = validateLatestManifest(value, { version: VERSION, tag: TAG, repo: REPO, assetNames: assetNames() });
	assert.match(result.errors.join("; "), /not a base64 minisign signature/);
});

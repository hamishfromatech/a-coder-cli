#!/usr/bin/env node
/**
 * Verify an A-Coder release before the tag ships and after it publishes.
 *
 * Pre-tag checks read the local checkout and never touch the network except to
 * confirm the candidate is newer than the latest published release and that the
 * tag is not already on `origin`.
 *
 * Post-publish checks read the public GitHub release, the updater manifest, the
 * installer endpoint, and optionally download assets for checksum verification.
 *
 * Exits non-zero when any check fails. WARN, SKIP, and MANUAL lines do not fail.
 *
 * Usage:
 *   node scripts/verify-release.mjs pre-tag [options]
 *   node scripts/verify-release.mjs post-publish [options]
 *
 * Run `node scripts/verify-release.mjs --help` for the full option list.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "hamishfromatech/a-coder-cli";
const DEFAULT_INSTALL_REF = "feat/desktop-unified-release";
const DEFAULT_BRANCH = "feat/desktop-unified-release";
const USER_AGENT = "a-coder-release-verifier";

const PUBLISH_PACKAGES = [
	"packages/telemetry",
	"packages/ai",
	"packages/agent",
	"packages/tui",
	"packages/coding-agent",
];

const CLI_ASSETS = [
	"pi-darwin-arm64.tar.gz",
	"pi-darwin-x64.tar.gz",
	"pi-linux-x64.tar.gz",
	"pi-linux-arm64.tar.gz",
	"pi-windows-x64.zip",
	"pi-windows-arm64.zip",
	"pi-coding-agent-install-package.json",
	"pi-coding-agent-install-package-lock.json",
	"SHA256SUMS",
	"latest.json",
];

const DESKTOP_UPDATER_PLATFORMS = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];

const DESKTOP_ASSET_CHECKS = [
	{ id: "desktop-macos-dmg", test: (name) => /\.dmg$/i.test(name), required: true },
	{ id: "desktop-linux-deb", test: (name) => /\.deb$/i.test(name), required: true },
	{ id: "desktop-linux-appimage", test: (name) => /\.AppImage$/i.test(name), required: true },
	{ id: "desktop-linux-appimage-sig", test: (name) => /\.AppImage\.sig$/i.test(name), required: true },
	{ id: "desktop-windows-setup", test: (name) => /-setup\.exe$/i.test(name), required: true },
	{ id: "desktop-windows-setup-sig", test: (name) => /-setup\.exe\.sig$/i.test(name), required: true },
	{ id: "desktop-windows-msi", test: (name) => /\.msi$/i.test(name), required: true },
	{ id: "desktop-windows-msi-sig", test: (name) => /\.msi\.sig$/i.test(name), required: true },
	{ id: "desktop-linux-rpm", test: (name) => /\.rpm$/i.test(name), required: false },
];

const VALUE_FLAGS = new Set(["version", "tag", "approval", "report", "root", "repo", "install-ref", "since-tag"]);
const BOOLEAN_FLAGS = new Set(["run-checks", "drill", "install-smoke", "verify-checksums", "npm", "help"]);

const results = [];
let reportContext = {};

function printUsage() {
	console.log(`Usage:
  node scripts/verify-release.mjs pre-tag [options]
  node scripts/verify-release.mjs post-publish [options]

pre-tag options:
  --version <x.y.z>     Candidate version (default: packages/ai/package.json)
  --approval <ref>      Board approval comment URL or id (required unless --drill)
  --run-checks          Run npm run check and ./test.sh
  --since-tag <tag>     Diff base for changelog coverage (default: latest tag)
  --drill               Downgrade release-only gates to warnings for a dry run
  --root <path>         Repo root (default: current directory)
  --report <path>       Write a Markdown report

post-publish options:
  --tag <vX.Y.Z>        Released tag (required)
  --repo <owner/repo>   GitHub repo (default: ${DEFAULT_REPO})
  --install-ref <ref>   Ref hosting install-a-coder.sh (default: ${DEFAULT_INSTALL_REF})
  --install-smoke       Download and run the installer into a temp directory
  --verify-checksums    Download CLI archives and compare SHA256SUMS
  --npm                 Check npm registry versions (only when npm publish was enabled)
  --report <path>       Write a Markdown report
`);
}

function parseArgs(argv) {
	const [command, ...rest] = argv;
	if (!command || command === "--help" || command === "help") {
		printUsage();
		return { command: "help" };
	}

	const options = { command };
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
		const key = arg.slice(2);
		if (VALUE_FLAGS.has(key)) {
			const value = rest[++i];
			if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
			options[toCamel(key)] = value;
			continue;
		}
		if (BOOLEAN_FLAGS.has(key)) {
			options[toCamel(key)] = true;
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}
	return options;
}

function toCamel(value) {
	return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function record(level, id, message) {
	const entry = { level, id, message };
	results.push(entry);
	console.log(`${level.padEnd(6)} ${id.padEnd(28)} ${message}`);
}

function readJson(file) {
	return JSON.parse(readFileSync(file, "utf8"));
}

function git(root, args, options = {}) {
	return spawnSync("git", args, { cwd: root, encoding: "utf8", ...options });
}

function normalizeVersion(value) {
	return String(value).replace(/^v/, "");
}

export function compareVersions(a, b) {
	const left = normalizeVersion(a).split(".").map((part) => Number(part) || 0);
	const right = normalizeVersion(b).split(".").map((part) => Number(part) || 0);
	for (let i = 0; i < 3; i++) {
		const diff = (left[i] || 0) - (right[i] || 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function extractSection(markdown, heading) {
	const lines = markdown.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim() === `## [${heading}]`);
	if (start === -1) return null;
	const body = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (/^##\s+\[/.test(lines[i])) break;
		body.push(lines[i]);
	}
	return body.join("\n");
}

function countEntryLines(section) {
	return section.split(/\r?\n/).filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
}

export function parseUnreleased(markdown) {
	const section = extractSection(markdown, "Unreleased");
	return { present: section !== null, entries: section === null ? 0 : countEntryLines(section) };
}

export function changedSourcePackages(files) {
	const packages = new Set();
	for (const file of files) {
		const match = file.match(/^packages\/([^/]+)\/(.+)$/);
		if (match && match[2].startsWith("src/")) packages.add(`packages/${match[1]}`);
		if (file.startsWith("desktop-app/src/") || file.startsWith("desktop-app/src-tauri/src/")) packages.add("desktop-app");
	}
	return [...packages];
}

function signatureLooksValid(signature) {
	if (typeof signature !== "string" || signature.trim() === "") return false;
	try {
		const decoded = Buffer.from(signature, "base64").toString("utf8");
		return decoded.startsWith("untrusted comment:");
	} catch {
		return false;
	}
}

function assetNameFromUrl(url) {
	try {
		const pathname = new URL(url).pathname;
		return decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
	} catch {
		return null;
	}
}

export function validateLatestManifest(manifest, { version, tag, repo, assetNames }) {
	const errors = [];
	const warnings = [];

	if (!manifest || typeof manifest !== "object") {
		return { errors: ["latest.json is not an object"], warnings };
	}
	if (manifest.version !== version) {
		errors.push(`version is ${JSON.stringify(manifest.version)}, expected ${version}`);
	}
	if (typeof manifest.notes !== "string" || manifest.notes.trim() === `A-Coder Desktop ${version}`) {
		errors.push("notes is the placeholder one-liner");
	} else if (manifest.notes.trim().length < 40) {
		errors.push("notes is empty or shorter than 40 characters");
	} else if (manifest.notes.trim().length < 200) {
		warnings.push("notes is shorter than 200 characters; confirm it is the real release body");
	}
	if (Number.isNaN(Date.parse(manifest.pub_date))) {
		errors.push(`pub_date is not a valid date: ${JSON.stringify(manifest.pub_date)}`);
	}

	const platforms = manifest.platforms;
	if (!platforms || typeof platforms !== "object") {
		errors.push("platforms is missing");
		return { errors, warnings };
	}

	const base = `https://github.com/${repo}/releases/download/${tag}/`;
	for (const key of DESKTOP_UPDATER_PLATFORMS) {
		if (!platforms[key]) {
			errors.push(`platform ${key} is missing`);
			continue;
		}
		const entry = platforms[key];
		if (!signatureLooksValid(entry.signature)) {
			errors.push(`platform ${key} signature is not a base64 minisign signature`);
		}
		if (typeof entry.url !== "string" || !entry.url.startsWith(base)) {
			errors.push(`platform ${key} url does not point at ${tag}`);
			continue;
		}
		const asset = assetNameFromUrl(entry.url);
		if (!asset || !assetNames.has(asset)) {
			errors.push(`platform ${key} url names ${JSON.stringify(asset)}, which is not a release asset`);
		}
	}
	for (const key of Object.keys(platforms)) {
		if (!DESKTOP_UPDATER_PLATFORMS.includes(key)) warnings.push(`unexpected platform key ${key}`);
	}

	return { errors, warnings };
}

async function request(url, { method = "GET", headers = {} } = {}) {
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	const auth = token ? { Authorization: `Bearer ${token}` } : {};
	return fetch(url, {
		method,
		redirect: "follow",
		headers: { "User-Agent": USER_AGENT, ...auth, ...headers },
		signal: AbortSignal.timeout(30_000),
	});
}

async function fetchJson(url) {
	const response = await request(url, { headers: { Accept: "application/vnd.github+json" } });
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return response.json();
}

async function fetchText(url) {
	const response = await request(url);
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return response.text();
}

function readWorkspaceVersions(root) {
	const versions = [];
	const packagesDir = path.join(root, "packages");
	for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const file = path.join(packagesDir, entry.name, "package.json");
		if (!existsSync(file)) continue;
		versions.push({ path: `packages/${entry.name}/package.json`, version: readJson(file).version });
	}
	versions.push({ path: "desktop-app/package.json", version: readJson(path.join(root, "desktop-app/package.json")).version });
	versions.push({
		path: "desktop-app/src-tauri/tauri.conf.json",
		version: readJson(path.join(root, "desktop-app/src-tauri/tauri.conf.json")).version,
	});
	versions.push({
		path: "packages/coding-agent/install-lock/package.json",
		version: readJson(path.join(root, "packages/coding-agent/install-lock/package.json")).version,
	});
	return versions;
}

function changelogPaths(root) {
	return [
		...PUBLISH_PACKAGES.map((directory) => `${directory}/CHANGELOG.md`),
		"packages/cloud/CHANGELOG.md",
		"packages/orchestrator/CHANGELOG.md",
		"desktop-app/src/CHANGELOG.md",
	].filter((file) => existsSync(path.join(root, file)));
}

function latestTag(root) {
	const result = git(root, ["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD"]);
	return result.status === 0 ? result.stdout.trim() : null;
}

async function runCommand(root, command, args) {
	const started = Date.now();
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
	const seconds = Math.round((Date.now() - started) / 1000);
	return { status: result.status, seconds };
}

async function preTag(options) {
	const root = path.resolve(options.root ?? ".");
	const drill = options.drill === true;
	const version = normalizeVersion(options.version ?? readJson(path.join(root, "packages/ai/package.json")).version);
	const tag = `v${version}`;
	const branch = git(root, ["branch", "--show-current"]).stdout.trim();
	const commit = git(root, ["rev-parse", "--short", "HEAD"]).stdout.trim();
	const subject = git(root, ["log", "-1", "--pretty=%s"]).stdout.trim();
	reportContext = { mode: "pre-tag", root, branch, commit, subject, version, tag, approval: options.approval ?? "", drill, report: options.report };

	console.log(`\nPre-tag verification for ${tag} at ${commit}\n`);

	if (branch === DEFAULT_BRANCH) {
		record("PASS", "branch", branch);
	} else {
		record(drill ? "WARN" : "FAIL", "branch", `${branch || "(detached)"} is not ${DEFAULT_BRANCH}`);
	}

	const status = git(root, ["status", "--porcelain"]).stdout.trim();
	if (status === "") {
		record("PASS", "clean-tree", "working tree clean");
	} else {
		const summary = status.split("\n").slice(0, 6).join("; ");
		record(drill ? "WARN" : "FAIL", "clean-tree", `uncommitted changes: ${summary}`);
	}

	if (typeof options.approval === "string" && options.approval.trim() !== "") {
		record("PASS", "board-approval", options.approval.trim());
	} else {
		record(drill ? "WARN" : "FAIL", "board-approval", "no board approval reference on the task");
	}

	const versions = readWorkspaceVersions(root);
	const mismatches = versions.filter((entry) => normalizeVersion(entry.version) !== version);
	if (mismatches.length === 0) {
		record("PASS", "version-lockstep", `${versions.length} manifests at ${version}`);
	} else {
		const detail = mismatches.map((entry) => `${entry.path}=${entry.version}`).join(", ");
		record("FAIL", "version-lockstep", `candidate ${version}; ${detail}`);
	}

	const localTag = git(root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
	const remoteTags = git(root, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
	const remoteExists = remoteTags.status === 0 && remoteTags.stdout.trim() !== "";
	if (localTag.status === 0 || remoteExists) {
		record(drill ? "WARN" : "FAIL", "tag-unused", `${tag} already exists${remoteExists ? " on origin" : " locally"}`);
	} else if (remoteTags.status !== 0) {
		record(drill ? "WARN" : "FAIL", "tag-unused", `could not query origin: ${remoteTags.stderr.trim()}`);
	} else {
		record("PASS", "tag-unused", `${tag} does not exist locally or on origin`);
	}

	try {
		const latest = await fetchJson(`https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`);
		const latestVersion = normalizeVersion(latest.tag_name ?? "0.0.0");
		if (compareVersions(version, latestVersion) > 0) {
			record("PASS", "version-newer", `${version} > published ${latestVersion}`);
		} else {
			record(drill ? "WARN" : "FAIL", "version-newer", `${version} is not newer than published ${latestVersion}`);
		}
	} catch (error) {
		record("WARN", "version-newer", `could not read the latest GitHub release: ${error.message}`);
	}

	const sinceTag = options.sinceTag ?? latestTag(root);
	const changed = [];
	if (sinceTag) {
		const diff = git(root, ["diff", "--name-only", `${sinceTag}..HEAD`]);
		if (diff.status === 0) changed.push(...diff.stdout.split("\n").filter(Boolean));
	}
	const changedPackages = changedSourcePackages(changed);
	const unreleased = new Map();
	for (const file of changelogPaths(root)) {
		unreleased.set(file, parseUnreleased(readFileSync(path.join(root, file), "utf8")));
	}

	const missingEntries = [];
	for (const directory of changedPackages) {
		const file = directory === "desktop-app" ? "desktop-app/src/CHANGELOG.md" : `${directory}/CHANGELOG.md`;
		const entry = unreleased.get(file);
		if (!entry || !entry.present || entry.entries === 0) missingEntries.push(file);
	}
	const emptyChangelogs = [...unreleased.entries()].filter(([, entry]) => entry.entries === 0).map(([file]) => file);
	if (missingEntries.length === 0) {
		record("PASS", "changelog-coverage", `${changedPackages.length} changed source packages have entries (since ${sinceTag ?? "no tag"})`);
	} else {
		record(drill ? "WARN" : "FAIL", "changelog-coverage", `missing [Unreleased] entries: ${[...new Set(missingEntries)].join(", ")}`);
	}
	if (emptyChangelogs.length > 0) {
		record("WARN", "changelog-empty", `[Unreleased] has no entries: ${emptyChangelogs.join(", ")}`);
	}

	const notesFile = path.join(tmpdir(), `a-coder-release-notes-${version}-${Date.now()}.md`);
	const notes = await runCommand(root, process.execPath, [
		"scripts/release-notes.mjs",
		"generate",
		"--version",
		version,
		"--tag",
		tag,
		"--no-ai",
		"--out",
		notesFile,
	]);
	if (notes.status === 0 && existsSync(notesFile)) {
		const text = readFileSync(notesFile, "utf8").trim();
		if (text.length >= 100) {
			record("PASS", "release-notes", `${text.length} chars generated without the LLM`);
		} else {
			record("FAIL", "release-notes", `generated notes are only ${text.length} chars`);
		}
		rmSync(notesFile, { force: true });
	} else {
		record("FAIL", "release-notes", `release-notes.mjs exited ${notes.status}`);
	}

	if (options.runChecks) {
		for (const [id, command, args] of [
			["npm-run-check", "npm", ["run", "check"]],
			["test-suite", "./test.sh", []],
		]) {
			console.log(`\nRunning ${id}...`);
			const run = await runCommand(root, command, args);
			record(run.status === 0 ? "PASS" : "FAIL", id, run.status === 0 ? `passed in ${run.seconds}s` : `exited ${run.status} after ${run.seconds}s`);
		}
	} else {
		record("SKIP", "npm-run-check", "run manually: npm run check (or pass --run-checks)");
		record("SKIP", "test-suite", "run manually: ./test.sh (or pass --run-checks)");
	}

	return finish();
}

async function checkInstallSmoke(tag, version, installRef, repo) {
	if (process.platform === "win32") {
		record("SKIP", "install-smoke", "install-a-coder.sh is a bash script; run this check on macOS or Linux");
		return;
	}
	const scratch = mkdtempSync(path.join(tmpdir(), "a-coder-install-check-"));
	const scriptPath = path.join(scratch, "install-a-coder.sh");
	const installDir = path.join(scratch, "install");
	try {
		const url = `https://raw.githubusercontent.com/${repo}/${installRef}/install-a-coder.sh`;
		writeFileSync(scriptPath, await fetchText(url));
		const install = spawnSync("bash", [scriptPath, tag, "--dir", installDir, "--force", "--quiet", "--no-desktop"], {
			encoding: "utf8",
			timeout: 300_000,
		});
		if (install.status !== 0) {
			record("FAIL", "install-smoke", `installer exited ${install.status}: ${(install.stderr || install.stdout || "").trim().slice(-300)}`);
			return;
		}
		const bin = path.join(installDir, "bin", "a-coder-cli");
		if (!existsSync(bin)) {
			record("FAIL", "install-smoke", `installer finished but ${bin} does not exist`);
			return;
		}
		const reported = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000 });
		const actual = (reported.stdout || "").trim();
		if (reported.status !== 0) {
			record("FAIL", "install-smoke", `a-coder-cli --version exited ${reported.status}`);
		} else if (normalizeVersion(actual) !== version) {
			record("FAIL", "install-smoke", `installed binary reports ${actual}; expected ${version}`);
		} else {
			record("PASS", "install-smoke", `pinned install reports ${actual}`);
		}
	} catch (error) {
		record("FAIL", "install-smoke", error.message);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

async function verifyChecksums(tag, repo) {
	const scratch = mkdtempSync(path.join(tmpdir(), "a-coder-checksums-"));
	try {
		const base = `https://github.com/${repo}/releases/download/${tag}`;
		const sums = await fetchText(`${base}/SHA256SUMS`);
		const entries = new Map();
		for (const line of sums.split("\n")) {
			const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
			if (match) entries.set(match[2], match[1].toLowerCase());
		}
		const archives = CLI_ASSETS.filter((name) => /\.(tar\.gz|zip)$/.test(name));
		const missing = archives.filter((name) => !entries.has(name));
		if (missing.length > 0) {
			record("FAIL", "checksums", `SHA256SUMS is missing ${missing.join(", ")}`);
			return;
		}
		const failures = [];
		for (const name of archives) {
			const file = path.join(scratch, name);
			const response = await request(`${base}/${name}`);
			if (!response.ok || !response.body) {
				failures.push(`${name}: HTTP ${response.status}`);
				continue;
			}
			await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
			const hash = createHash("sha256");
			await pipeline(createReadStream(file), hash);
			const actual = hash.digest("hex");
			if (actual !== entries.get(name)) failures.push(`${name}: hash mismatch`);
			rmSync(file, { force: true });
		}
		if (failures.length === 0) {
			record("PASS", "checksums", `${archives.length} archives match SHA256SUMS`);
		} else {
			record("FAIL", "checksums", failures.join("; "));
		}
	} catch (error) {
		record("FAIL", "checksums", error.message);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

async function postPublish(options) {
	if (!options.tag) throw new Error("post-publish requires --tag vX.Y.Z");
	const repo = options.repo ?? DEFAULT_REPO;
	const installRef = options.installRef ?? DEFAULT_INSTALL_REF;
	const tag = options.tag.startsWith("v") ? options.tag : `v${options.tag}`;
	const version = normalizeVersion(tag);
	const root = path.resolve(options.root ?? ".");
	reportContext = { mode: "post-publish", root, repo, tag, version, installRef, report: options.report };

	console.log(`\nPost-publish verification for ${tag} in ${repo}\n`);

	let release;
	try {
		release = await fetchJson(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
	} catch (error) {
		record("FAIL", "release-exists", error.message);
		return finish();
	}

	record(release.draft === false ? "PASS" : "FAIL", "release-published", release.draft === false ? "not a draft" : "release is still a draft");
	record(release.prerelease === false ? "PASS" : "FAIL", "release-stable", release.prerelease === false ? "not a prerelease" : "release is a prerelease");
	record(release.tag_name === tag ? "PASS" : "FAIL", "release-tag", `tag_name=${release.tag_name}`);
	if (typeof release.body === "string" && release.body.trim().length > 0) {
		record("PASS", "release-notes-body", `${release.body.trim().length} chars`);
	} else {
		record("FAIL", "release-notes-body", "release body is empty");
	}

	const assetNames = new Set((release.assets ?? []).map((asset) => asset.name));
	const missingCli = CLI_ASSETS.filter((name) => !assetNames.has(name));
	if (missingCli.length === 0) {
		record("PASS", "cli-assets", `all ${CLI_ASSETS.length} CLI assets present`);
	} else {
		record("FAIL", "cli-assets", `missing: ${missingCli.join(", ")}`);
	}

	for (const check of DESKTOP_ASSET_CHECKS) {
		const matches = [...assetNames].filter(check.test);
		if (matches.length > 0) {
			record("PASS", check.id, `${matches.length} asset(s)`);
		} else {
			record(check.required ? "FAIL" : "WARN", check.id, "no matching asset");
		}
	}

	let manifest = null;
	try {
		const response = await request(`https://github.com/${repo}/releases/download/${tag}/latest.json`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		manifest = JSON.parse(await response.text());
		const { errors, warnings } = validateLatestManifest(manifest, { version, tag, repo, assetNames });
		if (errors.length === 0) {
			record("PASS", "latest-manifest", `version ${manifest.version}; ${Object.keys(manifest.platforms).length} platforms; notes ${manifest.notes.length} chars`);
		} else {
			record("FAIL", "latest-manifest", errors.join("; "));
		}
		for (const warning of warnings) record("WARN", "latest-manifest", warning);
		if (typeof release.body === "string" && typeof manifest.notes === "string") {
			const body = release.body.trim();
			const notes = manifest.notes.trim();
			if (body === notes || body.startsWith(notes.replace(/\n\n…$/, "").slice(0, 1000)) || notes.startsWith(body.slice(0, 1000))) {
				record("PASS", "latest-notes-match", "manifest notes match the release body");
			} else {
				record("WARN", "latest-notes-match", "manifest notes and release body start differently");
			}
		}
	} catch (error) {
		record("FAIL", "latest-manifest", error.message);
	}

	if (manifest?.platforms) {
		const urls = DESKTOP_UPDATER_PLATFORMS.filter((key) => manifest.platforms[key]?.url).map((key) => ({
			key,
			url: manifest.platforms[key].url,
		}));
		await Promise.all(
			urls.map(async ({ key, url }) => {
				try {
					const response = await request(url, { method: "HEAD" });
					const size = Number(response.headers.get("content-length") || 0);
					if (!response.ok) {
						record("FAIL", `updater-url:${key}`, `HTTP ${response.status}`);
					} else if (size === 0) {
						record("WARN", `updater-url:${key}`, "HTTP 200 but no content-length");
					} else {
						record("PASS", `updater-url:${key}`, `HTTP 200 (${size} bytes)`);
					}
				} catch (error) {
					record("FAIL", `updater-url:${key}`, error.message);
				}
			}),
		);
	}

	try {
		const latest = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
		if (latest.tag_name !== tag) {
			record("SKIP", "updater-endpoint", `latest release is ${latest.tag_name}, not ${tag}`);
		} else {
			const endpointManifest = JSON.parse(await fetchText(`https://github.com/${repo}/releases/latest/download/latest.json`));
			const same = JSON.stringify(endpointManifest) === JSON.stringify(manifest);
			record(same ? "PASS" : "FAIL", "updater-endpoint", same ? "latest/download/latest.json matches the tag asset" : "latest/download/latest.json differs from the tag asset");
		}
	} catch (error) {
		record("FAIL", "updater-endpoint", error.message);
	}

	const installUrl = `https://raw.githubusercontent.com/${repo}/${installRef}/install-a-coder.sh`;
	try {
		const response = await request(installUrl);
		const body = response.ok ? await response.text() : "";
		if (!response.ok) {
			record("FAIL", "install-endpoint", `${installRef}: HTTP ${response.status}`);
		} else if (!body.includes(`REPO="${repo}"`)) {
			record("FAIL", "install-endpoint", `${installRef}: script does not target ${repo}`);
		} else {
			record("PASS", "install-endpoint", `${installRef}: HTTP 200`);
		}
	} catch (error) {
		record("FAIL", "install-endpoint", error.message);
	}

	try {
		const repoInfo = await fetchJson(`https://api.github.com/repos/${repo}`);
		if (repoInfo.default_branch && repoInfo.default_branch !== installRef) {
			const response = await request(`https://raw.githubusercontent.com/${repo}/${repoInfo.default_branch}/install-a-coder.sh`);
			if (response.ok) {
				record("PASS", "install-default-branch", `${repoInfo.default_branch}: HTTP 200`);
			} else {
				record("WARN", "install-default-branch", `${repoInfo.default_branch}: HTTP ${response.status}; users on the documented default branch cannot install`);
			}
		}
	} catch (error) {
		record("WARN", "install-default-branch", error.message);
	}

	if (options.installSmoke) {
		await checkInstallSmoke(tag, version, installRef, repo);
	} else {
		record("SKIP", "install-smoke", "pass --install-smoke to run a pinned install");
	}

	if (options.verifyChecksums) {
		await verifyChecksums(tag, repo);
	} else {
		record("SKIP", "checksums", "pass --verify-checksums to download and compare archives");
	}

	if (options.npm) {
		for (const directory of PUBLISH_PACKAGES) {
			const name = readJson(path.join(root, directory, "package.json")).name;
			try {
				const response = await request(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`);
				record(response.ok ? "PASS" : "FAIL", `npm:${name}`, `HTTP ${response.status}`);
			} catch (error) {
				record("FAIL", `npm:${name}`, error.message);
			}
		}
	} else {
		record("SKIP", "npm-registry", "only when ENABLE_NPM_PUBLISH=true; pass --npm to check");
	}

	record(
		"MANUAL",
		"desktop-updater-modal",
		`open a ${version} desktop build (previous version), run the update check, expect ${version} and the release notes, attach a screenshot`,
	);

	return finish();
}

function writeReport(reportPath) {
	if (!reportPath) return;
	const failed = results.filter((entry) => entry.level === "FAIL").length;
	const lines = [
		"# Release verification report",
		"",
		`- Mode: ${reportContext.mode}`,
		`- Repo: ${reportContext.repo ?? "local checkout"}`,
		`- Branch: ${reportContext.branch ?? "-"}`,
		`- Commit: ${reportContext.commit ?? "-"}`,
		`- Tag: ${reportContext.tag ?? "-"}`,
		`- Version: ${reportContext.version ?? "-"}`,
		`- Approval: ${reportContext.approval && reportContext.approval !== "" ? reportContext.approval : "-"}`,
		`- Generated: ${new Date().toISOString()}`,
		`- Result: ${failed === 0 ? "PASS" : `FAIL (${failed})`}`,
		"",
		"| Check | Result | Detail |",
		"| --- | --- | --- |",
		...results.map((entry) => `| ${entry.id} | ${entry.level} | ${entry.message.replaceAll("|", "\\|").replaceAll("\n", "<br>")} |`),
		"",
	];
	const absolute = path.resolve(reportPath);
	mkdirSync(path.dirname(absolute), { recursive: true });
	writeFileSync(absolute, lines.join("\n"));
	console.log(`\nReport: ${absolute}`);
}

function finish() {
	const failed = results.filter((entry) => entry.level === "FAIL").length;
	const warnings = results.filter((entry) => entry.level === "WARN").length;
	console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${results.length} checks recorded, ${failed} failed, ${warnings} warnings\n`);
	writeReport(reportContext.report);
	return failed === 0 ? 0 : 1;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.command === "help") return 0;
	if (options.help) {
		printUsage();
		return 0;
	}
	if (options.command === "pre-tag") return preTag(options);
	if (options.command === "post-publish") return postPublish(options);
	printUsage();
	return 2;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			console.error(`ERROR: ${error.message}`);
			process.exitCode = 2;
		});
}

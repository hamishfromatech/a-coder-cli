#!/usr/bin/env node
/**
 * Stage the platform `pi` engine as a Tauri resource archive.
 *
 * The desktop installer ships one `engine.tar.gz` inside `$RESOURCE/`. Keeping
 * the engine in an archive (instead of a tree of nested executables) keeps the
 * macOS bundle notarizable; on first launch the app extracts it into
 * `~/.a-coder/cli/lib/a-coder-cli` and runs the local copy. That copy is
 * writable, so npx/npm caches and MCP servers behave normally.
 *
 * Usage:
 *   node scripts/stage-desktop-engine.mjs [--platform darwin] [--arch arm64]
 *     [--artifact-dir <dir>] [--source <dir>] [--dest <file>]
 *     [--no-download] [--require]
 */
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const desktopDir = join(root, "desktop-app");
const bundleDir = join(desktopDir, "src-tauri", "resources", "bundle");
const desktopVersion = JSON.parse(
	readFileSync(join(desktopDir, "package.json"), "utf8"),
).version;

function arg(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const defaultPlatform =
	process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
const platform = arg("--platform", defaultPlatform);
const arch = arg("--arch", process.arch === "x64" ? "x64" : process.arch);
const dest = resolve(arg("--dest", join(bundleDir, "engine.tar.gz")));
const versionFile = join(bundleDir, "engine.version");
const artifactDir = arg("--artifact-dir");
const explicitSource = arg("--source");
const allowDownload = !process.argv.includes("--no-download");
const required = process.argv.includes("--require");
const asset = `pi-${platform}-${arch}.${platform === "windows" ? "zip" : "tar.gz"}`;
// Git Bash's GNU tar misreads `D:\...` as a remote host and cannot read zip.
// Use the Windows bsdtar (Windows 10 1803+) on Windows runners.
const tarCommand = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";

function log(message) {
	console.log(`[engine] ${message}`);
}

function fail(message) {
	// Never leave a stale archive from a previous build in the bundle.
	rmSync(dest, { force: true });
	rmSync(versionFile, { force: true });
	if (required) {
		console.error(`[engine] ${message}`);
		process.exit(1);
	}
	console.warn(`[engine] ${message} (desktop will fall back to the first-launch download)`);
	process.exit(0);
}

function isEngineDir(dir) {
	const bin = platform === "windows" ? "pi.exe" : "pi";
	if (!existsSync(join(dir, bin))) return false;
	return existsSync(join(dir, "package.json")) || existsSync(join(dir, "node", "bin", "node")) ||
		existsSync(join(dir, "node", "node.exe"));
}

function engineVersion(dir) {
	try {
		return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
	} catch {
		return undefined;
	}
}

function extractArchive(archive, target) {
	mkdirSync(target, { recursive: true });
	const lower = archive.toLowerCase();
	if (lower.endsWith(".zip")) {
		if (process.platform === "win32") {
			execFileSync(tarCommand, ["-xf", archive, "-C", target], { stdio: "inherit" });
		} else {
			execFileSync("unzip", ["-q", archive, "-d", target], { stdio: "inherit" });
		}
		const entries = readdirSync(target);
		if (entries.length === 1 && entries[0] === "pi") {
			const wrapped = join(target, "pi");
			for (const entry of readdirSync(wrapped)) {
				renameSync(join(wrapped, entry), join(target, entry));
			}
			rmSync(wrapped, { recursive: true, force: true });
		}
		return;
	}
	execFileSync(tarCommand, ["-xzf", archive, "-C", target, "--strip-components=1"], {
		stdio: "inherit",
	});
}

function installNodeWrappers(engineDir) {
	if (platform === "windows") return;
	// Some packagers dereference Node's bin/npm and bin/npx symlinks. Use
	// small wrappers so the result works regardless of archive extraction.
	const bin = join(engineDir, "node", "bin");
	const wrappers = [
		["npm", "../lib/node_modules/npm/bin/npm-cli.js"],
		["npx", "../lib/node_modules/npm/bin/npx-cli.js"],
	];
	for (const [name, cli] of wrappers) {
		const file = join(bin, name);
		rmSync(file, { force: true });
		writeFileSync(
			file,
			`#!/bin/sh\ndir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$dir/node" "$dir/${cli}" "$@"\n`,
		);
		chmodSync(file, 0o755);
	}
}

function createEngineArchive(source, target) {
	const temp = mkdtempSync(join(tmpdir(), "a-coder-engine-pack-"));
	try {
		const packaged = join(temp, "pi");
		cpSync(source, packaged, { recursive: true, verbatimSymlinks: true });
		installNodeWrappers(packaged);
		const version = engineVersion(packaged) ?? desktopVersion;
		writeFileSync(join(packaged, "ENGINE_VERSION"), `${version}\n`);
		mkdirSync(resolve(target, ".."), { recursive: true });
		rmSync(target, { force: true });
		execFileSync(tarCommand, ["-czf", target, "-C", temp, "pi"], { stdio: "inherit" });
		return version;
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

function download(url, out) {
	log(`downloading ${url}`);
	return fetch(url).then(async (response) => {
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		writeFileSync(out, Buffer.from(await response.arrayBuffer()));
	});
}

async function fromArtifactDir(dir) {
	const archive = join(dir, asset);
	if (!existsSync(archive)) throw new Error(`missing ${asset} in ${dir}`);
	const temp = mkdtempSync(join(tmpdir(), "a-coder-engine-"));
	try {
		extractArchive(archive, temp);
		if (!isEngineDir(temp)) throw new Error(`${asset} does not contain an engine tree`);
		return { dir: temp, tempRoot: temp };
	} catch (error) {
		rmSync(temp, { recursive: true, force: true });
		throw error;
	}
}

function fromLocalInstall() {
	const candidates = [
		join(homedir(), ".a-coder", "cli", "lib", "a-coder-cli"),
		join(root, "packages", "coding-agent", "binaries", `${platform}-${arch}`),
	];
	for (const candidate of candidates) {
		if (isEngineDir(candidate)) return { dir: candidate, tempRoot: undefined };
	}
	return undefined;
}

async function fromDownload() {
	let tag = `v${desktopVersion}`;
	let temp = mkdtempSync(join(tmpdir(), "a-coder-engine-dl-"));
	let archive = join(temp, asset);
	try {
		try {
			await download(
				`https://github.com/hamishfromatech/a-coder-cli/releases/download/${tag}/${asset}`,
				archive,
			);
		} catch (error) {
			// Desktop-only builds may run before their matching CLI tag exists.
			// Fall back to the latest CLI engine; the app reports a newer-engine
			// skew rather than rejecting it.
			const response = await fetch(
				"https://api.github.com/repos/hamishfromatech/a-coder-cli/releases/latest",
			);
			if (!response.ok) throw error;
			const release = await response.json();
			tag = release.tag_name;
			log(`matching CLI tag unavailable; using latest ${tag}`);
			await download(
				`https://github.com/hamishfromatech/a-coder-cli/releases/download/${tag}/${asset}`,
				archive,
			);
		}
		const extracted = join(temp, "engine");
		extractArchive(archive, extracted);
		if (!isEngineDir(extracted)) throw new Error(`downloaded ${asset} has no engine tree`);
		return { dir: extracted, tempRoot: temp };
	} catch (error) {
		rmSync(temp, { recursive: true, force: true });
		throw error;
	}
}

async function main() {
	if (
		!explicitSource &&
		!artifactDir &&
		existsSync(dest) &&
		existsSync(versionFile) &&
		readFileSync(versionFile, "utf8").trim() === desktopVersion
	) {
		log(`already staged ${desktopVersion} -> ${dest}`);
		return;
	}

	let source;
	let tempRoot;
	if (explicitSource) {
		source = resolve(explicitSource);
		if (!isEngineDir(source)) fail(`${source} is not an engine tree`);
	} else if (artifactDir) {
		try {
			const artifact = await fromArtifactDir(resolve(artifactDir));
			source = artifact.dir;
			tempRoot = artifact.tempRoot;
		} catch (error) {
			fail(`could not use artifact ${asset}: ${error.message}`);
		}
	} else {
		const local = fromLocalInstall();
		if (local) {
			source = local.dir;
			log(`using local engine ${source}`);
		} else if (allowDownload) {
			try {
				const downloaded = await fromDownload();
				source = downloaded.dir;
				tempRoot = downloaded.tempRoot;
			} catch (error) {
				fail(`no local engine and download failed: ${error.message}`);
			}
		} else {
			fail("no local engine found (use --source or --artifact-dir)");
		}
	}

	const version = createEngineArchive(source, dest);
	if (version !== desktopVersion) {
		log(`engine ${version} differs from desktop ${desktopVersion}; app will reconcile at startup`);
	}
	writeFileSync(versionFile, `${desktopVersion}\n`);
	log(`staged ${asset} (${version}) -> ${dest}`);
	log(`size ${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB`);
	if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
}

main().catch((error) => fail(error.stack ?? String(error)));

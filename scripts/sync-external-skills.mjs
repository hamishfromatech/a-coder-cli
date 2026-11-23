#!/usr/bin/env node
/**
 * Vendor the external skills we ship alongside the Hermes set.
 *
 * Sources:
 *   - Ponytail (https://github.com/DietrichGebert/ponytail) — six coding skills
 *   - REA (https://github.com/sgunin/reverseengineeranything) — reverse-engineering skill
 *
 * Both are MIT. The vendored copies are what ship in the CLI/desktop packages;
 * this script is the refresh path. It clones the sources when --source-* is
 * omitted, so a refresh needs only network access.
 *
 * Usage:
 *   node scripts/sync-external-skills.mjs
 *   node scripts/sync-external-skills.mjs --source-ponytail ../ponytail --source-rea ../rea
 *   node scripts/sync-external-skills.mjs --check
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const skillsRoot = join(root, "packages", "coding-agent", "skills");
const check = process.argv.includes("--check");

const SOURCES = [
	{
		id: "ponytail",
		repo: "https://github.com/DietrichGebert/ponytail.git",
		url: "https://github.com/DietrichGebert/ponytail",
		author: "DietrichGebert",
		license: "MIT",
		sourceRoot: "skills",
		skills: [
			"ponytail",
			"ponytail-audit",
			"ponytail-debt",
			"ponytail-gain",
			"ponytail-help",
			"ponytail-review",
		],
		readme: (commit) => `# Ponytail skills (vendored)

Six skills from [Ponytail](https://github.com/DietrichGebert/ponytail) (MIT, DietrichGebert),
vendored at \`${commit}\`:

- \`ponytail\` — lazy senior dev ruleset (lite / full / ultra)
- \`ponytail-audit\`, \`ponytail-debt\`, \`ponytail-gain\`, \`ponytail-help\`, \`ponytail-review\`

Invoke with \`skill:ponytail\` (or say "ponytail", "be lazy", "simplest solution").
The upstream text still names its original host's \`/ponytail ...\` commands; here,
request the level in prose (lite, full, ultra) or say "stop ponytail" to leave the mode.

Refresh from a clean upstream checkout:

\`\`\`sh
git clone --depth 1 https://github.com/DietrichGebert/ponytail.git /tmp/ponytail
node scripts/sync-external-skills.mjs --source-ponytail /tmp/ponytail
node scripts/sync-external-skills.mjs --check
\`\`\`
`,
	},
	{
		id: "rea",
		repo: "https://github.com/sgunin/reverseengineeranything.git",
		url: "https://github.com/sgunin/reverseengineeranything",
		author: "morluto",
		license: "MIT",
		sourceRoot: "skills",
		skills: ["reverse-engineer-anything"],
		readme: (commit) => `# REA skill (vendored)

\`reverse-engineer-anything\` from [REA](https://github.com/sgunin/reverseengineeranything)
(MIT, morluto), vendored at \`${commit}\`.

REA is a reverse-engineering MCP server and CLI. The skill's tools are provided by
that server, so register it before use:

\`\`\`sh
npx rea-agents@latest setup
# or register the server manually:
# npx -y rea-agents@<version> mcp
\`\`\`

The skill includes the readiness check and the setup/escalation rules. Refresh:

\`\`\`sh
git clone --depth 1 https://github.com/sgunin/reverseengineeranything.git /tmp/rea
node scripts/sync-external-skills.mjs --source-rea /tmp/rea
node scripts/sync-external-skills.mjs --check
\`\`\`
`,
	},
];

const tempDirs = [];
const targetDirs = SOURCES.map((source) => join(skillsRoot, source.id));

try {
	const generated = SOURCES.map((source) => {
		const sourceDir = resolveSource(source);
		return generate(source, sourceDir);
	});
	if (check) {
		let failed = false;
		for (let i = 0; i < SOURCES.length; i += 1) {
			const differences = compareTrees(targetDirs[i], generated[i].dir);
			if (differences.length > 0) {
				failed = true;
				console.error(`${SOURCES[i].id} is out of date:\n${differences.join("\n")}`);
			}
		}
		if (failed) process.exit(1);
		console.log("External skills are up to date.");
	} else {
		for (let i = 0; i < SOURCES.length; i += 1) {
			rmSync(targetDirs[i], { recursive: true, force: true });
			mkdirSync(targetDirs[i], { recursive: true });
			copyContents(generated[i].dir, targetDirs[i]);
		}
		console.log(`Vendored ${SOURCES.map((s) => `${s.skills.length} ${s.id}`).join(" + ")} skills.`);
	}
} finally {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}

function resolveSource(source) {
	const explicit = arg(`--source-${source.id}`);
	if (explicit) {
		const dir = resolve(explicit);
		if (!existsSync(dir)) fail(`source not found: ${dir}`);
		return dir;
	}
	const dir = mkdtempSync(join(tmpdir(), `a-coder-${source.id}-`));
	tempDirs.push(dir);
	execFileSync("git", ["clone", "--depth", "1", source.repo, dir], { stdio: ["ignore", "ignore", "inherit"] });
	return dir;
}

function generate(source, sourceDir) {
	const commit = git(["rev-parse", "HEAD"], sourceDir) ?? "unknown";
	const out = mkdtempSync(join(tmpdir(), `a-coder-${source.id}-vendor-`));
	tempDirs.push(out);
	const manifest = [];
	for (const skill of source.skills) {
		const from = join(sourceDir, source.sourceRoot, skill);
		if (!existsSync(join(from, "SKILL.md"))) fail(`missing source skill: ${source.id}/${skill}`);
		const to = join(out, skill);
		cpSync(from, to, { recursive: true });
		manifest.push({ name: skill, sourcePath: `${source.sourceRoot}/${skill}`, sha256: hashTree(to) });
	}
	cpSync(join(sourceDir, "LICENSE"), join(out, "LICENSE"));
	writeFileSync(join(out, "README.md"), source.readme(commit));
	manifest.sort((a, b) => a.name.localeCompare(b.name));
	writeFileSync(
		join(out, "MANIFEST.json"),
		`${JSON.stringify(
			{
				source: source.url,
				sourceCommit: commit,
				license: source.license,
				author: source.author,
				generatedBy: "scripts/sync-external-skills.mjs",
				skills: manifest,
			},
			null,
			"\t",
		)}\n`,
	);
	return { dir: out, commit };
}

function copyContents(from, to) {
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		cpSync(join(from, entry.name), join(to, entry.name), { recursive: true });
	}
}

function hashTree(dir) {
	const hash = createHash("sha256");
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile()) {
				hash.update(relative(dir, path));
				hash.update("\0");
				hash.update(readFileSync(path));
				hash.update("\0");
			}
		}
	};
	walk(dir);
	return hash.digest("hex");
}

function compareTrees(expectedDir, actualDir) {
	const differences = [];
	const walk = (left, right) => {
		const leftEntries = existsSync(left) ? readdirSync(left, { withFileTypes: true }) : [];
		const rightEntries = existsSync(right) ? readdirSync(right, { withFileTypes: true }) : [];
		const leftNames = new Set(leftEntries.map((entry) => entry.name));
		const rightNames = new Set(rightEntries.map((entry) => entry.name));
		for (const name of leftNames) if (!rightNames.has(name)) differences.push(`extra ${join(left, name)}`);
		for (const name of rightNames) {
			if (!leftNames.has(name)) {
				differences.push(`missing ${join(left, name)}`);
				continue;
			}
			const leftPath = join(left, name);
			const rightPath = join(right, name);
			const leftStat = statSync(leftPath);
			const rightStat = statSync(rightPath);
			if (leftStat.isDirectory() !== rightStat.isDirectory()) {
				differences.push(`type mismatch ${leftPath}`);
			} else if (leftStat.isDirectory()) {
				walk(leftPath, rightPath);
			} else if (!readFileSync(leftPath).equals(readFileSync(rightPath))) {
				differences.push(`changed ${leftPath}`);
			}
		}
	};
	walk(expectedDir, actualDir);
	return differences;
}

function git(args, cwd) {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

function arg(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

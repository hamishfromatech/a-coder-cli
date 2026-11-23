#!/usr/bin/env node
/**
 * Vendor the curated Hermes Agent skill set into the CLI bundle.
 *
 * Hermes writes its skills for its own tool names and config paths. The
 * porting pass below keeps the instructions but normalises them for
 * a-coder-cli: `~/.hermes` becomes the agent dir, `terminal` becomes `bash`,
 * and so on. A header on every ported SKILL.md spells out the mapping,
 * including Hermes tools that have no a-coder-cli equivalent.
 *
 * Usage:
 *   node scripts/sync-hermes-skills.mjs [--source ../hermes-agent] [--check]
 *
 * The vendored copy is the release artifact: build-binaries.sh and the npm
 * package both include packages/coding-agent/skills. The source checkout is
 * only needed when refreshing the set.
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
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targetRoot = join(root, "packages", "coding-agent", "skills", "hermes");
const source = resolve(arg("--source", join(root, "..", "hermes-agent")));
const check = process.argv.includes("--check");

/** Hermes skills (built-in and optional) relevant to coding, engineering, marketing, computer and browser use. */
const SELECTION = [
	"skills/software-development/test-driven-development",
	"skills/software-development/systematic-debugging",
	"skills/software-development/github",
	"skills/software-development/codebase-inspection",
	"skills/software-development/spike",
	"skills/software-development/requesting-code-review",
	"skills/software-development/simplify-code",
	"optional-skills/software-development/python-debugpy",
	"optional-skills/software-development/node-inspect-debugger",
	"skills/software-development/dogfood",
	"skills/web/blocked-page-recovery",
	"skills/autonomous-ai-agents/computer-use",
	"skills/social-media/xurl",
	"skills/creative/humanizer",
	"skills/creative/baoyu-infographic",
	"skills/creative/claude-design",
	"optional-skills/creative/design-md",
	"skills/creative/popular-web-designs",
	"skills/creative/architecture-diagram",
	"skills/creative/p5js",
	"skills/research/competitor-news-monitor",
	"skills/research/grounded-citations",
	"skills/media/youtube-content",
];

const PORTING_NOTE = [
	"> Ported from [Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT, Nous Research).",
	"> In a-coder-cli: `terminal` is `bash`; `read_file`/`write_file`/`patch` are `read`/`write`/`edit`;",
	"> `search_files` is `bash` (`rg`); `delegate_task` is `spawn_subagent` (one call per subagent);",
	"> `computer_use` is `computer`; `browser_exec` is `browser_run_script`; `browser_vision` is",
	"> `browser_screenshot`; `cronjob` is `schedule_task`. `web_search`, `web_extract`,",
	"> `image_generate` and `vision_analyze` have no built-in equivalent here; use an available",
	"> MCP/browser tool or skip that step.",
].join("\n");

/** Safe, backticked tool-name rewrites. */
const GENERIC_REPLACEMENTS = [
	["`terminal`", "`bash`"],
	["`read_file`", "`read`"],
	["`write_file`", "`write`"],
	["`patch`", "`edit`"],
	["`search_files`", "`bash`"],
	["`delegate_task`", "`spawn_subagent`"],
	["`computer_use`", "`computer`"],
	["`browser_exec`", "`browser_run_script`"],
	["`browser_vision`", "`browser_screenshot`"],
	["`cronjob`", "`schedule_task`"],
	// Function-call forms inside Hermes code samples.
	["delegate_task(", "spawn_subagent("],
	["computer_use(", "computer("],
	["terminal(\"", "bash(\""],
	["write_file(\"", "write(\""],
	["read_file(\"", "read(\""],
];

/** Path/identifier rewrites. `SKILL_DIR` follows the a-coder-cli token spelling. */
const PATH_REPLACEMENTS = [
	["~/.hermes", "~/.a-coder/cli/agent"],
	["${HERMES_HOME:-$HOME/.hermes}", "$HOME/.a-coder/cli/agent"],
	["$HOME/.hermes", "$HOME/.a-coder/cli/agent"],
	["${HERMES_HOME:-~/.hermes}", "~/.a-coder/cli/agent"],
	["$HERMES_HOME", "~/.a-coder/cli/agent"],
	["HERMES_HOME", "~/.a-coder/cli/agent"],
	["Hermes has no such UI layer", "The CLI has no such UI layer"],
	["HERMES.md", "AGENTS.md"],
	["Code review from Hermes Agent", "Code review from a-coder-cli"],
	["Reviewed by Hermes Agent.", "Reviewed by a-coder-cli."],
	["Reviewed by Hermes Agent", "Reviewed by a-coder-cli"],
	["_hermes_env", "_a_coder_env"],
	["template's Hermes notes", "template's implementation notes"],
	["hermes chat -q", "a-coder-cli -p"],
	["`hermes update`", "update a-coder-cli"],
	["**Tester:** Hermes Agent", "**Tester:** a-coder-cli"],
	["HERMES_CITATION_LEDGER", "A_CODER_CITATION_LEDGER"],
	["Hermes Agent — Implementation Notes", "a-coder-cli — Implementation Notes"],
	["Hermes Implementation Notes", "a-coder-cli Implementation Notes"],
];

/** Per-skill fixes for prose that only makes sense inside Hermes. */
const SKILL_OVERRIDES = {
	"autonomous-ai-agents/computer-use": [
		[
			/Hermes drives \[cua-driver\]\(https:\/\/github\.com\/trycua\/cua\) under the hood\.\nThis skill teaches the Hermes `computer` \*\*action vocabulary\*\*, which is\nNOT the driver's raw MCP vocabulary\./,
			"a-coder-cli's `computer` tool drives [cua-driver](https://github.com/trycua/cua)\nunder the hood. This skill teaches the `computer` **action vocabulary**, which\nis NOT the driver's raw MCP vocabulary.",
		],
		[
			/`capture` is a Hermes action that maps to\nthe driver's `get_window_state`; `element=N` is a Hermes argument that the\nwrapper translates into the driver's `element_token` handle\./,
			"`capture` is a `computer` action that maps to the driver's `get_window_state`;\n`element=N` is a `computer` argument that the wrapper translates into the\ndriver's `element_token` handle.",
		],
		[
			/`mode` decides what Hermes hands back to you, not what the driver does\./,
			"`mode` decides what the tool hands back to you, not what the driver does.",
		],
		[
			/\*\*No vision model\?\*\* [\s\S]*?drive by element index without a screenshot at all\.\n\n/,
			"**No vision model?** Use `mode=\"ax\"` and drive by element index without a\nscreenshot.\n\n",
		],
		[/\(Hermes has no such argument\)/, "(a-coder-cli has no such argument)"],
		[/the Hermes side/g, "the a-coder-cli side"],
		[/Hermes intentionally keeps THIS skill focused on the Hermes-side/, "This skill is focused on the a-coder-cli side"],
		[/`hermes computer-use doctor`/g, "`a-coder-cli` doctor output"],
		[/HERMES_CUA_DRIVER_CMD/g, "A_CODER_CUA_DRIVER_CMD"],
		[/Run `hermes computer-use install`, or `hermes tools` and enable Computer Use/, "Install cua-driver for your platform, then re-run `computer(action=\"doctor\")`"],
		[/The Hermes venv interpreter can't execute a binary/, "The runtime can't execute a binary"],
		[/any other `WindowsApps` binary Hermes spawns/, "any other `WindowsApps` binary the tool spawns"],
		[/\(Hermes is a detected\nagent;/, "(a-coder-cli is a detected\nagent;"],
		[/calling the Hermes actions from this file/, "calling the actions from this file"],
	],
	"creative/claude-design": [[/Hermes has three design-related skills/, "a-coder-cli has three design-related skills"]],
	"creative/baoyu-infographic": [
		[/for Hermes Agent's tool ecosystem/, "for a-coder-cli's tool ecosystem"],
	],
	"creative/humanizer": [
		[/Hermes's baseline voice/, "a-coder-cli's baseline voice"],
		[/## How to use it in Hermes/, "## How to use it in a-coder-cli"],
	],
	"creative/popular-web-designs": [
		[/\*\*a-coder-cli Implementation Notes\*\* block/, "**Implementation Notes** block"],
	],
	"software-development/test-driven-development": [
		[/## Hermes Agent Integration/, "## a-coder-cli Integration"],
		[/### With delegate_task/, "### With subagents"],
		[
			/```python\nspawn_subagent\(\n    goal="Implement \[feature\] using strict TDD",[\s\S]*?\n\)\n```/,
			"```python\nspawn_subagent(\n    id=\"impl-1\",\n    task=\"Implement [feature] using strict TDD. Write a failing test first, run it, write the minimal code, run it again, refactor, then commit. Project test command: pytest tests/ -q.\"\n)\n```",
		],
	],
	"software-development/systematic-debugging": [
		[/## Hermes Agent Integration/, "## a-coder-cli Integration"],
		[/### With delegate_task/, "### With subagents"],
		[/Use these Hermes tools during Phase 1:/, "Use these tools during Phase 1:"],
		[/\*\*`web_search`\/`web_extract`\*\*/, "**web search/extract tools (if available)**"],
		[
			/```python\nspawn_subagent\(\n    goal="Investigate why \[specific test\/behavior\] fails",[\s\S]*?\n\)\n```/,
			"```python\nspawn_subagent(\n    id=\"debug-1\",\n    task=\"Investigate why [specific test/behavior] fails. Follow systematic-debugging: read the error, reproduce it, trace the data flow, and report findings without fixing. Error: [paste]. File: [path]. Test command: [exact command].\"\n)\n```",
		],
	],
	"software-development/python-debugpy": [
		[
			/For Hermes, use a separate development checkout and data home, not a live\nproduction generation\.[\s\S]*?arrange a restart in the\ndevelopment environment\./,
			"Use an isolated debug environment, not the running production environment.\nCreate a throwaway venv and install `debugpy` into it:\n\n```bash\npython3 -m venv .debug-venv\n.debug-venv/bin/python -m pip install debugpy\n.debug-venv/bin/python -c \"import debugpy; print(debugpy.__file__)\"\n```\n\nRun the patterns below through that interpreter. Do not install `debugpy`\ninto a production environment.",
		],
		[
			/For long-lived processes: Hermes gateway, tui_gateway, a daemon, a process that's already misbehaving and can't be restarted clean\./,
			"For long-lived processes: `a-coder-cli serve`, a gateway, a daemon, or a process that is already misbehaving and cannot be restarted cleanly.",
		],
		[/\(hermes gateway, tui_gateway\)/, "(`a-coder-cli serve`)"],
		[/From inside Hermes you have two practical options:/, "From inside a-coder-cli you have two practical options:"],
		[/## Debugging Hermes-specific Processes/, "## Debugging a-coder-cli-specific Processes"],
		[/run `python hermes`/, "run `a-coder-cli`"],
		[/### `tui_gateway` subprocess \(spawned by `hermes --tui`\)/, "### TUI subprocess"],
		[/Start `python hermes --tui` from the prepared debug checkout\./, "Start the TUI from the prepared debug checkout."],
		[/For Hermes subagents, debug one process at a time\./, "For subagents, debug one process at a time."],
		[/"name": "Attach to Hermes"/, '"name": "Attach to a-coder-cli"'],
		[/"remoteRoot": "<hermes-agent-repo>"/, '"remoteRoot": "${workspaceFolder}"'],
		[
			/This is not a Hermes SDK install recipe\. For\nHermes, prefer the declared debugpy dependency; the remote-pdb examples below\nrequire a separately declared, freshly built debug environment, never an\nin-place pip install into the selected application generation\./,
			"This is not an a-coder-cli SDK install recipe. Use the isolated debug\nenvironment above; the remote-pdb examples below require a separately\ndeclared debug environment, never an in-place pip install into the running app.",
		],
	],
	"software-development/node-inspect-debugger": [
		[/Hermes-specific note:/, "Note:"],
		[/## Debugging Hermes ui-tui/, "## Debugging the a-coder-cli TUI"],
		[/`ui-tui\/package\.json`/g, "`packages/tui/package.json`"],
		[/<hermes-agent-repo>\/ui-tui/g, "packages/tui"],
		[/### Debugging a running `hermes --tui`/, "### Debugging a running TUI"],
		[/hermes --tui &/, "a-coder-cli &"],
		[
			/In Hermes, launch it with `terminal\(pty=true\)` or `background=true` \+ `process\(action='submit', data='\.\.\.'\)`\./,
			"Launch it in a background `bash` call and drive it with input; interactive\nstepping needs a PTY-capable terminal.",
		],
	],
	"social-media/xurl": [
		[/Hermes tool subprocesses/g, "tool subprocesses"],
		[/official Hermes Docker layout/g, "official Docker layout"],
		[/Hermes tool calls/g, "tool calls"],
		[/Hermes subprocess HOME/g, "tool subprocess HOME"],
		[/Hermes-run/g, "tool-run"],
		[/Hermes adaptation:/g, "a-coder-cli adaptation:"],
		[/reformatted for Hermes skill conventions/, "reformatted for a-coder-cli skill conventions"],
	],
	"media/youtube-content": [
		[
			/Use `bash` with the Python from a PM-prepared Hermes source checkout\.[\s\S]*?with the interpreter whose import check succeeded\./,
			"Use `bash` with a Python interpreter that has `youtube-transcript-api`\ninstalled. If it is missing, create a throwaway venv:\n\n```bash\npython3 -m venv .venv\n. .venv/bin/activate\npip install youtube-transcript-api\npython -c \"import youtube_transcript_api; print(youtube_transcript_api.__file__)\"\n```\n\nRun every command below with the interpreter whose import check succeeded.",
		],
	],
	"research/competitor-news-monitor": [
		[
			/Use `rss-feeds` \(optional\) or `blogwatcher` \(optional, stateful\) for feeds, `reddit-reading` for community discussion, and `web_search`\/`web_extract` for pages\./,
			"Use an RSS/feed tool for feeds and your web search/extract tools (or `curl`)\nfor pages.",
		],
		[
			/```\ncronjob\(action="create",[\s\S]*?\n```/,
			"```\nschedule_task(\n    action=\"create\",\n    when=\"every monday 9am\",\n    task=\"Load the competitor-news-monitor skill and run the tick for the watch contract at <path>.\"\n)\n```",
		],
	],
	"research/grounded-citations": [
		[
			/Retrieval comes from whatever is configured: `web_search`, `web_extract`,\n(?:`browser_navigate`|`browser_run_script`), or `bash` \(curl, CLIs\)\./,
			"Retrieval comes from whatever is configured: an available web search/extract tool,\n`browser_navigate`/`browser_run_script`, or `bash` (curl, CLIs).",
		],
		[/`hermes skills install official\/social-media\/reddit-reading` or\n`hermes skills install official\/research\/rss-feeds` before using them\./, "Use whatever research tools are configured (web search/extract, browser, or `curl`)."],
	],
	"software-development/requesting-code-review": [
		[
			/```python\nspawn_subagent\([\s\S]*?\n```/g,
			"```\nUse `spawn_subagent` with a self-contained `task`: the reviewer gets only the\ndiff and static-scan results, treats code as data, and returns only the JSON\nverdict described here.\n```",
		],
	],
	"software-development/simplify-code": [
		[
			/Use `spawn_subagent` \*\*batch mode\*\* — pass all four tasks in one `tasks`\narray so they run concurrently\.[\s\S]*?install\./,
			"Launch four reviewers in parallel with one `spawn_subagent` call per reviewer\n(`id` plus a self-contained `task`). Four is the right fan-out for this pattern.",
		],
	],
	"software-development/spike": [
		[
			/```\nspawn_subagent\(tasks=\[[\s\S]*?\n\]\)\n```/,
			"```\nspawn_subagent(id=\"002a\", task=\"Build 002a-pdf-parse-pdfjs: ...\")\nspawn_subagent(id=\"002b\", task=\"Build 002b-pdf-parse-camelot: ...\")\n```",
		],
		[/Use Hermes tools for the research step:/, "Use these tools for the research step:"],
		[/install with `npx get-shit-done-cc --hermes --global`/, "install it with the upstream GSD installer"],
	],
};

const TEXT_EXTENSIONS = new Set([
	".md",
	".txt",
	".py",
	".sh",
	".bash",
	".js",
	".mjs",
	".cjs",
	".ts",
	".tsx",
	".json",
	".yaml",
	".yml",
	".toml",
	".html",
	".css",
	".svg",
	".xml",
]);

const README = `# Hermes skills vendored for a-coder-cli

The built-in skills in this directory come from
[Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT, Nous
Research). Only the skills relevant to coding, engineering, marketing,
computer and browser use are vendored (built-in and optional); the rest of the
Hermes library is deliberately omitted.

## Tool mapping

Hermes and a-coder-cli expose the same capabilities under different tool names:

| Hermes | a-coder-cli |
|---|---|
| \`terminal\` | \`bash\` |
| \`read_file\` / \`write_file\` / \`patch\` | \`read\` / \`write\` / \`edit\` |
| \`search_files\` | \`bash\` (\`rg\`) |
| \`delegate_task\` | \`spawn_subagent\` (one call per subagent) |
| \`computer_use\` | \`computer\` |
| \`browser_exec\` | \`browser_run_script\` |
| \`browser_vision\` | \`browser_screenshot\` |
| \`cronjob\` | \`schedule_task\` |

\`web_search\`, \`web_extract\`, \`image_generate\` and \`vision_analyze\` have no
built-in a-coder-cli equivalent. Use an available MCP or browser tool, or skip
that step.

## Refreshing the set

\`\`\`sh
node scripts/sync-hermes-skills.mjs --source ../hermes-agent
node scripts/sync-hermes-skills.mjs --source ../hermes-agent --check
\`\`\`

The sync script owns these files: edit the selection or the porting overrides
there, not the generated copies.
`;

if (!existsSync(source)) {
	fail(`source checkout not found: ${source}`);
}
const sourceCommit = git(["rev-parse", "HEAD"], source) ?? "unknown";

if (check) {
	const temp = mkdtempSync(join(tmpdir(), "hermes-skills-"));
	try {
		generate(temp);
		const diff = compareTrees(targetRoot, temp);
		if (diff.length > 0) {
			fail(`vendored skills are out of date:\n${diff.join("\n")}`);
		}
		console.log(`Hermes skills are up to date (source ${sourceCommit.slice(0, 12)}).`);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
} else {
	rmSync(targetRoot, { recursive: true, force: true });
	generate(targetRoot);
	console.log(`Vendored ${SELECTION.length} Hermes skills into ${relative(root, targetRoot)}.`);
}

function generate(destRoot) {
	mkdirSync(destRoot, { recursive: true });
	const manifest = [];
	for (const sourcePath of SELECTION) {
		const sourceDir = resolveSourceDir(sourcePath);
		if (!sourceDir) {
			fail(`missing source skill: ${sourcePath}`);
		}
		const actualSourcePath = relative(source, sourceDir);
		const relativePath = actualSourcePath.split("/").slice(1).join("/");
		const destDir = join(destRoot, relativePath);
		copyTree(sourceDir, destDir);
		portSkill(join(destDir, "SKILL.md"), relativePath);
		manifest.push({
			name: relativePath.split("/").at(-1),
			sourcePath: actualSourcePath,
			sha256: hashTree(destDir),
		});
	}
	writeFileSync(join(destRoot, "README.md"), README);
	cpSync(join(source, "LICENSE"), join(destRoot, "LICENSE"));
	manifest.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
	writeFileSync(
		join(destRoot, "MANIFEST.json"),
		`${JSON.stringify(
			{
				source: "https://github.com/NousResearch/hermes-agent",
				sourceCommit,
				license: "MIT",
				generatedBy: "scripts/sync-hermes-skills.mjs",
				skills: manifest,
			},
			null,
			"\t",
		)}\n`,
	);
}

/**
 * Resolve a selected skill against either root. Hermes moves skills between
 * `skills/` (built-in) and `optional-skills/` without changing their content.
 */
function resolveSourceDir(sourcePath) {
	const [root, ...rest] = sourcePath.split("/");
	const candidates = [sourcePath];
	if (root === "skills") candidates.push(["optional-skills", ...rest].join("/"));
	if (root === "optional-skills") candidates.push(["skills", ...rest].join("/"));
	for (const candidate of candidates) {
		const dir = join(source, candidate);
		if (existsSync(join(dir, "SKILL.md"))) return dir;
	}
	return undefined;
}

function copyTree(from, to) {
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		if (entry.name === "PORT_NOTES.md") continue;
		const fromPath = join(from, entry.name);
		const toPath = join(to, entry.name);
		if (entry.isDirectory()) {
			copyTree(fromPath, toPath);
		} else if (entry.isFile()) {
			const ext = entry.name.slice(entry.name.lastIndexOf("."));
			if (TEXT_EXTENSIONS.has(ext)) {
				let text = readFileSync(fromPath, "utf8");
				text = portText(text);
				writeFileSync(toPath, text);
			} else {
				cpSync(fromPath, toPath);
			}
		}
	}
}

function portText(text) {
	let result = text;
	for (const [from, to] of PATH_REPLACEMENTS) result = result.replaceAll(from, to);
	for (const [from, to] of GENERIC_REPLACEMENTS) result = result.replaceAll(from, to);
	// `SKILL_DIR` is a-coder-cli's token; keep bare Hermes occurrences working.
	result = result.replace(/(?<!\$)\bSKILL_DIR\b/g, "${SKILL_DIR}");
	return result;
}

function portSkill(filePath, relativePath) {
	let text = readFileSync(filePath, "utf8");
	for (const [from, to] of SKILL_OVERRIDES[relativePath] ?? []) {
		if (typeof from === "string") {
			if (!text.includes(from)) fail(`override did not match in ${relativePath}: ${from.slice(0, 60)}`);
			text = text.replaceAll(from, to);
		} else {
			const next = text.replace(from, to);
			if (next === text) fail(`override did not match in ${relativePath}: ${from}`);
			text = next;
		}
	}
	text = insertPortingNote(text);
	writeFileSync(filePath, text);
}

function insertPortingNote(text) {
	if (!text.startsWith("---\n")) return `${PORTING_NOTE}\n\n${text}`;
	const end = text.indexOf("\n---", 4);
	if (end === -1) return `${PORTING_NOTE}\n\n${text}`;
	const frontmatter = text.slice(0, end + 4);
	const body = text.slice(end + 4).replace(/^\n+/, "");
	return `${frontmatter}\n\n${PORTING_NOTE}\n\n${body}`;
}

function hashTree(dir) {
	const hash = createHash("sha256");
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(path);
			} else if (entry.isFile()) {
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
	if (!existsSync(expectedDir)) return [`missing ${relative(root, expectedDir)}`];
	const walk = (left, right) => {
		const leftEntries = existsSync(left) ? readdirSync(left, { withFileTypes: true }) : [];
		const rightEntries = existsSync(right) ? readdirSync(right, { withFileTypes: true }) : [];
		const leftNames = new Set(leftEntries.map((entry) => entry.name));
		const rightNames = new Set(rightEntries.map((entry) => entry.name));
		for (const name of leftNames) {
			if (!rightNames.has(name)) differences.push(`extra ${relative(root, join(left, name))}`);
		}
		for (const name of rightNames) {
			if (!leftNames.has(name)) {
				differences.push(`missing ${relative(root, join(left, name))}`);
				continue;
			}
			const leftPath = join(left, name);
			const rightPath = join(right, name);
			const leftStat = statSync(leftPath);
			const rightStat = statSync(rightPath);
			if (leftStat.isDirectory() !== rightStat.isDirectory()) {
				differences.push(`type mismatch ${relative(root, leftPath)}`);
			} else if (leftStat.isDirectory()) {
				walk(leftPath, rightPath);
			} else if (!readFileSync(leftPath).equals(readFileSync(rightPath))) {
				differences.push(`changed ${relative(root, leftPath)}`);
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

function arg(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

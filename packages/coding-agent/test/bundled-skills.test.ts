import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getBundledSkillsDir, getPackageDir } from "../src/config.ts";
import { loadSkillsFromDir } from "../src/core/skills.ts";

const HERMES_SKILLS = [
	"computer-use",
	"test-driven-development",
	"systematic-debugging",
	"github",
	"codebase-inspection",
	"spike",
	"requesting-code-review",
	"simplify-code",
	"python-debugpy",
	"node-inspect-debugger",
	"dogfood",
	"blocked-page-recovery",
	"xurl",
	"humanizer",
	"baoyu-infographic",
	"claude-design",
	"design-md",
	"popular-web-designs",
	"architecture-diagram",
	"p5js",
	"competitor-news-monitor",
	"grounded-citations",
	"youtube-content",
];

const EXTERNAL_SKILLS = [
	"ponytail",
	"ponytail-audit",
	"ponytail-debt",
	"ponytail-gain",
	"ponytail-help",
	"ponytail-review",
	"reverse-engineer-anything",
];

const ALL_REQUIRED_SKILLS = [...HERMES_SKILLS, ...EXTERNAL_SKILLS];

const packageDir = getPackageDir();
const bundledDir = getBundledSkillsDir();

function walkSkillFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...walkSkillFiles(path));
		else if (entry.name === "SKILL.md") files.push(path);
	}
	return files;
}

describe("bundled skills", () => {
	it("loads the bundled Lemo and Hermes skills with valid frontmatter", () => {
		const { skills, diagnostics } = loadSkillsFromDir({ dir: bundledDir, source: "bundled" });
		const errors = diagnostics.filter((diagnostic) => diagnostic.type === "error");
		expect(errors).toEqual([]);
		expect(skills.length).toBeGreaterThanOrEqual(ALL_REQUIRED_SKILLS.length + 1);

		for (const skill of skills) {
			expect(skill.name.length).toBeGreaterThan(0);
			expect(skill.description.length).toBeGreaterThan(0);
			expect(skill.filePath.endsWith("SKILL.md")).toBe(true);
		}
	});

	it("ships the curated Hermes set", () => {
		const names = new Set(
			loadSkillsFromDir({ dir: bundledDir, source: "bundled" }).skills.map((skill) => skill.name),
		);
		expect(names.has("lemo-opuscar")).toBe(true);
		for (const name of ALL_REQUIRED_SKILLS) expect(names.has(name)).toBe(true);
	});

	it("has no Hermes config paths left in the ported skills", () => {
		for (const file of walkSkillFiles(join(bundledDir, "hermes"))) {
			const text = readFileSync(file, "utf8");
			expect(text.includes("~/.hermes")).toBe(false);
			expect(text.includes("$HERMES_HOME")).toBe(false);
			expect(text.includes("HERMES_HOME")).toBe(false);
		}
	});

	it("is included by npm packaging and the binary archive build", () => {
		const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { files?: string[] };
		expect(pkg.files).toContain("skills");

		const repoRoot = resolve(packageDir, "..", "..");
		const buildScript = readFileSync(join(repoRoot, "scripts", "build-binaries.sh"), "utf8");
		expect(buildScript).toContain('cp -r skills "$OUTPUT_DIR/$platform/"');
	});

	it("records the upstream source in the manifest", () => {
		const manifest = JSON.parse(readFileSync(join(bundledDir, "hermes", "MANIFEST.json"), "utf8")) as {
			source: string;
			sourceCommit: string;
			license: string;
			skills: unknown[];
		};
		expect(manifest.source).toBe("https://github.com/NousResearch/hermes-agent");
		expect(manifest.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
		expect(manifest.license).toBe("MIT");
		expect(manifest.skills).toHaveLength(HERMES_SKILLS.length);
	});

	it("records the Ponytail and REA sources", () => {
		const ponytail = JSON.parse(readFileSync(join(bundledDir, "ponytail", "MANIFEST.json"), "utf8")) as {
			source: string;
			sourceCommit: string;
			license: string;
			skills: unknown[];
		};
		expect(ponytail.source).toBe("https://github.com/DietrichGebert/ponytail");
		expect(ponytail.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
		expect(ponytail.license).toBe("MIT");
		expect(ponytail.skills).toHaveLength(6);

		const rea = JSON.parse(readFileSync(join(bundledDir, "rea", "MANIFEST.json"), "utf8")) as {
			source: string;
			sourceCommit: string;
			license: string;
			skills: unknown[];
		};
		expect(rea.source).toBe("https://github.com/sgunin/reverseengineeranything");
		expect(rea.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
		expect(rea.license).toBe("MIT");
		expect(rea.skills).toHaveLength(1);
	});
});

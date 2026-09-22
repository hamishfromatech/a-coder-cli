import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/core/skills.ts";
import { extractSection, parseSopParameters, SOP_FILE_SUFFIX, validateSop } from "../src/core/sop.ts";

const VALID_SOP = `---
name: review-thing
description: Review something with a structured workflow.
---

# Review Thing

## Overview

Review the target and report findings.

## Parameters

- **target** (required): What to review
- **focus_areas** (optional, default: "correctness"): Focus areas

**Constraints for parameter acquisition:**
- You MUST ask for all parameters upfront in a single prompt
- You MUST validate the target before proceeding

## Steps

### 1. Setup

Prepare the workspace.

**Constraints:**
- You MUST create progress.md before starting
- You MUST NOT modify files under review, because this SOP is read-only

### 2. Report

Deliver findings.

**Constraints:**
- You MUST sort findings by severity
- You SHOULD record remaining work in progress.md
`;

function messages(diagnostics: { message: string }[]): string[] {
	return diagnostics.map((d) => d.message);
}

describe("parseSopParameters", () => {
	it("parses required, optional, and default forms", () => {
		const params = parseSopParameters(VALID_SOP);
		expect(params).toEqual([
			{ name: "target", required: true, description: "What to review" },
			{ name: "focus_areas", required: false, default: "correctness", description: "Focus areas" },
		]);
	});

	it("returns [] when the section is missing", () => {
		expect(parseSopParameters("# T\n## Steps\n### 1. Do\n")).toEqual([]);
	});
});

describe("extractSection", () => {
	it("returns the body up to the next ## heading", () => {
		const section = extractSection(VALID_SOP, "Parameters");
		expect(section).toContain("**target**");
		expect(section).not.toContain("## Steps");
	});
});

describe("validateSop", () => {
	it("accepts a well-formed SOP without diagnostics", () => {
		expect(validateSop(VALID_SOP, "review-thing.sop.md")).toEqual([]);
	});

	it("warns on missing required sections", () => {
		const diagnostics = validateSop("# T\nSome prose, no sections.\n", "x.sop.md");
		const text = messages(diagnostics).join("\n");
		expect(text).toContain("Overview");
		expect(text).toContain("Parameters");
		expect(text).toContain("Steps");
	});

	it("warns when Parameters exist but bullets are malformed", () => {
		const content = VALID_SOP.replace("- **target** (required): What to review", "- target: what to review").replace(
			'- **focus_areas** (optional, default: "correctness"): Focus areas',
			"- focus_areas: areas",
		);
		expect(messages(validateSop(content, "x.sop.md"))).toContain(
			"SOP '## Parameters' section has no recognizable parameter bullets; expected '- **name** (required|optional): description'",
		);
	});

	it("warns on invalid parameter names", () => {
		const content = VALID_SOP.replace("- **target** (required)", "- **Target** (required)");
		const text = messages(validateSop(content, "x.sop.md")).join("\n");
		expect(text).toContain("lowercase");
	});

	it("warns when Steps has no numbered headings", () => {
		const content = VALID_SOP.replace(/### \d+\. /g, "### ");
		const text = messages(validateSop(content, "x.sop.md")).join("\n");
		expect(text).toContain("numbered step headings");
	});

	it("warns when there are no constraint blocks", () => {
		const content = VALID_SOP.replaceAll("**Constraints:**", "Notes:");
		const text = messages(validateSop(content, "x.sop.md")).join("\n");
		expect(text).toContain("no '**Constraints:**' blocks");
	});

	it("warns when constraint blocks lack RFC 2119 keywords", () => {
		const content = VALID_SOP.replace(/- You (?:MUST|SHOULD|MAY)(?: NOT)?[^\n]+/g, "- Do the thing");
		const text = messages(validateSop(content, "x.sop.md")).join("\n");
		expect(text).toContain("RFC 2119");
	});

	it("warns on negative constraints without context", () => {
		const content = VALID_SOP.replace(
			"- You MUST NOT modify files under review, because this SOP is read-only",
			"- You MUST NOT.",
		);
		const text = messages(validateSop(content, "x.sop.md")).join("\n");
		expect(text).toContain("negative constraint lacks context");
	});

	it("warns when frontmatter parameters are not declared in markdown", () => {
		const content = VALID_SOP.replace(
			"description: Review something with a structured workflow.\n---",
			"description: Review something with a structured workflow.\nparameters:\n  - name: phantom_param\n    required: true\n---",
		);
		const text = messages(validateSop(content, "x.sop.md")).join("\n");
		expect(text).toContain('"phantom_param" is not declared');
	});
});

describe("skills loader integration", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "a-coder-sop-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function writeSop(name: string, content: string): void {
		writeFileSync(join(dir, name), content, "utf-8");
	}

	it("loads .sop.md skills and surfaces SOP warnings as diagnostics", () => {
		writeSop("broken.sop.md", VALID_SOP.replace("## Overview\n", ""));
		const { skills, diagnostics } = loadSkillsFromDir({ dir, source: "user" });
		expect(skills.map((s) => s.name)).toEqual(["review-thing"]);
		expect(messages(diagnostics).join("\n")).toContain("Overview");
		expect(diagnostics[0]?.path).toContain("broken.sop.md");
	});

	it("clean .sop.md skills load without SOP diagnostics", () => {
		writeSop("clean.sop.md", VALID_SOP.replace("name: review-thing", "name: clean"));
		const { skills, diagnostics } = loadSkillsFromDir({ dir, source: "user" });
		expect(skills.map((s) => s.name)).toEqual(["clean"]);
		expect(diagnostics.filter((d) => d.path?.endsWith(SOP_FILE_SUFFIX))).toEqual([]);
	});
});

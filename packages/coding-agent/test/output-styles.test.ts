import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyPersistedOutputStyle,
	getActiveOutputStyle,
	getActiveOutputStyleName,
	getOutputStyle,
	getOutputStylePrompt,
	listOutputStyles,
	loadOutputStyles,
	setActiveOutputStyleName,
} from "../src/core/output-styles.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-output-styles-"));
}

describe("output-styles registry", () => {
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		agentDir = tempDir();
		cwd = tempDir();
		// Reset to a known state (default) before each test.
		setActiveOutputStyleName("default");
	});

	afterEach(() => {
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	});

	it("ships default/Explanatory/Learning built-ins", () => {
		loadOutputStyles({ agentDir, cwd });
		const names = listOutputStyles().map((s) => s.name);
		expect(names).toContain("default");
		expect(names).toContain("Explanatory");
		expect(names).toContain("Learning");
		expect(getOutputStyle("default")?.prompt).toBe("");
		expect(getOutputStyle("Explanatory")?.prompt.length).toBeGreaterThan(0);
	});

	it("default style contributes no extra prompt", () => {
		loadOutputStyles({ agentDir, cwd });
		setActiveOutputStyleName("default");
		expect(getOutputStylePrompt()).toBe("");
	});

	it("switches the active style at runtime", () => {
		loadOutputStyles({ agentDir, cwd });
		expect(setActiveOutputStyleName("Learning")).toBe(true);
		expect(getActiveOutputStyleName()).toBe("Learning");
		expect(getActiveOutputStyle().name).toBe("Learning");
		expect(getOutputStylePrompt()).toBe(getOutputStyle("Learning")?.prompt);
	});

	it("rejects an unknown style name", () => {
		loadOutputStyles({ agentDir, cwd });
		expect(setActiveOutputStyleName("nope")).toBe(false);
		expect(getActiveOutputStyleName()).toBe("default");
	});

	it("loads custom .md styles from user and project scope (project wins)", () => {
		mkdirSync(join(agentDir, "output-styles"), { recursive: true });
		// User style with an H1 description line that gets stripped from the prompt.
		writeFileSync(
			join(agentDir, "output-styles", "terse.md"),
			"# Be terse\n\nAnswer in two sentences maximum. No pleasantries.",
		);
		// Project-scoped style overrides a same-named user style.
		const projectDir = join(cwd, ".a-coder-cli", "output-styles");
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, "terse.md"), "# Terse (project)\n\nProject body.");
		// A project-only style.
		writeFileSync(join(projectDir, "chatty.md"), "Just a prompt, no H1.");

		loadOutputStyles({ agentDir, cwd });

		const terse = getOutputStyle("terse");
		expect(terse?.source).toBe("project");
		expect(terse?.description).toBe("Terse (project)");
		expect(terse?.prompt).toBe("Project body.");

		const chatty = getOutputStyle("chatty");
		expect(chatty?.source).toBe("project");
		// No H1 → description falls back to the stem, prompt is the whole file.
		expect(chatty?.description).toBe("Custom style");
		expect(chatty?.prompt).toContain("Just a prompt");
	});

	it("falls back to default if the active style disappears after a reload", () => {
		const userDir = join(agentDir, "output-styles");
		mkdirSync(userDir, { recursive: true });
		writeFileSync(join(userDir, "ephemeral.md"), "# Ephemeral\n\nBody.");
		loadOutputStyles({ agentDir, cwd });
		expect(setActiveOutputStyleName("ephemeral")).toBe(true);

		// Reload without the file on disk.
		rmSync(userDir, { recursive: true, force: true });
		loadOutputStyles({ agentDir, cwd });
		expect(getActiveOutputStyleName()).toBe("default");
	});

	it("applies a persisted preference, ignoring unknown values", () => {
		const userDir = join(agentDir, "output-styles");
		mkdirSync(userDir, { recursive: true });
		writeFileSync(join(userDir, "saved.md"), "# Saved\n\nBody.");
		loadOutputStyles({ agentDir, cwd });

		applyPersistedOutputStyle("saved");
		expect(getActiveOutputStyleName()).toBe("saved");

		applyPersistedOutputStyle("does-not-exist");
		expect(getActiveOutputStyleName()).toBe("default");
	});
});

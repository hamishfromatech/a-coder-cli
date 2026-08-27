import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAgentDir } from "../src/config.ts";
import { migrateConfigDir } from "../src/migrations.ts";

describe("migrateConfigDir — legacy flat root to ~/.a-coder/cli", () => {
	const created: string[] = [];
	let originalHome: string | undefined;

	beforeEach(() => {
		originalHome = process.env.HOME;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		while (created.length > 0) {
			const dir = created.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	function makeHome(): string {
		// Real short paths via /tmp — macOS $TMPDIR is fine, but keep it simple.
		const home = mkdtempSync(join(tmpdir(), "ac-migrate-"));
		created.push(home);
		process.env.HOME = home;
		return home;
	}

	it("renames the whole legacy dir when the new root does not exist", () => {
		const home = makeHome();
		const legacy = join(home, ".a-coder-cli");
		mkdirSync(join(legacy, "agent", "sessions"), { recursive: true });
		writeFileSync(join(legacy, "agent", "settings.json"), '{"theme":"dark"}');
		writeFileSync(join(legacy, "agent", "sessions", "s.jsonl"), "{}");
		writeFileSync(join(legacy, "MEMORY.md"), "notes");

		migrateConfigDir(home);

		expect(existsSync(legacy)).toBe(false);
		expect(existsSync(join(home, ".a-coder", "cli", "agent", "settings.json"))).toBe(true);
		expect(readFileSync(join(home, ".a-coder", "cli", "MEMORY.md"), "utf8")).toBe("notes");
		// getAgentDir() now resolves into the moved data.
		expect(getAgentDir()).toBe(join(home, ".a-coder", "cli", "agent"));
	});

	it("moves entries individually without clobbering an existing new root", () => {
		const home = makeHome();
		const legacy = join(home, ".a-coder-cli");
		mkdirSync(join(legacy, "agent"), { recursive: true });
		writeFileSync(join(legacy, "agent", "auth.json"), "{}");
		writeFileSync(join(legacy, "MEMORY.md"), "old");

		// The new root already exists with engine-install content.
		const newRoot = join(home, ".a-coder", "cli");
		mkdirSync(join(newRoot, "lib"), { recursive: true });
		writeFileSync(join(newRoot, "lib", "pi"), "#!/bin/sh");
		// And already has a MEMORY.md — must not be overwritten.
		writeFileSync(join(newRoot, "MEMORY.md"), "newer notes");

		migrateConfigDir(home);

		expect(readFileSync(join(newRoot, "agent", "auth.json"), "utf8")).toBe("{}");
		expect(existsSync(join(newRoot, "lib", "pi"))).toBe(true);
		// Existing target kept; the old copy is preserved in place.
		expect(readFileSync(join(newRoot, "MEMORY.md"), "utf8")).toBe("newer notes");
		// The clobbered entry stays behind in the legacy dir.
		expect(readFileSync(join(legacy, "MEMORY.md"), "utf8")).toBe("old");
	});

	it("is idempotent and cleans up an emptied legacy dir", () => {
		const home = makeHome();
		const legacy = join(home, ".a-coder-cli");
		mkdirSync(join(legacy, "agent"), { recursive: true });
		writeFileSync(join(legacy, "agent", "models.json"), "{}");

		migrateConfigDir(home);
		expect(existsSync(legacy)).toBe(false);

		// Second run is a no-op.
		migrateConfigDir(home);
		expect(existsSync(join(home, ".a-coder", "cli", "agent", "models.json"))).toBe(true);
	});

	it("does nothing when the legacy dir is missing", () => {
		const home = makeHome();
		mkdirSync(join(home, ".a-coder"), { recursive: true });
		migrateConfigDir(home);
		expect(existsSync(join(home, ".a-coder", "cli"))).toBe(false);
	});

	// Regression: with cwd == home, the legacy `~/.a-coder` → `~/.a-coder-cli`
	// project-local migration must not fire — `~/.a-coder` is now the shared
	// product root, and renaming it would resurrect the legacy dir and destroy
	// the migrated `~/.a-coder/cli`.
	it("keeps the new root intact when cwd is the home directory", () => {
		const home = makeHome();
		const legacy = join(home, ".a-coder-cli");
		mkdirSync(join(legacy, "agent"), { recursive: true });
		writeFileSync(join(legacy, "agent", "settings.json"), "{}");

		migrateConfigDir(home); // cwd == home

		expect(existsSync(legacy)).toBe(false);
		expect(existsSync(join(home, ".a-coder", "cli", "agent", "settings.json"))).toBe(true);
	});
});

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getOfficeSessionDir, migrateLegacyOfficeSessions } from "../../src/core/office/sessions.ts";
import * as store from "../../src/core/office/store.ts";
import type { Coworker } from "../../src/core/office/types.ts";
import { getDefaultSessionDir, SessionManager } from "../../src/core/session-manager.ts";

const roots: string[] = [];
const originalOfficeDir = process.env.A_CODER_CLI_OFFICE_DIR;

function tempDir(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), `${name}-`));
	roots.push(dir);
	return dir;
}

afterEach(() => {
	if (originalOfficeDir === undefined) delete process.env.A_CODER_CLI_OFFICE_DIR;
	else process.env.A_CODER_CLI_OFFICE_DIR = originalOfficeDir;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeCoworker(id: string, cwd: string, sessionPath: string): Coworker {
	return {
		id,
		name: id,
		handle: id.toLowerCase(),
		soul: "Test coworker",
		face: { shape: "circle" },
		autonomy: "supervised",
		createdAt: Date.now(),
		sessions: { [cwd]: sessionPath },
	};
}

describe("office session storage", () => {
	it("creates coworker sessions in a hidden subdirectory", () => {
		const agentDir = tempDir("office-agent");
		const cwd = tempDir("office-project");
		const dir = getOfficeSessionDir(cwd, agentDir);
		expect(dir).toBe(join(getDefaultSessionDir(cwd, agentDir), ".office"));
	});

	it("migrates legacy coworker sessions out of the main session store", async () => {
		const agentDir = tempDir("office-agent");
		const officeDir = tempDir("office-data");
		process.env.A_CODER_CLI_OFFICE_DIR = officeDir;
		const cwd = tempDir("office-project");
		const projectDir = getDefaultSessionDir(cwd, agentDir);
		const legacy = join(projectDir, "legacy-session.jsonl");
		writeFileSync(
			legacy,
			'{"type":"session","id":"legacy","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp/project"}\n',
		);
		await store.saveCoworker(makeCoworker("alfred", cwd, legacy));

		expect(await migrateLegacyOfficeSessions(agentDir)).toBe(1);

		const target = join(projectDir, ".office", "legacy-session.jsonl");
		expect(existsSync(legacy)).toBe(false);
		expect(existsSync(target)).toBe(true);
		expect((await store.listCoworkers())[0]?.sessions[cwd]).toBe(target);

		const listed = await SessionManager.list(cwd, projectDir);
		expect(listed.some((session) => session.path === target)).toBe(false);
	});

	it("is idempotent once a coworker session is already hidden", async () => {
		const agentDir = tempDir("office-agent");
		const officeDir = tempDir("office-data");
		process.env.A_CODER_CLI_OFFICE_DIR = officeDir;
		const cwd = tempDir("office-project");
		const hiddenDir = join(getDefaultSessionDir(cwd, agentDir), ".office");
		mkdirSync(hiddenDir, { recursive: true });
		const hidden = join(hiddenDir, "coworker.jsonl");
		writeFileSync(
			hidden,
			'{"type":"session","id":"coworker","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp/project"}\n',
		);
		await store.saveCoworker(makeCoworker("humphrey", cwd, hidden));

		expect(await migrateLegacyOfficeSessions(agentDir)).toBe(0);
		expect(existsSync(hidden)).toBe(true);
	});
});

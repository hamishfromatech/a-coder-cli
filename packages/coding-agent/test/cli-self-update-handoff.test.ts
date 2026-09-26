import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeUpdateHandoff, writeUpdateHandoff } from "../src/utils/cli-self-update.ts";

const SAVED_ENV = process.env.A_CODER_CLI_CODING_AGENT_DIR;
let tempDir = "";

beforeEach(() => {
	tempDir = fs.mkdtempSync(join(os.tmpdir(), "acoder-update-handoff-"));
	process.env.A_CODER_CLI_CODING_AGENT_DIR = tempDir;
});

afterEach(() => {
	if (SAVED_ENV !== undefined) {
		process.env.A_CODER_CLI_CODING_AGENT_DIR = SAVED_ENV;
	} else {
		delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("update handoff marker", () => {
	it("round-trips the tag and normalizes the v prefix", () => {
		writeUpdateHandoff("0.80.114");
		const handoff = takeUpdateHandoff();
		expect(handoff?.tag).toBe("v0.80.114");
		expect(typeof handoff?.startedAt).toBe("number");
	});

	it("clears on read so the note shows once", () => {
		writeUpdateHandoff("v1.2.3");
		expect(takeUpdateHandoff()).not.toBeNull();
		expect(takeUpdateHandoff()).toBeNull();
	});

	it("returns null when no update was in flight", () => {
		expect(takeUpdateHandoff()).toBeNull();
	});

	it("returns null for a malformed marker instead of throwing", () => {
		fs.writeFileSync(join(tempDir, "update-handoff.json"), "{not json");
		expect(takeUpdateHandoff()).toBeNull();
		expect(takeUpdateHandoff()).toBeNull();
	});
});

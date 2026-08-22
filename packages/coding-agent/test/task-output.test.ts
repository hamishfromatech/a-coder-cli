import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendTaskOutput,
	ensureTaskOutputFile,
	getTaskOutputPath,
	previewToolResult,
	readTaskOutputEvents,
} from "../src/core/subagents/task-output.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "a-coder-task-output-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("task-output", () => {
	it("builds a safe path from session dir + agent id", () => {
		const p = getTaskOutputPath(dir, "my-agent");
		expect(p).toBe(join(dir, "tasks", "my-agent.output"));
		// Traversal attempts are sanitized to a single safe segment (dots stay
		// inside one filename — they cannot escape tasks/).
		const evil = getTaskOutputPath(dir, "../../etc/passwd");
		expect(evil.startsWith(join(dir, "tasks"))).toBe(true);
		expect(evil).toBe(join(dir, "tasks", "..-..-etc-passwd.output"));
	});

	it("ensures the file exists and appends events as JSONL", async () => {
		const p = await ensureTaskOutputFile(dir, "agent-1");
		await appendTaskOutput(p, { type: "started", agentType: "general-purpose", prompt: "do things" });
		await appendTaskOutput(p, { type: "text", text: "hello" });
		await appendTaskOutput(p, {
			type: "completed",
			reason: "completed",
			finalText: "done",
			durationMs: 5,
			totalTokens: 10,
			toolUseCount: 1,
		});

		const raw = await readFile(p, "utf8");
		const lines = raw.trim().split("\n");
		expect(lines).toHaveLength(3);

		const records = await readTaskOutputEvents(p);
		expect(records).toHaveLength(3);
		expect(records[0].event.type).toBe("started");
		expect(records[1].event.type).toBe("text");
		expect(records[2].event.type).toBe("completed");
		expect(typeof records[0].timestamp).toBe("string");
	});

	it("returns [] for a missing file", async () => {
		const records = await readTaskOutputEvents(join(dir, "nope.output"));
		expect(records).toEqual([]);
	});

	it("drops partial trailing lines", async () => {
		const p = await ensureTaskOutputFile(dir, "agent-2");
		await appendTaskOutput(p, { type: "text", text: "good" });
		await appendFile(p, '{"type":"text","text":"partial'); // no newline, invalid JSON
		const records = await readTaskOutputEvents(p);
		expect(records).toHaveLength(1);
		expect((records[0].event as { text: string }).text).toBe("good");
	});

	it("previews long tool results", () => {
		expect(previewToolResult("short")).toBe("short");
		const long = "x".repeat(3000);
		const preview = previewToolResult(long);
		expect(preview.length).toBeLessThan(long.length);
		expect(preview).toContain("truncated");
	});
});
